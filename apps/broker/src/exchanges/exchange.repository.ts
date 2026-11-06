import { pool } from "../database/database.js";

export type ExchangeType = "direct" | "fanout" | "topic" | "headers";

export interface ExchangeOptions {
  name: string;
  type: ExchangeType;
  durable?: boolean;
}

export interface ExchangeRecord {
  id: string;
  name: string;
  type: ExchangeType;
  durable: boolean;
  created_at: Date;
}

export async function declareExchange(
  options: ExchangeOptions
): Promise<ExchangeRecord> {
  const {
    name,
    type,
    durable = true
  } = options;

  const result = await pool.query<ExchangeRecord>(
    `INSERT INTO exchanges (name, type, durable)
     VALUES ($1, $2, $3)
     ON CONFLICT (name) DO NOTHING
     RETURNING id, name, type, durable, created_at`,
    [name, type, durable]
  );

  if (result.rows.length > 0) {
    return result.rows[0]!;
  }

  const existingResult = await pool.query<ExchangeRecord>(
    `SELECT id, name, type, durable, created_at
     FROM exchanges
     WHERE name = $1`,
    [name]
  );

  const existing = existingResult.rows[0];

  if (!existing) {
    throw new Error("Exchange could not be created or retrieved");
  }

  if (existing.type !== type || existing.durable !== durable) {
    throw new Error(
      "Exchange already exists with different configuration"
    );
  }

  return existing;
}

export async function getExchangeByName(
  name: string
): Promise<ExchangeRecord | null> {
  const result = await pool.query<ExchangeRecord>(
    `SELECT id, name, type, durable, created_at
     FROM exchanges
     WHERE name = $1`,
    [name]
  );

  return result.rows[0] ?? null;
}

export async function getAllExchanges(): Promise<ExchangeRecord[]> {
  const result = await pool.query<ExchangeRecord>(
    `SELECT id, name, type, durable, created_at
     FROM exchanges
     ORDER BY created_at DESC`
  );

  return result.rows;
}