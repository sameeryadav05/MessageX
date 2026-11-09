
import express from "express";
import type { Server } from "node:http";
import { getAllExchanges } from "../exchanges/exchange.repository.js";
import {
  getAllQueues,
  getQueueByName
} from "../queues/queue.repository.js";
import { getAllBindings } from "../bindings/binding.repository.js";
import {
  pool,
  DATABASE_POOL_MAX
} from "../database/database.js";
import type { ConnectionManager } from "../connection/connection-manager.js";
import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { brokerMetrics } from "../monitoring/metrics.js";
import {
  requireManagementAuth
} from "../auth/http-auth.middleware.js";
import managementAuthRoutes from "../auth/session.routes.js";


let activeConnectionManager: ConnectionManager | null = null;

// Monitor Node.js event-loop latency.
const eventLoopMonitor = monitorEventLoopDelay({
  resolution: 20
});

eventLoopMonitor.enable();

// CPU usage baseline for interval-based measurements.
let previousCpuUsage = process.cpuUsage();
let previousCpuTime = process.hrtime.bigint();

function getProcessCpuUsage(): number {
  const currentCpuUsage = process.cpuUsage();
  const currentCpuTime = process.hrtime.bigint();

  const elapsedMicroseconds =
    Number(currentCpuTime - previousCpuTime) / 1000;

  const usedMicroseconds =
    currentCpuUsage.user - previousCpuUsage.user +
    currentCpuUsage.system - previousCpuUsage.system;

  previousCpuUsage = currentCpuUsage;
  previousCpuTime = currentCpuTime;

  if (elapsedMicroseconds <= 0) {
    return 0;
  }

  const cpuCount = Math.max(os.cpus().length, 1);

  return Number(
    ((usedMicroseconds / elapsedMicroseconds / cpuCount) * 100).toFixed(2)
  );
}

function bytesToMB(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}


const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Browser session endpoints perform their own authentication.
app.use("/api/auth", managementAuthRoutes);

// Require authentication for all remaining management API endpoints.
app.use("/api", requireManagementAuth);



app.get('/ping',(_req,res)=>{
  res.status(200).send('pong')
})

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "MessageX Management API",
    status: "healthy",
    timestamp: new Date().toISOString()
  });
});

// Get all queues
app.get("/api/queues", async (_req, res) => {
  try {
    const queues = await getAllQueues();

    res.status(200).json({
      success: true,
      count: queues.length,
      queues: queues.map((queue) => ({
        id: queue.id,
        name: queue.name,
        durable: queue.durable,
        exclusive: queue.exclusive,
        autoDelete: queue.auto_delete,
        createdAt: queue.created_at
      }))
    });
  } catch (error) {
    console.error("[HTTP] Failed to fetch queues:", error);

    res.status(500).json({
      success: false,
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to retrieve queues"
      }
    });
  }
});

// Get one queue by name
app.get("/api/queues/:name", async (req, res) => {
  try {
    const queue = await getQueueByName(req.params.name);

    if (!queue) {
      res.status(404).json({
        success: false,
        error: {
          code: "ERR_QUEUE_NOT_FOUND",
          message: "Queue not found"
        }
      });
      return;
    }

    res.status(200).json({
      success: true,
      queue: {
        id: queue.id,
        name: queue.name,
        durable: queue.durable,
        exclusive: queue.exclusive,
        autoDelete: queue.auto_delete,
        createdAt: queue.created_at
      }
    });
  } catch (error) {
    console.error("[HTTP] Failed to fetch queue:", error);

    res.status(500).json({
      success: false,
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to retrieve queue"
      }
    });
  }
});

app.get("/api/exchanges", async (_req, res) => {
  try {
    const exchanges = await getAllExchanges();

    res.status(200).json({
      success: true,
      count: exchanges.length,
      exchanges: exchanges.map((exchange) => ({
        id: exchange.id,
        name: exchange.name,
        type: exchange.type,
        durable: exchange.durable,
        createdAt: exchange.created_at
      }))
    });
  } catch (error) {
    console.error("[HTTP] Failed to fetch exchanges:", error);

    res.status(500).json({
      success: false,
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to retrieve exchanges"
      }
    });
  }
});

app.get("/api/bindings", async (_req, res) => {
  try {
    const bindings = await getAllBindings();

    res.status(200).json({
      success: true,
      count: bindings.length,
      bindings: bindings.map((binding) => ({
        id: binding.id,
        exchangeName: binding.exchange_name,
        queueName: binding.queue_name,
        routingKey: binding.routing_key
      }))
    });
  } catch (error) {
    console.error("[HTTP] Failed to fetch bindings:", error);

    res.status(500).json({
      success: false,
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to retrieve bindings"
      }
    });
  }
});


