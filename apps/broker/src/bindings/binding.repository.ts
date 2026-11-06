import { pool } from "../database/database.js";

export interface BindingOptions {
  exchangeName: string;
  queueName: string;
  routingKey?: string;
}

export interface BindingRecord {
  id: string;
  exchange_id: string;
  queue_id: string;
  exchange_name: string;
  queue_name: string;
  routing_key: string;
}

export async function bindQueueToExchange(
  options: BindingOptions
): Promise<BindingRecord> {
  const {
    exchangeName,
    queueName,
    routingKey = ""
  } = options;

  const result = await pool.query<BindingRecord>(
    `INSERT INTO bindings (exchange_id, queue_id, routing_key)
     SELECT e.id, q.id, $3
     FROM exchanges e
     CROSS JOIN queues q
     WHERE e.name = $1 AND q.name = $2
     ON CONFLICT (exchange_id, queue_id, routing_key) DO NOTHING
     RETURNING id, exchange_id, queue_id, routing_key,
               $1::text AS exchange_name,
               $2::text AS queue_name`,
    [exchangeName, queueName, routingKey]
  );

  if (result.rows.length > 0) {
    return result.rows[0]!;
  }

  const existingResult = await pool.query<BindingRecord>(
    `SELECT
       b.id,
       b.exchange_id,
       b.queue_id,
       e.name AS exchange_name,
       q.name AS queue_name,
       b.routing_key
     FROM bindings b
     INNER JOIN exchanges e ON e.id = b.exchange_id
     INNER JOIN queues q ON q.id = b.queue_id
     WHERE e.name = $1
       AND q.name = $2
       AND b.routing_key = $3`,
    [exchangeName, queueName, routingKey]
  );

  const existing = existingResult.rows[0];

  if (existing) {
    return existing;
  }

  throw new Error(
    "Exchange or queue does not exist. Declare both before binding."
  );
}

export async function getAllBindings(): Promise<BindingRecord[]> {
  const result = await pool.query<BindingRecord>(
    `SELECT
       b.id,
       b.exchange_id,
       b.queue_id,
       e.name AS exchange_name,
       q.name AS queue_name,
       b.routing_key
     FROM bindings b
     INNER JOIN exchanges e ON e.id = b.exchange_id
     INNER JOIN queues q ON q.id = b.queue_id
     ORDER BY e.name, q.name, b.routing_key`
  );

  return result.rows;
}