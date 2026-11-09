
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { CommandHandler } from "../src/commands/command.handler.js";
import { pool } from "../src/database/database.js";

import type { ClientConnection } from "../src/connection/client-connection.js";
import type { ValidatedCommand } from "../src/protocol/protocol.schema.js";

function createConnection(id = randomUUID()): ClientConnection {
  return {
    id,
    isConnected: true,
    clientName: "lifecycle-test-client",
    isAuthenticated: true,
    username: "admin"
  } as unknown as ClientConnection;
}

function createCommand(
  command: ValidatedCommand["command"],
  payload: Record<string, unknown>
): ValidatedCommand {
  return {
    version: 1,
    type: "COMMAND",
    command,
    requestId: randomUUID(),
    payload
  };
}

const handler = new CommandHandler();

const queueNames: string[] = [];
const exchangeNames: string[] = [];

describe("Queue and Exchange Lifecycle", () => {
  after(async () => {
    if (queueNames.length > 0) {
      await pool.query(
        "DELETE FROM queues WHERE name = ANY($1::text[])",
        [queueNames]
      );
    }

    if (exchangeNames.length > 0) {
      await pool.query(
        "DELETE FROM exchanges WHERE name = ANY($1::text[])",
        [exchangeNames]
      );
    }

    await pool.end();
  });

  it("deletes an existing queue", async () => {
    const queueName = `lifecycle-queue-${randomUUID()}`;
    queueNames.push(queueName);

    const connection = createConnection();

    const declared = await handler.handle(
      connection,
      createCommand("QUEUE_DECLARE", {
        name: queueName
      })
    );

    assert.equal(declared.success, true);

    const deleted = await handler.handle(
      connection,
      createCommand("QUEUE_DELETE", {
        queueName
      })
    );

    assert.equal(deleted.success, true);
    assert.equal(deleted.payload?.deleted, true);

    const result = await pool.query(
      "SELECT id FROM queues WHERE name = $1",
      [queueName]
    );

    assert.equal(result.rows.length, 0);
  });

it("rejects deletion of a nonexistent queue", async () => {
  const response = await handler.handle(
    createConnection(),
    createCommand("QUEUE_DELETE", {
      queueName: `missing-${randomUUID()}`
    })
  );

  assert.equal(response.success, false);
  assert.equal(
    response.error?.code,
    "ERR_QUEUE_NOT_FOUND"
  );
});

  it("deletes an exchange and its bindings", async () => {
    const exchangeName = `lifecycle-exchange-${randomUUID()}`;
    const queueName = `lifecycle-binding-queue-${randomUUID()}`;

    exchangeNames.push(exchangeName);
    queueNames.push(queueName);

    const connection = createConnection();

    const exchange = await handler.handle(
      connection,
      createCommand("EXCHANGE_DECLARE", {
        name: exchangeName,
        type: "direct"
      })
    );

    const queue = await handler.handle(
      connection,
      createCommand("QUEUE_DECLARE", {
        name: queueName
      })
    );

    assert.equal(exchange.success, true);
    assert.equal(queue.success, true);

    const binding = await handler.handle(
      connection,
      createCommand("BIND", {
        exchangeName,
        queueName,
        routingKey: "test.key"
      })
    );

    assert.equal(binding.success, true);

    const deleted = await handler.handle(
      connection,
      createCommand("EXCHANGE_DELETE", {
        exchangeName
      })
    );

    assert.equal(deleted.success, true);
    assert.equal(deleted.payload?.deleted, true);

    const result = await pool.query(
      `SELECT b.id
       FROM bindings b
       INNER JOIN exchanges e ON e.id = b.exchange_id
       WHERE e.name = $1`,
      [exchangeName]
    );

    assert.equal(result.rows.length, 0);
  });

  it("removes an existing binding using UNBIND", async () => {
    const exchangeName = `unbind-exchange-${randomUUID()}`;
    const queueName = `unbind-queue-${randomUUID()}`;

    exchangeNames.push(exchangeName);
    queueNames.push(queueName);

    const connection = createConnection();

    await handler.handle(
      connection,
      createCommand("EXCHANGE_DECLARE", {
        name: exchangeName,
        type: "direct"
      })
    );

    await handler.handle(
      connection,
      createCommand("QUEUE_DECLARE", {
        name: queueName
      })
    );

    const bound = await handler.handle(
      connection,
      createCommand("BIND", {
        exchangeName,
        queueName,
        routingKey: "orders.created"
      })
    );

    assert.equal(bound.success, true);

    const unbound = await handler.handle(
      connection,
      createCommand("UNBIND", {
        exchangeName,
        queueName,
        routingKey: "orders.created"
      })
    );

    assert.equal(unbound.success, true);
    assert.equal(unbound.payload?.removed, true);

    const result = await pool.query(
      `SELECT b.id
       FROM bindings b
       INNER JOIN exchanges e ON e.id = b.exchange_id
       INNER JOIN queues q ON q.id = b.queue_id
       WHERE e.name = $1 AND q.name = $2`,
      [exchangeName, queueName]
    );

    assert.equal(result.rows.length, 0);
  });

  it("prevents another connection from accessing an exclusive queue", async () => {
    const queueName = `exclusive-queue-${randomUUID()}`;
    const exchangeName = `exclusive-exchange-${randomUUID()}`;

    queueNames.push(queueName);
    exchangeNames.push(exchangeName);

    const owner = createConnection();
    const anotherConnection = createConnection();

    const declared = await handler.handle(
      owner,
      createCommand("QUEUE_DECLARE", {
        name: queueName,
        exclusive: true
      })
    );

    assert.equal(declared.success, true);

    await handler.handle(
      owner,
      createCommand("EXCHANGE_DECLARE", {
        name: exchangeName,
        type: "direct"
      })
    );

    // Another connection must not consume from the exclusive queue.
    const consume = await handler.handle(
      anotherConnection,
      createCommand("CONSUME", {
        queueName
      })
    );

    assert.equal(consume.success, false);
    assert.equal(
      consume.error?.code,
      "ERR_EXCLUSIVE_QUEUE_ACCESS"
    );

    // Another connection must not bind the exclusive queue.
    const bind = await handler.handle(
      anotherConnection,
      createCommand("BIND", {
        exchangeName,
        queueName,
        routingKey: "test"
      })
    );

    assert.equal(bind.success, false);
    assert.equal(
      bind.error?.code,
      "ERR_EXCLUSIVE_QUEUE_ACCESS"
    );

    // Another connection must not delete the exclusive queue.
    const deleteAttempt = await handler.handle(
      anotherConnection,
      createCommand("QUEUE_DELETE", {
        queueName
      })
    );

    assert.equal(deleteAttempt.success, false);
    assert.equal(
      deleteAttempt.error?.code,
      "ERR_EXCLUSIVE_QUEUE_ACCESS"
    );

    // The owner must be able to delete its own exclusive queue.
    const ownerDelete = await handler.handle(
      owner,
      createCommand("QUEUE_DELETE", {
        queueName
      })
    );

    assert.equal(ownerDelete.success, true);
    assert.equal(ownerDelete.payload?.deleted, true);
  });
});