app.get("/api/overview", async (_req, res) => {
  try {
    const [
      queues,
      exchanges,
      bindings,
      messages,
      // connections
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS total FROM queues"),

      pool.query("SELECT COUNT(*)::int AS total FROM exchanges"),

      pool.query("SELECT COUNT(*)::int AS total FROM bindings"),

      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'ready')::int AS ready,
          COUNT(*) FILTER (WHERE status = 'in_flight')::int AS in_flight,
          COUNT(*) FILTER (WHERE status = 'dead')::int AS dead
        FROM messages
      `)
    ]);

    res.status(200).json({
      success: true,
      overview: {
        queues: queues.rows[0].total,
        exchanges: exchanges.rows[0].total,
        activeConnections: activeConnectionManager?.count ?? 0,
        bindings: bindings.rows[0].total,
        messages: messages.rows[0].total,
        readyMessages: messages.rows[0].ready,
        inFlightMessages: messages.rows[0].in_flight,
        deadMessages: messages.rows[0].dead
      }
    });
  } catch (error) {
    console.error("[HTTP] Failed to fetch overview:", error);

    res.status(500).json({
      success: false,
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to retrieve broker overview"
      }
    });
  }
});

app.get("/api/connections", (_req, res) => {
  const connections = activeConnectionManager?.getAll() ?? [];

  res.status(200).json({
    success: true,
    count: connections.length,
    connections: connections.map((connection) => ({
      id: connection.id,
      clientName: connection.clientName,
      username: connection.username,
      remoteAddress: connection.remoteAddress,
      remotePort: connection.remotePort,
      connected: connection.isConnected,
      authenticated: connection.isAuthenticated
    }))
  });
});

// Get message statistics for one queue
app.get("/api/queues/:name/stats", async (req, res) => {
  try {
    const result = await pool.query<{
      total: number;
      ready: number;
      in_flight: number;
      dead: number;
    }>(
      `SELECT
         COUNT(m.id)::int AS total,
         COUNT(m.id) FILTER (
           WHERE m.status = 'ready'
         )::int AS ready,
         COUNT(m.id) FILTER (
           WHERE m.status = 'in_flight'
         )::int AS in_flight,
         COUNT(m.id) FILTER (
           WHERE m.status = 'dead'
         )::int AS dead
       FROM queues q
       LEFT JOIN messages m ON m.queue_id = q.id
       WHERE q.name = $1
       GROUP BY q.id`,
      [req.params.name]
    );

    if (result.rows.length === 0) {
      res.status(404).json({
        success: false,
        error: {
          code: "ERR_QUEUE_NOT_FOUND",
          message: "Queue not found"
        }
      });
      return;
    }

    const stats = result.rows[0];

    res.status(200).json({
      success: true,
      queueName: req.params.name,
      messages: {
        total: stats.total,
        ready: stats.ready,
        inFlight: stats.in_flight,
        dead: stats.dead
      }
    });
  } catch (error) {
    console.error("[HTTP] Failed to fetch queue statistics:", error);

    res.status(500).json({
      success: false,
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to retrieve queue statistics"
      }
    });
  }
});

// Inspect messages in a queue with pagination.
app.get("/api/queues/:name/messages", async (req, res) => {
  try {
    const queueName = req.params.name;

    const limit = Number(req.query.limit ?? 20);
    const offset = Number(req.query.offset ?? 0);

    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    ) {
      res.status(400).json({
        success: false,
        error: {
          code: "ERR_INVALID_PAGINATION",
          message: "limit must be 1-100 and offset must be >= 0"
        }
      });
      return;
    }

    const queueResult = await pool.query<{ id: string }>(
      `SELECT id FROM queues WHERE name = $1`,
      [queueName]
    );

    const queue = queueResult.rows[0];

    if (!queue) {
      res.status(404).json({
        success: false,
        error: {
          code: "ERR_QUEUE_NOT_FOUND",
          message: "Queue not found"
        }
      });
      return;
    }

    const [messagesResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
           id,
           payload,
           headers,
           routing_key,
           status,
           delivery_count,
           created_at,
           delivered_at
         FROM messages
         WHERE queue_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [queue.id, limit, offset]
      ),

      pool.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total
         FROM messages
         WHERE queue_id = $1`,
        [queue.id]
      )
    ]);

    res.status(200).json({
      success: true,
      queueName,
      pagination: {
        total: countResult.rows[0].total,
        limit,
        offset,
        hasMore: offset + messagesResult.rows.length <
          countResult.rows[0].total
      },
      messages: messagesResult.rows.map((message) => ({
        id: message.id,
        payload: JSON.parse(message.payload.toString("utf8")),
        headers: message.headers,
        routingKey: message.routing_key,
        status: message.status,
        deliveryCount: message.delivery_count,
        createdAt: message.created_at,
        deliveredAt: message.delivered_at
      }))
    });
  } catch (error) {
    console.error("[HTTP] Failed to inspect messages:", error);

    res.status(500).json({
      success: false,
      error: {
        code: "ERR_INTERNAL",
        message: "Failed to inspect queue messages"
      }
    });
  }
});

