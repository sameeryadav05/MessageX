import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const { Pool } = pg;

const username = process.env.MESSAGEX_ADMIN_USERNAME;
const password = process.env.MESSAGEX_ADMIN_PASSWORD;

if (!username || !/^[a-zA-Z0-9_-]{3,64}$/.test(username)) {
  throw new Error("Invalid MESSAGEX_ADMIN_USERNAME");
}

if (!password || password.length < 12 || password.length > 128) {
  throw new Error("Admin password must contain 12-128 characters");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

try {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);

  const passwordHash =
    `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;

  const result = await pool.query(
    `INSERT INTO broker_users (username, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (username) DO NOTHING
     RETURNING username`,
    [username, passwordHash]
  );

  if (result.rowCount === 0) {
    console.log(
      "[Bootstrap] Admin already exists; leaving credentials unchanged"
    );
  } else {
    console.log("[Bootstrap] Initial admin account created");
  }
} finally {
  await pool.end();
}
