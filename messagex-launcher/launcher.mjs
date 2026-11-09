import Docker from "dockerode";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  chmod
} from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const docker = new Docker({
  socketPath: "/var/run/docker.sock"
});

// This version selects the broker and dashboard image tags.
// It is independent of the launcher Docker image tag.
const VERSION = process.env.MESSAGEX_VERSION || "0.1.0";

const BROKER_IMAGE =
  `sameeryadav2005/messagex-broker:${VERSION}`;

const DASHBOARD_IMAGE =
  `sameeryadav2005/messagex-dashboard:${VERSION}`;

const OWNER_LABEL = "com.imsameer.messagex.launcher";
const OWNER_VALUE = "true";

const RESOURCE_LABELS = {
  [OWNER_LABEL]: OWNER_VALUE
};

// Dedicated resource names prevent collisions with the Compose deployment.
const NETWORK = "messagex-launcher-private";
const DATA_VOLUME = "messagex_launcher_postgres_data";

const DASHBOARD_PORT =
  String(process.env.DASHBOARD_PORT || 15672);

const TCP_HOST_IP =
  process.env.TCP_BIND_ADDRESS || "127.0.0.1";

const TCP_HOST_PORT =
  String(process.env.TCP_PORT || 5678);

const DATA_DIR = "/data";
const CREDENTIALS_FILE = `${DATA_DIR}/credentials.txt`;

const names = {
  postgres: "messagex-launcher-postgres",
  broker: "messagex-launcher-broker",
  dashboard: "messagex-launcher-dashboard",
  adminInit: "messagex-launcher-admin-init"
};

const recreatedContainers = new Set();

const log = (message) => {
  console.log(`[MessageX Launcher] ${message}`);
};

function isNotFound(error) {
  return error.statusCode === 404;
}

// Pull an image only when it is not already present locally.
async function ensureImage(image) {
  try {
    await docker.getImage(image).inspect();
    log(`Image already available: ${image}`);
    return;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }

  log(`Pulling ${image}...`);

  await new Promise((resolve, reject) => {
    docker.pull(image, (error, stream) => {
      if (error) return reject(error);

      docker.modem.followProgress(
        stream,
        (err) => err ? reject(err) : resolve()
      );
    });
  });

  log(`Pulled ${image}`);
}

// Create or verify the dedicated Docker network.
async function ensureNetwork() {
  try {
    const info = await docker.getNetwork(NETWORK).inspect();

    if (info.Labels?.[OWNER_LABEL] !== OWNER_VALUE) {
      throw new Error(
        `Network "${NETWORK}" exists but is not owned by MessageX Launcher. Refusing to use it.`
      );
    }

    if (info.Driver !== "bridge" || info.Internal === true) {
      throw new Error(
        `Network "${NETWORK}" has an unexpected configuration. Refusing to use it.`
      );
    }

    log("MessageX network exists and ownership is verified.");
  } catch (error) {
    if (!isNotFound(error)) throw error;

    await docker.createNetwork({
      Name: NETWORK,
      Driver: "bridge",
      Internal: false,
      Labels: RESOURCE_LABELS
    });

    log("MessageX network created.");
  }
}

// Create or verify the persistent PostgreSQL volume.
// Never remove this volume automatically.
async function ensureVolume() {
  try {
    const info = await docker.getVolume(DATA_VOLUME).inspect();

    if (info.Labels?.[OWNER_LABEL] !== OWNER_VALUE) {
      throw new Error(
        `Volume "${DATA_VOLUME}" exists but is not owned by MessageX Launcher. Refusing to use it.`
      );
    }

    if (info.Driver !== "local") {
      throw new Error(
        `Volume "${DATA_VOLUME}" uses unexpected driver "${info.Driver}".`
      );
    }

    log("PostgreSQL volume exists and ownership is verified.");
  } catch (error) {
    if (!isNotFound(error)) throw error;

    await docker.createVolume({
      Name: DATA_VOLUME,
      Driver: "local",
      Labels: RESOURCE_LABELS
    });

    log("PostgreSQL volume created.");
  }
}

