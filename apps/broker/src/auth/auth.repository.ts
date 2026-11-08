
import { pool } from "../database/database.js";

export interface BrokerUser {
  id: string;
  username: string;
  password_hash: string;
}

export async function getBrokerUserByUsername(
  username: string
): Promise<BrokerUser | null> {
  const result = await pool.query<BrokerUser>(
    `SELECT id, username, password_hash
     FROM broker_users
     WHERE username = $1`,
    [username]
  );

  return result.rows[0] ?? null;
}
