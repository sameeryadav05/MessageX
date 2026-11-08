
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CommandHandler } from "../src/commands/command.handler.js";

import type { ClientConnection } from "../src/connection/client-connection.js";
import type { ValidatedCommand } from "../src/protocol/protocol.schema.js";

function createConnection(isConnected = true): ClientConnection {
  let clientName: string | null = null;
  let authenticatedUsername: string | null = null;

  return {
    id: "test-connection-123",

    get isConnected() {
      return isConnected;
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
    assert.equal(response.payload?.clientName, "order-service");
    assert.equal(response.payload?.connectionId, connection.id);
    assert.equal(connection.clientName, "order-service");
  });

  it("should reject an empty client name", async () => {
    const connection = createConnection();

    const response = await commandHandler.handle(
      connection,
      createCommand("CONNECT", { clientName: "" })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_INVALID_CLIENT_NAME");
  });

  it("should reject a client name longer than 64 characters", async () => {
    const connection = createConnection();

    const response = await commandHandler.handle(
      connection,
      createCommand("CONNECT", {
        clientName: "a".repeat(65)
      })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_INVALID_CLIENT_NAME");
  });

  it("should reject CONNECT when the connection is closed", async () => {
    const connection = createConnection(false);

    const response = await commandHandler.handle(
      connection,
      createCommand("CONNECT", {
        clientName: "order-service"
      })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_CONNECTION_CLOSED");
  });

  it("should reject commands without registered handlers", async () => {
    const connection = createConnection();

    // Deliberately use a command that is not registered.
    const command = {
      version: 1,
      type: "COMMAND",
      command: "UNKNOWN_COMMAND",
      requestId: "req-unknown",
      payload: {}
    } as unknown as ValidatedCommand;

    const response = await commandHandler.handle(connection, command);

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_UNKNOWN_COMMAND");
  });

  it("should reject broker commands before authentication", async () => {
    const connection = createConnection();

    await commandHandler.handle(
      connection,
      createCommand("CONNECT", {
        clientName: "order-service"
      })
    );

    const response = await commandHandler.handle(
      connection,
      createCommand("QUEUE_DECLARE", {
        name: "test-queue"
      })
    );

    assert.equal(response.success, false);
    assert.equal(response.error?.code, "ERR_AUTH_REQUIRED");
  });
});
