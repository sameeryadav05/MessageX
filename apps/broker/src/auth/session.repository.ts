import { pool } from "../database/database.js";

export interface ManagementSessionUser {
  id: string;
  username: string;
}

export async function createManagementSession(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await pool.query(
    `INSERT INTO management_sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
}

export async function getManagementSessionUser(
  tokenHash: string
): Promise<ManagementSessionUser | null> {
  const result = await pool.query<ManagementSessionUser>(
    `SELECT u.id, u.username
     FROM management_sessions s
     JOIN broker_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

export async function revokeManagementSession(
  tokenHash: string
): Promise<void> {
  await pool.query(
    "DELETE FROM management_sessions WHERE token_hash = $1",
    [tokenHash]
  );
}

export async function deleteExpiredManagementSessions(): Promise<void> {
  await pool.query(
    "DELETE FROM management_sessions WHERE expires_at <= NOW()"
  );
}
