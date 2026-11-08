
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { pool } from "../src/database/database.js";
import { hashPassword } from "../src/auth/password.js";

async function main(): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout
  });

  try {
    const username = (
      await rl.question("Enter username: ")
    ).trim();

    if (
      !/^[a-zA-Z0-9_-]{3,64}$/.test(username)
    ) {
      throw new Error(
        "Username must be 3-64 characters and contain only letters, numbers, underscores, or hyphens."
      );
    }

    const password = await rl.question(
      "Enter password (input will be visible): "
    );

    if (password.length < 8 || password.length > 128) {
      throw new Error(
        "Password must contain between 8 and 128 characters."
      );
    }

    const passwordHash = await hashPassword(password);

    const result = await pool.query(
      `INSERT INTO broker_users (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO NOTHING
       RETURNING id, username`,
      [username, passwordHash]
    );

    if (result.rowCount === 0) {
      throw new Error(
        `User "${username}" already exists.`
      );
    }

    console.log("\nBroker user created successfully.");
    console.log(`Username: ${result.rows[0].username}`);
    console.log(`User ID: ${result.rows[0].id}`);
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Failed to create broker user:",
    error instanceof Error ? error.message : error
  );
  process.exitCode = 1;
});
