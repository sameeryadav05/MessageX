import test from "node:test";
import assert from "node:assert/strict";
import { encodeFrame, FrameDecoder } from "../dist/frame.js";

test("encodes JSON with a four-byte big-endian length prefix", () => {
  const frame = encodeFrame({ hello: "MessageX" });
  const length = frame.readUInt32BE(0);
  assert.equal(length, frame.length - 4);
  assert.deepEqual(JSON.parse(frame.subarray(4).toString("utf8")), {
    hello: "MessageX"
  });
});

test("decodes partial and multiple frames", () => {
  const first = encodeFrame({ id: 1 });
  const second = encodeFrame({ id: 2 });
  const decoder = new FrameDecoder();

  assert.deepEqual(decoder.push(first.subarray(0, 2)), []);
  const decoded = decoder.push(Buffer.concat([
    first.subarray(2),
    second
  ]));

  assert.equal(decoded.length, 2);
  assert.deepEqual(decoded.map((frame) => JSON.parse(frame.toString())), [
    { id: 1 },
    { id: 2 }
  ]);
});

test("rejects frames larger than the configured limit", () => {
  const decoder = new FrameDecoder(4);
  const invalid = Buffer.alloc(4);
  invalid.writeUInt32BE(5, 0);
  assert.throws(() => decoder.push(invalid), /Invalid MessageX frame length/);
});