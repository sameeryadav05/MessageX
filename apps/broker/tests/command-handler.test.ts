
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CommandHandler } from "../src/commands/command.handler.js";

import type { ClientConnection } from "../src/connection/client-connection.js";
import type { ValidatedCommand } from "../src/protocol/protocol.schema.js";

// Create a mock ClientConnection for unit testing.
function createConnection(isConnected = true): ClientConnection {
  let clientName: string | null = null;

  return {
    id: "test-connection-123",

    get isConnected() {
      return isConnected;
    },

    get clientName() {
      return clientName;
    },

    registerClient(name: string) {
      clientName = name;
    }
  } as unknown as ClientConnection;
}

// Helper to create valid protocol commands.
function createCommand(
  command: ValidatedCommand["command"],
  payload: Record<string, unknown> = {}
): ValidatedCommand {
  return {
    version: 1,
    type: "COMMAND",
    command,
    requestId: "req-001",
    payload
  };
}

describe("MessageX Command Handler", () => {
  const commandHandler = new CommandHandler();

  it("should successfully handle a CONNECT command", async () => {
    const connection = createConnection();

    const command = createCommand("CONNECT", {
      clientName: "order-service"
    });

    const response = await commandHandler.handle(connection, command);

    assert.equal(response.success, true);
    assert.equal(response.type, "RESPONSE");
    assert.equal(response.requestId, "req-001");

    assert.equal(
      response.payload?.clientName,
      "order-service"
    );

    assert.equal(
      response.payload?.connectionId,
      connection.id
    );

    // Verify that client identity was saved.
    assert.equal(connection.clientName, "order-service");
  });

  it("should reject an empty client name", async () => {
    const connection = createConnection();

    const command = createCommand("CONNECT", {
      clientName: ""
    });

    const response = await commandHandler.handle(connection, command);

    assert.equal(response.success, false);

    assert.equal(
      response.error?.code,
      "ERR_INVALID_CLIENT_NAME"
    );
  });

  it("should reject a client name longer than 64 characters", async () => {
    const connection = createConnection();

    const command = createCommand("CONNECT", {
      clientName: "a".repeat(65)
    });

    const response = await commandHandler.handle(connection, command);

    assert.equal(response.success, false);

    assert.equal(
      response.error?.code,
      "ERR_INVALID_CLIENT_NAME"
    );
  });

  it("should reject CONNECT when the connection is closed", async () => {
    const connection = createConnection(false);

    const command = createCommand("CONNECT", {
      clientName: "order-service"
    });

    const response = await commandHandler.handle(connection, command);

    assert.equal(response.success, false);

    assert.equal(
      response.error?.code,
      "ERR_CONNECTION_CLOSED"
    );
  });

  it("should reject commands without registered handlers", async () => {
    const connection = createConnection();

    const command = createCommand("AUTH", {
      username: "test-user"
    });

    const response = await commandHandler.handle(connection, command);

    assert.equal(response.success, false);

    assert.equal(
      response.error?.code,
      "ERR_UNKNOWN_COMMAND"
    );
  });
});