// Detailed broker health and system metrics.
app.get("/api/health/detailed", async (_req, res) => {
  const memory = process.memoryUsage();

  let databaseStatus: "healthy" | "unhealthy" = "healthy";

  try {
    await pool.query("SELECT 1");
  } catch (error) {
    databaseStatus = "unhealthy";

    console.error(
      "[Health] PostgreSQL health check failed:",
      error
    );
  }

  const cpuUsage = getProcessCpuUsage();

  const totalSystemMemory = os.totalmem();
  const freeSystemMemory = os.freemem();

  const eventLoopMeanMs = Number(
    (eventLoopMonitor.mean / 1e6).toFixed(2)
  );

  const eventLoopP95Ms = Number(
    (eventLoopMonitor.percentile(95) / 1e6).toFixed(2)
  );

  const brokerStatus =
    databaseStatus === "healthy" ? "healthy" : "degraded";

  res.status(databaseStatus === "healthy" ? 200 : 503).json({
    success: databaseStatus === "healthy",
    health: {
      status: brokerStatus,
      service: "MessageX Broker",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: {
        status: databaseStatus,
        pool: {
          totalConnections: pool.totalCount,
          idleConnections: pool.idleCount,
          activeConnections: pool.totalCount - pool.idleCount,
          waitingRequests: pool.waitingCount,
          maxConnections: DATABASE_POOL_MAX
        }
      },
      connections: {
        active: activeConnectionManager?.count ?? 0
      }
    },
    resources: {
      process: {
        cpuUsagePercent: cpuUsage,
        memory: {
          rssMB: bytesToMB(memory.rss),
          heapUsedMB: bytesToMB(memory.heapUsed),
          heapTotalMB: bytesToMB(memory.heapTotal),
          externalMB: bytesToMB(memory.external),
          arrayBuffersMB: bytesToMB(memory.arrayBuffers)
        }
      },
      system: {
        cpuCores: os.cpus().length,
        totalMemoryMB: bytesToMB(totalSystemMemory),
        freeMemoryMB: bytesToMB(freeSystemMemory),
        usedMemoryMB: bytesToMB(
          totalSystemMemory - freeSystemMemory
        ),
        memoryUsagePercent: Number(
          (
            ((totalSystemMemory - freeSystemMemory) /
              totalSystemMemory) *
            100
          ).toFixed(2)
        )
      },
      eventLoop: {
        meanDelayMs: eventLoopMeanMs,
        p95DelayMs: eventLoopP95Ms
      }
    }
  });
});


// Broker message throughput and performance counters.
app.get("/api/metrics", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "MessageX Broker",
    timestamp: new Date().toISOString(),
    metrics: brokerMetrics.getSnapshot()
  });
});

// PostgreSQL connection pool statistics.
app.get("/api/database/pool", (_req, res) => {
  res.status(200).json({
    success: true,
    database: "PostgreSQL",
    pool: {
      totalConnections: pool.totalCount,
      idleConnections: pool.idleCount,
      waitingRequests: pool.waitingCount,
      maxConnections: DATABASE_POOL_MAX,
      activeConnections: pool.totalCount - pool.idleCount
    },
    timestamp: new Date().toISOString()
  });
});

// Readiness check: verifies that the broker can reach PostgreSQL.
app.get("/health/ready", async (_req, res) => {
  const checks = {
    database: "healthy" as "healthy" | "unhealthy"
  };

  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      success: true,
      status: "ready",
      service: "MessageX Broker",
      checks,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    checks.database = "unhealthy";

    console.error("[Health] Readiness check failed:", error);

    res.status(503).json({
      success: false,
      status: "not_ready",
      service: "MessageX Broker",
      checks,
      timestamp: new Date().toISOString()
    });
  }
});

export function startHttpServer(
  port: number,
  connectionManager: ConnectionManager,
  host: string = "127.0.0.1"
): Server {
  activeConnectionManager = connectionManager;

  const server = app.listen(port, host, () => {
    console.log(
      `[HTTP Server] Management API listening on ${host}:${port}`
    );
  });

  server.on("error", (error) => {
    console.error("[HTTP] Server error:", error);
  });

  return server;
}