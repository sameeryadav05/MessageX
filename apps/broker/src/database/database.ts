
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

// Load the root-level .env file.
// This path works in both src and compiled dist.
dotenv.config({
  path: fileURLToPath(
    new URL("../../../../.env", import.meta.url)
  )
});

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is missing");
}


// PostgreSQL connection pool configuration.
export const DATABASE_POOL_MAX = 10;

// Create a reusable PostgreSQL connection pool.
export const pool = new Pool({
  connectionString,
  max: DATABASE_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Handle unexpected errors on idle connections.
pool.on("error", (error: Error) => {
  console.error("[Database] Unexpected PostgreSQL error:", error);
});

// Verify the database connection.
export async function connectDatabase(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("SELECT 1");

    console.log("[Database] PostgreSQL connected successfully");
  } finally {
    client.release();
  }
}

// Gracefully close the connection pool.
export async function closeDatabase(): Promise<void> {
  await pool.end();

  console.log("[Database] PostgreSQL connection pool closed");
}
