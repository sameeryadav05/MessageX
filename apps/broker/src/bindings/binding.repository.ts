import { pool } from "../database/database.js";

export interface BindingOptions {
  exchangeName: string;
  queueName: string;
  routingKey?: string;
  arguments?: Record<string, unknown>;
}

export interface BindingRecord {
  id: string;
  exchange_id: string;
  queue_id: string;
  exchange_name: string;
  queue_name: string;
  routing_key: string;
  arguments: Record<string, unknown>;
}

export async function bindQueueToExchange(
  options: BindingOptions
): Promise<BindingRecord> {
  const {
    exchangeName,
    queueName,
    routingKey = "",
    arguments: bindingArguments = {}
  } = options;

  const serializedArguments = JSON.stringify(bindingArguments);

  const result = await pool.query<BindingRecord>(
    `INSERT INTO bindings (
       exchange_id,
       queue_id,
       routing_key,
       arguments
     )
     SELECT e.id, q.id, $3, $4::jsonb
     FROM exchanges e
     CROSS JOIN queues q
     WHERE e.name = $1 AND q.name = $2
     ON CONFLICT (
       exchange_id,
       queue_id,
       routing_key,
       arguments
     ) DO NOTHING
     RETURNING
       id,
       exchange_id,
       queue_id,
       routing_key,
       arguments,
       $1::text AS exchange_name,
       $2::text AS queue_name`,
    [exchangeName, queueName, routingKey, serializedArguments]
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
       b.routing_key,
       b.arguments
     FROM bindings b
     INNER JOIN exchanges e ON e.id = b.exchange_id
     INNER JOIN queues q ON q.id = b.queue_id
     WHERE e.name = $1
       AND q.name = $2
       AND b.routing_key = $3
       AND b.arguments = $4::jsonb`,
    [exchangeName, queueName, routingKey, serializedArguments]
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
       b.routing_key,
       b.arguments
     FROM bindings b
     INNER JOIN exchanges e ON e.id = b.exchange_id
     INNER JOIN queues q ON q.id = b.queue_id
     ORDER BY e.name, q.name, b.routing_key`
  );

  return result.rows;
}

export interface UnbindOptions {
  exchangeName: string;
  queueName: string;
  routingKey?: string;
  arguments?: Record<string, unknown>;
}

export async function unbindQueueFromExchange(
  options: UnbindOptions
): Promise<boolean> {
  const {
    exchangeName,
    queueName,
    routingKey = "",
    arguments: bindingArguments = {}
  } = options;

  const result = await pool.query(
    `DELETE FROM bindings b
     USING exchanges e, queues q
     WHERE b.exchange_id = e.id
       AND b.queue_id = q.id
       AND e.name = $1
       AND q.name = $2
       AND b.routing_key = $3
       AND b.arguments = $4::jsonb
     RETURNING b.id`,
    [
      exchangeName,
      queueName,
      routingKey,
      JSON.stringify(bindingArguments)
    ]
  );

  return (result.rowCount ?? 0) > 0;
}
