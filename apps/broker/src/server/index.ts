
import { startHttpServer } from "./http.server.js";
import { TcpServer } from "./tcp.server.js";
import { runMigrations } from "../database/migration-runner.js";

import {
  connectDatabase,
  closeDatabase
} from "../database/database.js";

async function startMessageX(): Promise<void> {
  console.log("================================");
  console.log("       Starting MessageX        ");
  console.log("================================");

  // Connect to PostgreSQL before starting the broker.
  await connectDatabase();
  await runMigrations();

  const HTTP_PORT = Number(process.env.HTTP_PORT) || 3000;
  const TCP_PORT = Number(process.env.TCP_PORT) || 5678;

const tcpServer = new TcpServer();

const httpServer = startHttpServer(
  HTTP_PORT,
  tcpServer.connectionManager
);

  tcpServer.start(TCP_PORT);

  const ACK_TIMEOUT_SECONDS = Number(
  process.env.ACK_TIMEOUT_SECONDS ?? 30
);

const ACK_TIMEOUT_CHECK_INTERVAL_MS = Number(
  process.env.ACK_TIMEOUT_CHECK_INTERVAL_MS ?? 5000
);

if (
  !Number.isInteger(ACK_TIMEOUT_SECONDS) ||
  ACK_TIMEOUT_SECONDS < 1 ||
  !Number.isInteger(ACK_TIMEOUT_CHECK_INTERVAL_MS) ||
  ACK_TIMEOUT_CHECK_INTERVAL_MS < 1
) {
  throw new Error("Invalid ACK timeout configuration");
}

const recoveryTimer = setInterval(() => {
  void tcpServer
    .recoverExpiredDeliveries(ACK_TIMEOUT_SECONDS)
    .catch((error) => {
      console.error("[Consumer] Delivery recovery failed:", error);
    });
}, ACK_TIMEOUT_CHECK_INTERVAL_MS);

recoveryTimer.unref();

  let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  clearInterval(recoveryTimer);

  console.log("\n[MessageX] Shutting down...");

  // Stop HTTP and TCP servers, and wait for their cleanup.
  const results = await Promise.allSettled([
    new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    }),
    tcpServer.close()
  ]);

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[MessageX] Server shutdown error:", result.reason);
      process.exitCode = 1;
    }
  }

  // Close PostgreSQL only after connection recovery has completed.
  try {
    await closeDatabase();
  } catch (error) {
    console.error("[Database] Shutdown error:", error);
    process.exitCode = 1;
  }

  console.log("[MessageX] Shutdown complete");
}

  process.once("SIGINT", () => {
    void shutdown();
  });

  process.once("SIGTERM", () => {
    void shutdown();
  });
}

startMessageX().catch(async (error: unknown) => {
  console.error("[MessageX] Startup failed:", error);

  process.exitCode = 1;

  try {
    await closeDatabase();
  } catch (shutdownError) {
    console.error("[Database] Cleanup failed:", shutdownError);
  }
});
