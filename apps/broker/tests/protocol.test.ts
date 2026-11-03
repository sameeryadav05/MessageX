
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ProtocolParser, ProtocolParseError } from "../src/protocol/protocol.parser.js";

describe("MessageX Protocol Parser", () => {

  it("should accept a valid CONNECT command", () => {
    const message = {
      version: 1,
      type: "COMMAND",
      command: "CONNECT",
      requestId: "req-001",
      payload: {
        clientName: "order-service"
      }
    };

    const result = ProtocolParser.parse(
      Buffer.from(JSON.stringify(message))
    );

    assert.equal(result.type, "COMMAND");

    if (result.type === "COMMAND") {
      assert.equal(result.command, "CONNECT");
      assert.equal(result.requestId, "req-001");
    }
  });

  it("should reject an unsupported command", () => {
    const message = {
      version: 1,
      type: "COMMAND",
      command: "UNKNOWN",
      requestId: "req-001",
      payload: {}
    };

    assert.throws(
      () => ProtocolParser.parse(
        Buffer.from(JSON.stringify(message))
      ),
      ProtocolParseError
    );
  });

  it("should reject an unsupported protocol version", () => {
    const message = {
      version: 2,
      type: "COMMAND",
      command: "CONNECT",
      requestId: "req-001",
      payload: {}
    };

    assert.throws(
      () => ProtocolParser.parse(
        Buffer.from(JSON.stringify(message))
      ),
      ProtocolParseError
    );
  });

  it("should reject an invalid message type", () => {
    const message = {
      version: 1,
      type: "UNKNOWN",
      requestId: "req-001",
      payload: {}
    };

    assert.throws(
      () => ProtocolParser.parse(
        Buffer.from(JSON.stringify(message))
      ),
      ProtocolParseError
    );
  });

  it("should reject missing requestId", () => {
    const message = {
      version: 1,
      type: "COMMAND",
      command: "CONNECT",
      payload: {}
    };

    assert.throws(
      () => ProtocolParser.parse(
        Buffer.from(JSON.stringify(message))
      ),
      ProtocolParseError
    );
  });

  it("should reject invalid JSON", () => {
    assert.throws(
      () => ProtocolParser.parse(
        Buffer.from("{invalid json}")
      ),
      ProtocolParseError
    );
  });

  it("should reject malformed UTF-8", () => {
    const invalidPayload = Buffer.from([0xC3, 0x28]);

    assert.throws(
      () => ProtocolParser.parse(invalidPayload),
      ProtocolParseError
    );
  });

  it("should accept a valid broker event", () => {
    const message = {
      version: 1,
      type: "EVENT",
      event: "MESSAGE_DELIVERED",
      payload: {
        queue: "orders.queue"
      }
    };

    const result = ProtocolParser.parse(
      Buffer.from(JSON.stringify(message))
    );

    assert.equal(result.type, "EVENT");
  });

});
