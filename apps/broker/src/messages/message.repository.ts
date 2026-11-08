import { randomUUID } from "node:crypto";
import { pool } from "../database/database.js";

export interface PublishMessageOptions {
  exchangeName: string;
  routingKey?: string;
  message: unknown;
  headers?: Record<string, unknown>;
}

export interface PublishMessageResult {
  exchangeName: string;
  routedQueues: number;
}

export interface DeliveredMessage {
  id: string;
  queueId: string;
  payload: unknown;
  headers: Record<string, unknown>;
  routingKey: string;
  deliveryTag: string;
  deliveryCount: number;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  queue_id: string;
  payload: Buffer;
  headers: Record<string, unknown>;
  routing_key: string;
  delivery_tag: string;
  delivery_count: number;
  created_at: Date;
}

export async function publishMessage(
  options: PublishMessageOptions
): Promise<PublishMessageResult> {
  const {
    exchangeName,
    routingKey = "",
    message,
    headers = {}
  } = options;

  const serializedMessage = JSON.stringify(message);

  if (serializedMessage === undefined) {
    throw new Error("Message must be valid JSON data");
  }

  const payload = Buffer.from(serializedMessage, "utf8");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const exchangeResult = await client.query<{
      id: string;
      name: string;
      type: string;
    }>(
      `SELECT id, name, type
       FROM exchanges
       WHERE name = $1`,
      [exchangeName]
    );

    const exchange = exchangeResult.rows[0];

    if (!exchange) {
      throw new Error(`Exchange '${exchangeName}' does not exist`);
    }

    if (exchange.type !== "direct" && exchange.type !== "fanout") {
      throw new Error(
        `Publishing to '${exchange.type}' exchanges is not supported yet`
      );
    }

    const bindingsResult = exchange.type === "direct"
      ? await client.query<{ queue_id: string }>(
          `SELECT DISTINCT queue_id
           FROM bindings
           WHERE exchange_id = $1 AND routing_key = $2`,
          [exchange.id, routingKey]
        )
      : await client.query<{ queue_id: string }>(
          `SELECT DISTINCT queue_id
           FROM bindings
           WHERE exchange_id = $1`,
          [exchange.id]
        );

    const queueIds = bindingsResult.rows.map((row) => row.queue_id);

    for (const queueId of queueIds) {
      await client.query(
        `INSERT INTO messages
          (queue_id, payload, headers, routing_key)
         VALUES ($1, $2, $3, $4)`,
        [queueId, payload, JSON.stringify(headers), routingKey]
      );
    }

    await client.query("COMMIT");

    return {
      exchangeName: exchange.name,
      routedQueues: queueIds.length
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Claims the oldest ready message from a queue.
 * The delivery is associated with the consuming TCP connection.
 */
export async function claimNextMessage(
  queueName: string,
  connectionId: string
): Promise<DeliveredMessage | null> {
  const client = await pool.connect();

  try {
    const queueResult = await client.query<{ id: string }>(
      `SELECT id FROM queues WHERE name = $1`,
      [queueName]
    );

    const queue = queueResult.rows[0];

    if (!queue) {
      throw new Error(`Queue '${queueName}' does not exist`);
    }

    const result = await client.query<MessageRow>(
      `WITH candidate AS (
         SELECT id
         FROM messages
         WHERE queue_id = $1
           AND status = 'ready'
         ORDER BY created_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE messages AS m
       SET
         status = 'in_flight',
         delivery_tag = $2,
         consumer_connection_id = $3,
         delivered_at = NOW(),
         delivery_count = delivery_count + 1
       FROM candidate
       WHERE m.id = candidate.id
       RETURNING
         m.id,
         m.queue_id,
         m.payload,
         m.headers,
         m.routing_key,
         m.delivery_tag,
         m.delivery_count,
         m.created_at`,
      [queue.id, randomUUID(), connectionId]
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      queueId: row.queue_id,
      payload: JSON.parse(row.payload.toString("utf8")) as unknown,
      headers: row.headers,
      routingKey: row.routing_key,
      deliveryTag: row.delivery_tag,
      deliveryCount: row.delivery_count,
      createdAt: row.created_at
    };
  } finally {
    client.release();
  }
}

/**
 * Permanently removes a message after a valid ACK.
 */
export async function acknowledgeMessage(
  deliveryTag: string,
  connectionId: string
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM messages
     WHERE delivery_tag = $1
       AND consumer_connection_id = $2
       AND status = 'in_flight'
     RETURNING id`,
    [deliveryTag, connectionId]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Requeues a message after NACK, or deletes it when requeue is false.
 */
export async function rejectMessage(
  deliveryTag: string,
  connectionId: string,
  requeue = true
): Promise<boolean> {
  if (!requeue) {
    const result = await pool.query(
      `DELETE FROM messages
       WHERE delivery_tag = $1
         AND consumer_connection_id = $2
         AND status = 'in_flight'
       RETURNING id`,
      [deliveryTag, connectionId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  const result = await pool.query(
    `UPDATE messages
     SET
       status = 'ready',
       delivery_tag = NULL,
       consumer_connection_id = NULL,
       delivered_at = NULL
     WHERE delivery_tag = $1
       AND consumer_connection_id = $2
       AND status = 'in_flight'
     RETURNING id`,
    [deliveryTag, connectionId]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Makes timed-out deliveries available for another consumer.
 */
export interface ExpiredDelivery {
  queueName: string;
  connectionId: string;
  deliveryTag: string;
}

/**
 * Requeues messages whose ACK timeout has expired.
 * Returns delivery details so ConsumerManager can release stale slots.
 */
export async function requeueExpiredMessages(
  timeoutSeconds: number
): Promise<ExpiredDelivery[]> {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
    throw new Error("timeoutSeconds must be a positive integer");
  }

  const result = await pool.query<{
    queue_name: string;
    connection_id: string;
    delivery_tag: string;
  }>(
    `WITH expired AS (
       SELECT
         m.id,
         m.queue_id,
         m.consumer_connection_id,
         m.delivery_tag
       FROM messages m
       WHERE m.status = 'in_flight'
         AND m.delivered_at < NOW() - ($1 * INTERVAL '1 second')
       FOR UPDATE SKIP LOCKED
     ),
     requeued AS (
       UPDATE messages m
       SET
         status = 'ready',
         delivery_tag = NULL,
         consumer_connection_id = NULL,
         delivered_at = NULL
       FROM expired e
       WHERE m.id = e.id
       RETURNING
         e.queue_id,
         e.consumer_connection_id,
         e.delivery_tag
     )
     SELECT
       q.name AS queue_name,
       r.consumer_connection_id AS connection_id,
       r.delivery_tag
     FROM requeued r
     JOIN queues q ON q.id = r.queue_id`,
    [timeoutSeconds]
  );

  return result.rows.map((row) => ({
    queueName: row.queue_name,
    connectionId: row.connection_id,
    deliveryTag: row.delivery_tag
  }));
}

/**
 * Releases all messages owned by a disconnected consumer.
 */
export async function requeueMessagesForConnection(
  connectionId: string
): Promise<number> {
  const result = await pool.query(
    `UPDATE messages
     SET
       status = 'ready',
       delivery_tag = NULL,
       consumer_connection_id = NULL,
       delivered_at = NULL
     WHERE status = 'in_flight'
       AND consumer_connection_id = $1
     RETURNING id`,
    [connectionId]
  );

  return result.rowCount ?? 0;
}