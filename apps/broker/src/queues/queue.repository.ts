
import { pool } from "../database/database.js";

export interface QueueOptions {
  name: string;
  durable?: boolean;
  exclusive?: boolean;
  autoDelete?: boolean;
  maxDeliveryCount?: number;
  deadLetterQueue?: string;
}

export interface QueueRecord {
  id: string;
  name: string;
  durable: boolean;
  exclusive: boolean;
  auto_delete: boolean;
  max_delivery_count: number;
  dead_letter_queue_id: string | null;
  dead_letter_queue_name: string | null;
  created_at: Date;
}

const QUEUE_SELECT = `
  SELECT
    q.id,
    q.name,
    q.durable,
    q.exclusive,
    q.auto_delete,
    q.max_delivery_count,
    q.dead_letter_queue_id,
    dlq.name AS dead_letter_queue_name,
    q.created_at
  FROM queues q
  LEFT JOIN queues dlq
    ON dlq.id = q.dead_letter_queue_id
`;

export async function declareQueue(
  options: QueueOptions
): Promise<QueueRecord> {
  const {
    name,
    durable = true,
    exclusive = false,
    autoDelete = false,
    maxDeliveryCount = 5,
    deadLetterQueue
  } = options;

  if (
    !Number.isInteger(maxDeliveryCount) ||
    maxDeliveryCount < 1
  ) {
    throw new Error("maxDeliveryCount must be a positive integer");
  }

  if (deadLetterQueue !== undefined) {
    if (deadLetterQueue === name) {
      throw new Error("A queue cannot be its own dead-letter queue");
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let deadLetterQueueId: string | null = null;

    if (deadLetterQueue !== undefined) {
      const dlqResult = await client.query<{ id: string }>(
        `SELECT id
         FROM queues
         WHERE name = $1`,
        [deadLetterQueue]
      );

      if (!dlqResult.rows[0]) {
        throw new Error(
          `Dead-letter queue '${deadLetterQueue}' does not exist`
        );
      }

      deadLetterQueueId = dlqResult.rows[0].id;
    }

    await client.query(
      `INSERT INTO queues (
         name,
         durable,
         exclusive,
         auto_delete,
         max_delivery_count,
         dead_letter_queue_id
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (name) DO NOTHING`,
      [
        name,
        durable,
        exclusive,
        autoDelete,
        maxDeliveryCount,
        deadLetterQueueId
      ]
    );

    const queueResult = await client.query<QueueRecord>(
      `${QUEUE_SELECT}
       WHERE q.name = $1
       FOR UPDATE OF q`,
      [name]
    );

    const queue = queueResult.rows[0];

    if (!queue) {
      throw new Error("Queue could not be created or retrieved");
    }

    // Redeclaration must use the same configuration.
    if (
      queue.durable !== durable ||
      queue.exclusive !== exclusive ||
      queue.auto_delete !== autoDelete ||
      queue.max_delivery_count !== maxDeliveryCount ||
      queue.dead_letter_queue_id !== deadLetterQueueId
    ) {
      throw new Error(
        "Queue already exists with different configuration"
      );
    }

    await client.query("COMMIT");

    return queue;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getQueueByName(
  name: string
): Promise<QueueRecord | null> {
  const result = await pool.query<QueueRecord>(
    `${QUEUE_SELECT}
     WHERE q.name = $1`,
    [name]
  );

  return result.rows[0] ?? null;
}

export async function getAllQueues(): Promise<QueueRecord[]> {
  const result = await pool.query<QueueRecord>(
    `${QUEUE_SELECT}
     ORDER BY q.created_at DESC`
  );

  return result.rows;
}
