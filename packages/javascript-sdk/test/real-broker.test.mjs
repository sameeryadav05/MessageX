import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MessageX } from "../dist/index.js";

const integrationEnabled = process.env.MESSAGEX_INTEGRATION === "1";

test("MessageX SDK interoperates with the real broker", {
  skip: !integrationEnabled && "Set MESSAGEX_INTEGRATION=1 to run against a real broker"
}, async () => {
  const suffix = randomUUID();
  const exchangeName = `js-sdk-integration-${suffix}`;
  const queueName = `js-sdk-integration-${suffix}`;
  const routingKey = "integration.created";
  const client = new MessageX({
    host: process.env.MESSAGEX_HOST ?? "127.0.0.1",
    port: Number(process.env.MESSAGEX_PORT ?? 5678),
    username: process.env.MESSAGEX_USER,
    password: process.env.MESSAGEX_PASSWORD,
    clientName: "messagex-js-sdk-integration-test"
  });

  let subscription;
  try {
    await client.connect();
    assert.equal(client.isAuthenticated, true);

    await client.exchange.declare({
      name: exchangeName,
      type: "direct",
      durable: true
    });
    await client.queue.declare({ name: queueName, durable: true });
    await client.exchange.bind({ exchangeName, queueName, routingKey });

    const received = [];
    let resolveMessages;
    const messagesReady = new Promise((resolve) => {
      resolveMessages = resolve;
    });

    subscription = await client.consume({
      queueName,
      onMessage: async (message) => {
        received.push(message);
        if (message.body?.kind === "retry" && message.deliveryCount === 1) {
          await message.nack({ requeue: true });
          return;
        }
        await message.ack();
        if (received.filter((item) => item.body?.kind === "retry").length >= 2) {
          resolveMessages();
        }
      }
    });

    await client.publish({
      exchangeName,
      routingKey,
      message: { kind: "retry", id: suffix },
      headers: { source: "js-sdk-integration" }
    });

    await Promise.race([
      messagesReady,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("Timed out waiting for real broker redelivery")),
        10_000
      ))
    ]);

    const attempts = received.filter((item) => item.body?.kind === "retry");
    assert.equal(attempts.length, 2);
    assert.ok(attempts[1].deliveryCount >= 2);

    await subscription.cancel();
    subscription = undefined;
    await client.exchange.unbind({ exchangeName, queueName, routingKey });
    await client.queue.delete(queueName);
    await client.exchange.delete(exchangeName);
  } finally {
    if (subscription) {
      await subscription.cancel().catch(() => {});
    }
    await client.close();
  }
});
