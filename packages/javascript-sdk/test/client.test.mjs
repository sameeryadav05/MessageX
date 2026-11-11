import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { MessageX } from "../dist/index.js";
import { FrameDecoder, encodeFrame } from "../dist/frame.js";

test("connects, authenticates, and handles an immediate delivery before CONSUME response", async (t) => {
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const command = JSON.parse(frame.toString("utf8"));
        const respond = (payload = {}) => socket.write(encodeFrame({
          version: 1,
          type: "RESPONSE",
          requestId: command.requestId,
          success: true,
          payload
        }));

        if (command.command === "CONNECT") {
          respond({ connectionId: "connection-1" });
        } else if (command.command === "AUTH") {
          respond({ authenticated: true });
        } else if (command.command === "CONSUME") {
          // The real broker dispatches the first message before returning the
          // CONSUME response. The SDK must not drop this event.
          socket.write(encodeFrame({
            version: 1,
            type: "EVENT",
            event: "MESSAGE_DELIVERED",
            payload: {
              consumerTag: "consumer-1",
              queueName: command.payload.queueName,
              messageId: "message-1",
              deliveryTag: "delivery-1",
              body: { hello: "world" },
              headers: {},
              routingKey: "test",
              deliveryCount: 1,
              createdAt: new Date().toISOString()
            }
          }));
          respond({ consumerTag: "consumer-1", queueName: command.payload.queueName });
        } else if (command.command === "ACK") {
          respond({ acknowledged: true });
        } else if (command.command === "CANCEL") {
          respond({ cancelled: true });
        } else {
          respond({});
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const client = new MessageX({
    host: "127.0.0.1",
    port: address.port,
    username: "test-user",
    password: "test-password",
    requestTimeout: 2_000
  });
  t.after(() => client.close());

  await client.connect();
  assert.equal(client.isAuthenticated, true);

  let received;
  const subscription = await client.consume({
    queueName: "test-queue",
    onMessage: async (message) => {
      received = message.body;
      await message.ack();
    }
  });

  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("message was not delivered")), 1_000);
    const check = setInterval(() => {
      if (received !== undefined) {
        clearTimeout(deadline);
        clearInterval(check);
        resolve();
      }
    }, 10);
  });

  assert.deepEqual(received, { hello: "world" });
  assert.equal(subscription.consumerTag, "consumer-1");
  await subscription.cancel();
  await client.close();
});
