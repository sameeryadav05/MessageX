import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { MessageX } from "../dist/index.js";
import { FrameDecoder, encodeFrame } from "../dist/frame.js";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function waitFor(predicate, message, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 5);
  });
}

test("nack sends the requested requeue option", async (t) => {
  const nackPayloads = [];
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();

    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const command = JSON.parse(frame.toString("utf8"));
        let payload = {};

        if (command.command === "AUTH") payload = { authenticated: true };
        if (command.command === "CONSUME") {
          payload = { consumerTag: "consumer-nack", queueName: "nack-queue" };
        }
        if (command.command === "NACK") {
          nackPayloads.push(command.payload);
          payload = { requeued: command.payload.requeue };
        }

        socket.write(encodeFrame({
          version: 1,
          type: "RESPONSE",
          requestId: command.requestId,
          success: true,
          payload
        }));

        if (command.command === "CONSUME") {
          for (const [index, requeue] of [true, false].entries()) {
            socket.write(encodeFrame({
              version: 1,
              type: "EVENT",
              event: "MESSAGE_DELIVERED",
              payload: {
                consumerTag: "consumer-nack",
                queueName: "nack-queue",
                messageId: `message-${index}`,
                deliveryTag: `delivery-${index}`,
                body: { index },
                headers: {},
                routingKey: "test",
                deliveryCount: index + 1,
                createdAt: new Date().toISOString(),
                requeue
              }
            }));
          }
        }
      }
    });
  });

  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const client = new MessageX({
    host: "127.0.0.1",
    port: address.port,
    username: "test-user",
    password: "test-password",
    requestTimeout: 1_000
  });

  t.after(async () => {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  });

  await client.connect();

  let handled = 0;
  const subscription = await client.consume({
    queueName: "nack-queue",
    onMessage: async (message) => {
      const requeue = handled === 0;
      handled += 1;
      await message.nack({ requeue });
    }
  });

  await waitFor(() => nackPayloads.length === 2, "expected two NACK commands");
  assert.deepEqual(nackPayloads.map((payload) => payload.requeue), [true, false]);
  await subscription.cancel();
});

test("consumer callbacks are cleared after disconnect and reconnect", async (t) => {
  const sockets = [];
  let connectionCount = 0;

  const server = net.createServer((socket) => {
    connectionCount += 1;
    sockets.push(socket);
    const decoder = new FrameDecoder();

    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const command = JSON.parse(frame.toString("utf8"));
        let payload = {};

        if (command.command === "AUTH") payload = { authenticated: true };
        if (command.command === "CONSUME") {
          payload = { consumerTag: "old-consumer", queueName: "reconnect-queue" };
        }

        socket.write(encodeFrame({
          version: 1,
          type: "RESPONSE",
          requestId: command.requestId,
          success: true,
          payload
        }));
      }
    });
  });

  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const client = new MessageX({
    host: "127.0.0.1",
    port: address.port,
    username: "test-user",
    password: "test-password",
    requestTimeout: 1_000
  });

  t.after(async () => {
    await client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  let callbackCalls = 0;
  await client.connect();
  await client.consume({
    queueName: "reconnect-queue",
    onMessage: () => { callbackCalls += 1; }
  });

  const disconnected = new Promise((resolve) => client.once("disconnect", resolve));
  sockets[0].destroy();
  await disconnected;

  await client.connect();
  assert.equal(connectionCount, 2);

  const warning = new Promise((resolve) => client.once("warning", resolve));
  sockets[1].write(encodeFrame({
    version: 1,
    type: "EVENT",
    event: "MESSAGE_DELIVERED",
    payload: {
      consumerTag: "old-consumer",
      queueName: "reconnect-queue",
      messageId: "stale-message",
      deliveryTag: "stale-delivery",
      body: { shouldNotBeHandled: true },
      headers: {},
      routingKey: "test",
      deliveryCount: 1,
      createdAt: new Date().toISOString()
    }
  }));

  await warning;
  assert.equal(callbackCalls, 0);
});
