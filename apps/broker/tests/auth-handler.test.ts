
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { CommandHandler } from "../src/commands/command.handler.js";
import { pool } from "../src/database/database.js";
import { hashPassword } from "../src/auth/password.js";

import type { ClientConnection } from "../src/connection/client-connection.js";
import type { ValidatedCommand } from "../src/protocol/protocol.schema.js";

const testUsername = `auth-test-${randomUUID()}`;
const testPassword = "MessageX_Test_Password_123!";

let testUserCreated = false;

function createConnection(connected = true): ClientConnection {
  let clientName: string | null = null;
  let authenticatedUsername: string | null = null;

  return {
    id: randomUUID(),

    get isConnected() {
      return connected;
    },

    get clientName() {
      return clientName;
    },

    get isAuthenticated() {
      return authenticatedUsername !== null;
    },

    get username() {
      return authenticatedUsername;
    },

    registerClient(name: string) {
      clientName = name;
    },

    authenticate(username: string) {
      authenticatedUsername = username;
    }
  } as unknown as ClientConnection;
}

function createCommand(
  command: ValidatedCommand["command"],
  payload: Record<string, unknown> = {}
): ValidatedCommand {
  return {
    version: 1,
    type: "COMMAND",
    command,
    requestId: randomUUID(),
    payload
  };
}

describe("MessageX Authentication Integration", () => {
  const handler = new CommandHandler();
  const connection = createConnection();

  after(async () => {
    if (testUserCreated) {
      await pool.query(
        "DELETE FROM broker_users WHERE username = $1",
        [testUsername]
      );
    }

    await pool.end();
  });

  it("creates a temporary broker user in PostgreSQL", async () => {
    const passwordHash = await hashPassword(testPassword);

    const result = await pool.query(
      `INSERT INTO broker_users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username`,
      [testUsername, passwordHash]
    );

    testUserCreated = true;

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].username, testUsername);
  });

  it("allows CONNECT before authentication", async () => {
    const response = await handler.handle(
      connection,
      createCommand("CONNECT", {
        clientName: "auth-test-client"
      })
    );

    assert.equal(response.success, true);
    assert.equal(connection.clientName, "auth-test-client");
    assert.equal(connection.isAuthenticated, false);
  });

  it("rejects invalid credentials", async () => {
    const response = await handler.handle(
      connection,
      createCommand("AUTH", {
        username: testUsername,
        password: "Wrong_Password_123!"
      })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_AUTH_FAILED");
    assert.equal(connection.isAuthenticated, false);
  });

  it("authenticates with valid PostgreSQL credentials", async () => {
    const response = await handler.handle(
      connection,
      createCommand("AUTH", {
        username: testUsername,
        password: testPassword
      })
    );

    assert.equal(response.success, true);
    assert.equal(connection.isAuthenticated, true);
    assert.equal(connection.username, testUsername);
    assert.equal(response.payload?.authenticated, true);
  });

  it("rejects broker commands from an unauthenticated connection", async () => {
    const unauthenticatedConnection = createConnection();

    await handler.handle(
      unauthenticatedConnection,
      createCommand("CONNECT", {
        clientName: "unauthenticated-client"
      })
    );

    const response = await handler.handle(
      unauthenticatedConnection,
      createCommand("QUEUE_DECLARE", {
        name: "auth-test-queue"
      })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_AUTH_REQUIRED");
  });
});
