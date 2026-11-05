
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { pool } from "./database.js";

// Resolve the migrations directory.
// Works in both src/database and dist/database.
const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../migrations/", import.meta.url)
);

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();

  try {
    // Create a table to track executed migrations.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Read and sort all SQL migration files.
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      // Check whether this migration has already executed.
      const result = await client.query(
        `SELECT id FROM schema_migrations WHERE filename = $1`,
        [filename]
      );

      if (result.rowCount && result.rowCount > 0) {
        continue;
      }

      const filePath = new URL(filename, `file://${MIGRATIONS_DIR}/`);
      const sql = await readFile(filePath, "utf-8");

      console.log(`[Migration] Running ${filename}`);

      try {
        await client.query("BEGIN");

        // Execute the SQL migration.
        await client.query(sql);

        // Record successful execution.
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [filename]
        );

        await client.query("COMMIT");

        console.log(`[Migration] Completed ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");

        console.error(`[Migration] Failed ${filename}`);
        throw error;
      }
    }

    console.log("[Migration] All migrations completed");
  } finally {
    client.release();
  }
}

