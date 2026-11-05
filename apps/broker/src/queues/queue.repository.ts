
import { pool } from "../database/database.js";

export interface QueueOptions {
  name: string;
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
}

export interface QueueRecord {
  id: string;
  name: string;
  durable: boolean;
  exclusive: boolean;
  auto_delete: boolean;
  created_at: Date;
}

export async function declareQueue(
  options: QueueOptions
): Promise<QueueRecord> {
  const {
    name,
    durable = true,
    exclusive = false,
    autoDelete = false
  } = options;

  const result = await pool.query<QueueRecord>(
    `INSERT INTO queues (name, durable, exclusive, auto_delete)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO NOTHING
     RETURNING id, name, durable, exclusive, auto_delete, created_at`,
    [name, durable, exclusive, autoDelete]
  );

  // Queue already exists: retrieve its existing configuration.
  if (result.rows.length === 0) {
    const existing = await pool.query<QueueRecord>(
      `SELECT id, name, durable, exclusive, auto_delete, created_at
       FROM queues
       WHERE name = $1`,
      [name]
    );

    const queue = existing.rows[0];

    if (!queue) {
      throw new Error("Queue could not be created or retrieved");
    }

    // Redeclaration must use the same configuration.
    if (
      queue.durable !== durable ||
      queue.exclusive !== exclusive ||
      queue.auto_delete !== autoDelete
    ) {
      throw new Error(
        "Queue already exists with different configuration"
      );
    }

    return queue;
  }

  return result.rows[0]!;
}

export async function getQueueByName(
  name: string
): Promise<QueueRecord | null> {
  const result = await pool.query<QueueRecord>(
    `SELECT id, name, durable, exclusive, auto_delete, created_at
     FROM queues
     WHERE name = $1`,
    [name]
  );

  return result.rows[0] ?? null;
}


export async function getAllQueues(): Promise<QueueRecord[]> {
  const result = await pool.query<QueueRecord>(
    `SELECT id, name, durable, exclusive, auto_delete, created_at
     FROM queues
     ORDER BY created_at DESC`
  );

  return result.rows;
}