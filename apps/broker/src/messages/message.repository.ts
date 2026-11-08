
import { randomUUID } from "node:crypto";
import { pool } from "../database/database.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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

export interface MessageReleaseResult {
  released: boolean;
  sourceQueueName: string | null;
  destinationQueueName: string | null;
  deadLettered: boolean;
}

export interface ExpiredDelivery {
  queueName: string;
  connectionId: string;
  deliveryTag: string;
  destinationQueueName: string | null;
  deadLettered: boolean;
}

// -----------------------------------------------------------------------------
// Publish message
// -----------------------------------------------------------------------------

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

    const bindingsResult =
      exchange.type === "direct"
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

// -----------------------------------------------------------------------------
// Claim next message
// -----------------------------------------------------------------------------

export async function claimNextMessage(
  queueName: string,
  connectionId: string
): Promise<DeliveredMessage | null> {
  const client = await pool.connect();

  try {
    const queueResult = await client.query<{ id: string }>(
      `SELECT id
       FROM queues
       WHERE name = $1`,
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

// -----------------------------------------------------------------------------
// Acknowledge message
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Release message: NACK, timeout and disconnect recovery
// -----------------------------------------------------------------------------

export async function releaseMessage(
  deliveryTag: string,
  connectionId: string,
  requeue: boolean
): Promise<MessageReleaseResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<{
      id: string;
      queue_id: string;
      queue_name: string;
      max_delivery_count: number;
      dead_letter_queue_id: string | null;
      dead_letter_queue_name: string | null;
      delivery_count: number;
      headers: Record<string, unknown>;
    }>(
      `SELECT
         m.id,
         m.queue_id,
         q.name AS queue_name,
         q.max_delivery_count,
         q.dead_letter_queue_id,
         dlq.name AS dead_letter_queue_name,
         m.delivery_count,
         m.headers
       FROM messages m
       JOIN queues q ON q.id = m.queue_id
       LEFT JOIN queues dlq ON dlq.id = q.dead_letter_queue_id
       WHERE m.delivery_tag = $1
         AND m.consumer_connection_id = $2
         AND m.status = 'in_flight'
       FOR UPDATE OF m`,
      [deliveryTag, connectionId]
    );

    const message = result.rows[0];

    if (!message) {
      await client.query("ROLLBACK");

      return {
        released: false,
        sourceQueueName: null,
        destinationQueueName: null,
        deadLettered: false
      };
    }

    // Explicit NACK with requeue=false discards the message.
    if (!requeue) {
      await client.query(
        `DELETE FROM messages
         WHERE id = $1`,
        [message.id]
      );

      await client.query("COMMIT");

      return {
        released: true,
        sourceQueueName: message.queue_name,
        destinationQueueName: null,
        deadLettered: false
      };
    }

    // delivery_count was incremented when this message was claimed.
    const exhausted =
      message.delivery_count >= message.max_delivery_count;

    // Retry limit has not been reached.
    if (!exhausted) {
      await client.query(
        `UPDATE messages
         SET
           status = 'ready',
           delivery_tag = NULL,
           consumer_connection_id = NULL,
           delivered_at = NULL
         WHERE id = $1`,
        [message.id]
      );

      await client.query("COMMIT");

      return {
        released: true,
        sourceQueueName: message.queue_name,
        destinationQueueName: message.queue_name,
        deadLettered: false
      };
    }

    // Retry limit reached and a DLQ is configured.
    if (message.dead_letter_queue_id) {
      if (message.dead_letter_queue_id === message.queue_id) {
        throw new Error(
          "A queue cannot dead-letter a message to itself"
        );
      }

      const previousDeaths = Array.isArray(message.headers["x-death"])
        ? (message.headers["x-death"] as unknown[])
        : [];

      const deathMetadata = {
        queue: message.queue_name,
        reason: "max-delivery-count",
        count: message.delivery_count,
        time: new Date().toISOString()
      };

      const updatedHeaders = {
        ...message.headers,
        "x-death": [...previousDeaths, deathMetadata],
        "x-first-death-queue":
          message.headers["x-first-death-queue"] ?? message.queue_name,
        "x-last-death-queue": message.queue_name,
        "x-last-death-reason": "max-delivery-count"
      };

      await client.query(
        `UPDATE messages
         SET
           queue_id = $2,
           headers = $3,
           status = 'ready',
           delivery_count = 0,
           delivery_tag = NULL,
           consumer_connection_id = NULL,
           delivered_at = NULL
         WHERE id = $1`,
        [
          message.id,
          message.dead_letter_queue_id,
          JSON.stringify(updatedHeaders)
        ]
      );

      await client.query("COMMIT");

      return {
        released: true,
        sourceQueueName: message.queue_name,
        destinationQueueName: message.dead_letter_queue_name,
        deadLettered: true
      };
    }

    // No DLQ configured: retain the message with status = dead.
    await client.query(
      `UPDATE messages
       SET
         status = 'dead',
         delivery_tag = NULL,
         consumer_connection_id = NULL,
         delivered_at = NULL
       WHERE id = $1`,
      [message.id]
    );

    await client.query("COMMIT");

    return {
      released: true,
      sourceQueueName: message.queue_name,
      destinationQueueName: null,
      deadLettered: true
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------------------
// Compatibility wrapper
// -----------------------------------------------------------------------------

export async function rejectMessage(
  deliveryTag: string,
  connectionId: string,
  requeue = true
): Promise<boolean> {
  const result = await releaseMessage(
    deliveryTag,
    connectionId,
    requeue
  );

  return result.released;
}

// -----------------------------------------------------------------------------
// ACK timeout recovery
// -----------------------------------------------------------------------------

export async function requeueExpiredMessages(
  timeoutSeconds: number
): Promise<ExpiredDelivery[]> {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
    throw new Error("timeoutSeconds must be a positive integer");
  }

  const expired = await pool.query<{
    delivery_tag: string;
    connection_id: string;
    queue_name: string;
  }>(
    `SELECT
       m.delivery_tag,
       m.consumer_connection_id AS connection_id,
       q.name AS queue_name
     FROM messages m
     JOIN queues q ON q.id = m.queue_id
     WHERE m.status = 'in_flight'
       AND m.delivered_at < NOW() - ($1 * INTERVAL '1 second')
     ORDER BY m.delivered_at ASC`,
    [timeoutSeconds]
  );

  const recovered: ExpiredDelivery[] = [];

  for (const row of expired.rows) {
    const result = await releaseMessage(
      row.delivery_tag,
      row.connection_id,
      true
    );

    if (result.released) {
      recovered.push({
        queueName: row.queue_name,
        connectionId: row.connection_id,
        deliveryTag: row.delivery_tag,
        destinationQueueName: result.destinationQueueName,
        deadLettered: result.deadLettered
      });
    }
  }

  return recovered;
}

// -----------------------------------------------------------------------------
// Disconnect recovery
// -----------------------------------------------------------------------------

/**
 * Releases every in-flight message owned by a disconnected connection.
 *
 * Important:
 * Each message passes through releaseMessage(), so retry limits,
 * dead-letter routing and dead status are applied consistently.
 */
export async function requeueMessagesForConnection(
  connectionId: string
): Promise<number> {
  const result = await pool.query<{
    delivery_tag: string;
  }>(
    `SELECT delivery_tag
     FROM messages
     WHERE status = 'in_flight'
       AND consumer_connection_id = $1`,
    [connectionId]
  );

  let releasedCount = 0;

  for (const row of result.rows) {
    const releaseResult = await releaseMessage(
      row.delivery_tag,
      connectionId,
      true
    );

    if (releaseResult.released) {
      releasedCount++;
    }
  }

  return releasedCount;
}
