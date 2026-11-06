
import express from "express";
import type { Server } from "node:http";
import { getAllExchanges } from "../exchanges/exchange.repository.js";
import {
  getAllQueues,
  getQueueByName
} from "../queues/queue.repository.js";

const app = express();

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

export function startHttpServer(port: number): Server {
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
