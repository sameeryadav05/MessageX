
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { CommandHandler } from "../src/commands/command.handler.js";
import { pool } from "../src/database/database.js";

import type { ClientConnection } from "../src/connection/client-connection.js";
import type { ValidatedCommand } from "../src/protocol/protocol.schema.js";

function createConnection(
  connected = true,
  authenticated = true
): ClientConnection {
  return {
    id: "queue-test-connection",
    isConnected: connected,
    clientName: connected ? "test-client" : null,
    isAuthenticated: authenticated,
    username: authenticated ? "admin" : null
  } as unknown as ClientConnection;
}

function createCommand(
  payload: Record<string, unknown>
): ValidatedCommand {
  return {
    version: 1,
    type: "COMMAND",
    command: "QUEUE_DECLARE",
    requestId: randomUUID(),
    payload
  };
}

describe("QUEUE_DECLARE handler", () => {
  const handler = new CommandHandler();
  const queueName = `test-queue-${randomUUID()}`;

  after(async () => {
    await pool.query("DELETE FROM queues WHERE name = $1", [queueName]);
    await pool.end();
  });

  it("rejects clients that have not connected", async () => {
    const response = await handler.handle(
      createConnection(false, true),
      createCommand({ name: queueName })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_NOT_CONNECTED");
  });

  it("rejects an empty queue name", async () => {
    const response = await handler.handle(
      createConnection(),
      createCommand({ name: " " })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_INVALID_QUEUE_NAME");
  });

  it("rejects invalid queue options", async () => {
    const response = await handler.handle(
      createConnection(),
      createCommand({
        name: queueName,
        durable: "yes"
      })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_INVALID_QUEUE_OPTIONS");
  });

  it("creates a queue in PostgreSQL", async () => {
    const response = await handler.handle(
      createConnection(),
      createCommand({
        name: queueName,
        durable: true
      })
    );

    assert.equal(response.success, true);
    assert.equal(response.payload?.queue instanceof Object, true);

    const result = await pool.query(
      "SELECT name FROM queues WHERE name = $1",
      [queueName]
    );

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].name, queueName);
  });

  it("returns the existing queue on identical redeclaration", async () => {
    const first = await handler.handle(
      createConnection(),
      createCommand({
        name: queueName,
        durable: true
      })
    );

    const second = await handler.handle(
      createConnection(),
      createCommand({
        name: queueName,
        durable: true
      })
    );

    assert.equal(first.success, true);
    assert.equal(second.success, true);
  });

  it("rejects redeclaration with different options", async () => {
    const response = await handler.handle(
      createConnection(),
      createCommand({
        name: queueName,
        durable: false
      })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_QUEUE_DECLARE_FAILED");
  });
});
