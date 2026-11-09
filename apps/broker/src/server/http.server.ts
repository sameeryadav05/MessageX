
import express from "express";
import type { Server } from "node:http";
import { getAllExchanges } from "../exchanges/exchange.repository.js";
import {
  getAllQueues,
  getQueueByName
} from "../queues/queue.repository.js";
import { getAllBindings } from "../bindings/binding.repository.js";
import { pool } from "../database/database.js";
import type { ConnectionManager } from "../connection/connection-manager.js";

const app = express();
let activeConnectionManager: ConnectionManager | null = null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

export function startHttpServer(
  port: number,
  connectionManager: ConnectionManager
): Server {
  activeConnectionManager = connectionManager;

  const server = app.listen(port, "127.0.0.1", () => {
    console.log(
      `[HTTP Server] Management API listening on http://127.0.0.1:${port}`
    );
  });

  server.on("error", (error) => {
    console.error("[HTTP] Server error:", error);
  });

  return server;
}