// Read persisted credentials or generate them once.
async function getCredentials() {
  await mkdir(DATA_DIR, { recursive: true });

  const suppliedUsername = process.env.MESSAGEX_DEFAULT_USER?.trim();
  const suppliedPassword = process.env.MESSAGEX_DEFAULT_PASS;
  const hasUsername = Boolean(suppliedUsername);
  const hasPassword = typeof suppliedPassword === "string" && suppliedPassword.length > 0;

  if (hasUsername !== hasPassword) {
    throw new Error(
      "Set both MESSAGEX_DEFAULT_USER and MESSAGEX_DEFAULT_PASS, or set neither."
    );
  }

  if (hasPassword && suppliedPassword.length < 12) {
    throw new Error(
      "MESSAGEX_DEFAULT_PASS must contain at least 12 characters."
    );
  }

  try {
    const content = await readFile(CREDENTIALS_FILE, "utf8");

    const values = Object.fromEntries(
      content.trim().split("\\n").map((line) => {
        const index = line.indexOf("=");

        return [
          line.slice(0, index),
          line.slice(index + 1)
        ];
      })
    );

    if (!values.username || !values.password) {
      throw new Error("Invalid credentials file");
    }

    if (
      hasUsername &&
      (
        values.username !== suppliedUsername ||
        values.password !== suppliedPassword
      )
    ) {
      throw new Error(
        "Admin credentials are already initialized in /data. Environment variables only configure the first startup; they do not change an existing admin password."
      );
    }

    return {
      username: values.username,
      password: values.password,
      newlyGenerated: false,
      suppliedByUser: hasUsername
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const credentials = hasUsername
    ? {
        username: suppliedUsername,
        password: suppliedPassword
      }
    : {
        username: "admin",
        password: randomBytes(32).toString("base64url")
      };

  await writeFile(
    CREDENTIALS_FILE,
    `username=${credentials.username}\\npassword=${credentials.password}\\n`,
    {
      flag: "wx",
      mode: 0o600
    }
  );

  await chmod(CREDENTIALS_FILE, 0o600);

  return {
    ...credentials,
    newlyGenerated: !hasUsername,
    suppliedByUser: hasUsername
  };
}

// Read persisted PostgreSQL password or generate it once.
async function getDatabasePassword() {
  const file = `${DATA_DIR}/postgres-password`;

  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const password = randomBytes(32).toString("hex");

  await writeFile(file, password, {
    flag: "wx",
    mode: 0o600
  });

  await chmod(file, 0o600);

  return password;
}

// Inspect a container by its exact name.
async function inspectContainer(name) {
  try {
    const container = docker.getContainer(name);

    return {
      container,
      info: await container.inspect()
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

// Remove a container only after verifying that this launcher owns it.
async function removeOwnedContainer(name, existing) {
  if (existing.info.Config.Labels?.[OWNER_LABEL] !== OWNER_VALUE) {
    throw new Error(
      `Container "${name}" exists but is not owned by MessageX Launcher. Refusing to modify it.`
    );
  }

  if (existing.info.State.Running) {
    await existing.container.stop({ t: 10 });
  }

  await existing.container.remove();
}

// Create, reuse, or replace a launcher-owned container.
// Replacements never remove named volumes.
async function ensureRunning(name, config) {
  const existing = await inspectContainer(name);

  if (existing) {
    if (existing.info.Config.Labels?.[OWNER_LABEL] !== OWNER_VALUE) {
      throw new Error(
        `Container "${name}" already exists but is not owned by MessageX Launcher. Refusing to modify it.`
      );
    }

    const expectedImage = await docker.getImage(config.Image).inspect();
    const imageMatches = existing.info.Image === expectedImage.Id;
    const networkAttached = Boolean(
      existing.info.NetworkSettings?.Networks?.[NETWORK]
    );
    const unhealthyState =
      !existing.info.State.Running ||
      existing.info.State.Restarting ||
      ["restarting", "exited", "dead"].includes(existing.info.State.Status);

    if (!imageMatches || !networkAttached || unhealthyState) {
      const reason = !imageMatches
        ? "outdated image"
        : !networkAttached
          ? "missing private network attachment"
          : "unhealthy container state";

      log(`Replacing launcher-owned container ${name}: ${reason}`);
      await removeOwnedContainer(name, existing);
      recreatedContainers.add(name);
    } else {
      log(`Already running with expected network: ${name}`);
      return existing.container;
    }
  }

  const container = await docker.createContainer({
    ...config,
    name,
    Labels: {
      ...(config.Labels || {}),
      ...RESOURCE_LABELS
    }
  });

  await container.start();

  log(`Created container: ${name}`);

  return container;
}

// Wait until a container reports healthy.
async function waitForHealth(
  container,
  label,
  timeoutMs = 180000
) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const info = await container.inspect();

    if (
      info.State.Status === "exited" ||
      info.State.Status === "dead"
    ) {
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: 80
      });

      throw new Error(
        `${label} exited:\n${logs.toString()}`
      );
    }

    if (info.State.Health?.Status === "healthy") {
      log(`${label} is healthy`);
      return;
    }

    await sleep(2000);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

// Create the initial administrator account.
async function initializeAdmin(credentials, databasePassword) {
  const name = names.adminInit;
  const existing = await inspectContainer(name);

  if (existing) {
    if (existing.info.Config.Labels?.[OWNER_LABEL] !== OWNER_VALUE) {
      throw new Error(
        `Container "${name}" already exists but is not owned by MessageX Launcher. Refusing to modify it.`
      );
    }

    if (existing.info.State.Running) {
      await existing.container.wait();
    }

    const info = await existing.container.inspect();

    if (info.State.ExitCode === 0) {
      log("Admin initialization already completed.");
      return;
    }

    await existing.container.remove({ force: true });
  }

  const container = await docker.createContainer({
    name,
    Image: BROKER_IMAGE,
    Labels: RESOURCE_LABELS,

    Cmd: [
      "node",
      "apps/broker/scripts/bootstrap-admin.mjs"
    ],

    Env: [
      `DATABASE_URL=postgresql://messagex:${databasePassword}@postgres:5432/messagex`,
      `MESSAGEX_ADMIN_USERNAME=${credentials.username}`,
      `MESSAGEX_ADMIN_PASSWORD=${credentials.password}`
    ],

    HostConfig: {
      NetworkMode: NETWORK
    },

    NetworkingConfig: {
      EndpointsConfig: {
        [NETWORK]: {
          Aliases: ["admin-init"]
        }
      }
    }
  });

  await container.start();

  const result = await container.wait();

  const logs = await container.logs({
    stdout: true,
    stderr: true,
    tail: 80
  });

  process.stdout.write(logs);

  if (result.StatusCode !== 0) {
    throw new Error(
      `Admin initialization failed: ${result.StatusCode}`
    );
  }

  await container.remove();

  log("Admin initialization completed.");
}

// Main startup process.
async function main() {
  log("Starting MessageX...");

  await ensureImage("postgres:17");
  await ensureImage(BROKER_IMAGE);
  await ensureImage(DASHBOARD_IMAGE);

  await ensureNetwork();
  await ensureVolume();

  const credentials = await getCredentials();
  const databasePassword = await getDatabasePassword();

  // 1. PostgreSQL
  const postgres = await ensureRunning(
    names.postgres,
    {
      Image: "postgres:17",

      Env: [
        "POSTGRES_USER=messagex",
        `POSTGRES_PASSWORD=${databasePassword}`,
        "POSTGRES_DB=messagex"
      ],

      Healthcheck: {
        Test: [
          "CMD-SHELL",
          "pg_isready -U messagex -d messagex"
        ],
        Interval: 5000000000,
        Timeout: 5000000000,
        Retries: 20,
        StartPeriod: 10000000000
      },

      HostConfig: {
        NetworkMode: NETWORK,

        RestartPolicy: {
          Name: "unless-stopped"
        },

        Mounts: [
          {
            Type: "volume",
            Source: DATA_VOLUME,
            Target: "/var/lib/postgresql/data"
          }
        ]
      },

      NetworkingConfig: {
        EndpointsConfig: {
          [NETWORK]: {
            Aliases: ["postgres"]
          }
        }
      }
    }
  );

  await waitForHealth(postgres, "PostgreSQL");

  // 2. MessageX broker
  const broker = await ensureRunning(
    names.broker,
    {
      Image: BROKER_IMAGE,

      Env: [
        "NODE_ENV=production",
        "HOST=0.0.0.0",
        "HTTP_PORT=3000",
        "TCP_PORT=5678",
        `DATABASE_URL=postgresql://messagex:${databasePassword}@postgres:5432/messagex`,
        "ACK_TIMEOUT_SECONDS=30",
        "ACK_TIMEOUT_CHECK_INTERVAL_MS=5000"
      ],

      ExposedPorts: {
        "3000/tcp": {},
        "5678/tcp": {}
      },

      Healthcheck: {
        Test: [
          "CMD",
          "node",
          "-e",
          "require('http').get('http://127.0.0.1:3000/health/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
        ],
        Interval: 5000000000,
        Timeout: 5000000000,
        Retries: 20,
        StartPeriod: 20000000000
      },

      HostConfig: {
        NetworkMode: NETWORK,

        RestartPolicy: {
          Name: "unless-stopped"
        },

        PortBindings: {
          "5678/tcp": [
            {
              HostIp: TCP_HOST_IP,
              HostPort: TCP_HOST_PORT
            }
          ]
        }
      },

      NetworkingConfig: {
        EndpointsConfig: {
          [NETWORK]: {
            Aliases: ["broker"]
          }
        }
      }
    }
  );

  await waitForHealth(broker, "MessageX broker");

  // 3. Initialize admin account.
  await initializeAdmin(credentials, databasePassword);

  // If the broker was replaced, recreate the dashboard too so its
  // Nginx upstream starts with the broker's current container IP.
  if (recreatedContainers.has(names.broker)) {
    const dashboardExisting = await inspectContainer(names.dashboard);

    if (dashboardExisting) {
      await removeOwnedContainer(names.dashboard, dashboardExisting);
    }
  }

  // 4. Management dashboard
  await ensureRunning(
    names.dashboard,
    {
      Image: DASHBOARD_IMAGE,

      ExposedPorts: {
        "80/tcp": {}
      },

      HostConfig: {
        NetworkMode: NETWORK,

        RestartPolicy: {
          Name: "unless-stopped"
        },

        PortBindings: {
          "80/tcp": [
            {
              HostIp: "0.0.0.0",
              HostPort: DASHBOARD_PORT
            }
          ]
        }
      },

      NetworkingConfig: {
        EndpointsConfig: {
          [NETWORK]: {
            Aliases: ["dashboard"]
          }
        }
      }
    }
  );

  log("================================");
  log("MessageX started successfully");
  log("================================");

  log(`Dashboard: http://<SERVER_PUBLIC_IP>:${DASHBOARD_PORT}`);
  log(`Broker TCP: ${TCP_HOST_IP}:${TCP_HOST_PORT}`);

  if (credentials.newlyGenerated) {
    log(`Admin username: ${credentials.username}`);
    log(`Admin password: ${credentials.password}`);
    log("Save this password securely.");
  } else {
    log("Existing admin credentials retained.");
    log("Retrieve them using: docker exec messagex cat /data/credentials.txt");
  }

  log("PostgreSQL is not exposed publicly.");
  log("Broker TCP is localhost-only until TLS is implemented.");

  // Keep the launcher alive as a supervisor process.
  setInterval(() => {}, 60000);
}

main().catch((error) => {
  console.error("[MessageX Launcher] Startup failed:", error);
  process.exit(1);
});
