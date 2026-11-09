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

const VERSION = process.env.MESSAGEX_VERSION || "0.1.0";

const BROKER_IMAGE =
  `sameeryadav2005/messagex-broker:${VERSION}`;

const DASHBOARD_IMAGE =
  `sameeryadav2005/messagex-dashboard:${VERSION}`;

const NETWORK = "messagex-private";
const DATA_VOLUME = "messagex_data";

const DASHBOARD_PORT =
  String(process.env.DASHBOARD_PORT || 15672);

const TCP_HOST_IP =
  process.env.TCP_BIND_ADDRESS || "127.0.0.1";

const TCP_HOST_PORT =
  String(process.env.TCP_PORT || 5678);

const DATA_DIR = "/data";
const CREDENTIALS_FILE = `${DATA_DIR}/credentials.txt`;

const names = {
  postgres: "messagex-postgres",
  broker: "messagex-broker",
  dashboard: "messagex-dashboard"
};

const log = (message) => {
  console.log(`[MessageX Launcher] ${message}`);
};

// Pull image if it is not already present.
async function ensureImage(image) {
  try {
    await docker.getImage(image).inspect();
    log(`Image already available: ${image}`);
    return;
  } catch (error) {
    if (error.statusCode !== 404) throw error;
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

// Create private Docker network.
async function ensureNetwork() {
  try {
    await docker.getNetwork(NETWORK).inspect();
  } catch (error) {
    if (error.statusCode !== 404) throw error;

    await docker.createNetwork({
      Name: NETWORK,
      Driver: "bridge"
    });

    log("MessageX network created");
  }
}
// Create persistent PostgreSQL volume.
async function ensureVolume() {
  try {
    await docker.getVolume(DATA_VOLUME).inspect();
  } catch (error) {
    if (error.statusCode !== 404) throw error;

    await docker.createVolume({
      Name: DATA_VOLUME
    });

    log("Database volume created");
  }
}

// Generate credentials once and persist them.
async function getCredentials() {
  await mkdir(DATA_DIR, { recursive: true });

  try {
    const content = await readFile(
      CREDENTIALS_FILE,
      "utf8"
    );

    const values = Object.fromEntries(
      content.trim().split("\n").map((line) => {
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

    return {
      ...values,
      newlyGenerated: false
    };

  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const credentials = {
    username: "admin",
    password: randomBytes(32).toString("base64url")
  };

  await writeFile(
    CREDENTIALS_FILE,
    `username=${credentials.username}\npassword=${credentials.password}\n`,
    {
      flag: "wx",
      mode: 0o600
    }
  );

  await chmod(CREDENTIALS_FILE, 0o600);

  return {
    ...credentials,
    newlyGenerated: true
  };
}

// Generate persistent PostgreSQL password.
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

// Inspect an existing container.
async function inspectContainer(name) {
  try {
    const container = docker.getContainer(name);

    return {
      container,
      info: await container.inspect()
    };

  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
}

// Create or start a container.
async function ensureRunning(name, config) {
  const existing = await inspectContainer(name);

  if (existing) {
    if (!existing.info.State.Running) {
      await existing.container.start();
      log(`Started existing container: ${name}`);
    } else {
      log(`Already running: ${name}`);
    }

    return existing.container;
  }

  const container = await docker.createContainer({
    ...config,
    name
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

  throw new Error(
    `Timed out waiting for ${label}`
  );
}

// Create the initial administrator account.
async function initializeAdmin(
  credentials,
  databasePassword
) {
  const name = "messagex-admin-init";

  const existing = await inspectContainer(name);

  if (existing) {
    if (existing.info.State.Running) {
      await existing.container.wait();
    }

    const info = await existing.container.inspect();

    if (info.State.ExitCode === 0) {
      log("Admin initialization already completed");
      return;
    }

    await existing.container.remove({
      force: true
    });
  }

  const container = await docker.createContainer({
    name,
    Image: BROKER_IMAGE,

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

  log("Admin initialization completed");
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

  // 3. Initialize admin account
  await initializeAdmin(
    credentials,
    databasePassword
  );

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

  log(
    `Dashboard: http://<SERVER_PUBLIC_IP>:${DASHBOARD_PORT}`
  );

  log(
    `Broker TCP: ${TCP_HOST_IP}:${TCP_HOST_PORT}`
  );

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
  console.error(
    "[MessageX Launcher] Startup failed:",
    error
  );

  process.exit(1);
});