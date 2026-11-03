
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FrameEncoder } from "../src/protocol/frame-encoder.js";
import { FrameDecoder } from "../src/protocol/frame-decoder.js";

describe("MessageX Frame Protocol", () => {
  it("should encode and decode a complete frame", () => {
    const message = {
      version: 1,
      type: "COMMAND",
      command: "CONNECT",
      requestId: "req-001",
      payload: {
        clientName: "order-service"
      }
    };

    const encoded = FrameEncoder.encode(message);

    const decoder = new FrameDecoder();

    const frames = decoder.push(encoded);

    assert.equal(frames.length, 1);

    const decoded = JSON.parse(frames[0].toString("utf8"));

    assert.deepEqual(decoded, message);
  });

  it("should handle fragmented TCP data", () => {
    const message = {
      version: 1,
      type: "COMMAND",
      command: "PING"
    };

    const encoded = FrameEncoder.encode(message);

    const decoder = new FrameDecoder();

    const firstChunk = encoded.subarray(0, 3);

    const secondChunk = encoded.subarray(3, 8);

    const thirdChunk = encoded.subarray(8);

    assert.equal(decoder.push(firstChunk).length, 0);

    assert.equal(decoder.push(secondChunk).length, 0);

    const frames = decoder.push(thirdChunk);

    assert.equal(frames.length, 1);

    assert.deepEqual(
      JSON.parse(frames[0].toString("utf8")),
      message
    );
  });

  it("should decode multiple frames from one TCP chunk", () => {
    const message1 = { command: "PING", id: 1 };

    const message2 = { command: "PONG", id: 2 };

    const decoder = new FrameDecoder();

    const combined = Buffer.concat([
      FrameEncoder.encode(message1),
      FrameEncoder.encode(message2)
    ]);

    const frames = decoder.push(combined);

    assert.equal(frames.length, 2);

    assert.deepEqual(
      JSON.parse(frames[0].toString("utf8")),
      message1
    );

    assert.deepEqual(
      JSON.parse(frames[1].toString("utf8")),
      message2
    );
  });

  it("should reject an empty frame", () => {
    const decoder = new FrameDecoder();

    const invalidHeader = Buffer.alloc(4);

    assert.throws(
      () => decoder.push(invalidHeader),
      /Invalid frame length/
    );
  });

  it("should reject an oversized frame", () => {
    const decoder = new FrameDecoder();

    const invalidHeader = Buffer.alloc(4);

    invalidHeader.writeUInt32BE(2 * 1024 * 1024, 0);

    assert.throws(
      () => decoder.push(invalidHeader),
      /Invalid frame length/
    );
  });

  it("should correctly handle UTF-8 characters", () => {
    const message = {
      text: "Hello MessageX 😊 नमस्ते"
    };

    const encoded = FrameEncoder.encode(message);

    const decoder = new FrameDecoder();

    const frames = decoder.push(encoded);

    const decoded = JSON.parse(frames[0].toString("utf8"));

    assert.deepEqual(decoded, message);
  });
});
