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

    let bindingsResult;

    if (exchange.type === "direct") {
      bindingsResult = await client.query<{ queue_id: string }>(
        `SELECT DISTINCT queue_id
         FROM bindings
         WHERE exchange_id = $1 AND routing_key = $2`,
        [exchange.id, routingKey]
      );
    } else {
      bindingsResult = await client.query<{ queue_id: string }>(
        `SELECT DISTINCT queue_id
         FROM bindings
         WHERE exchange_id = $1`,
        [exchange.id]
      );
    }

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