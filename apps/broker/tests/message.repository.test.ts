
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { pool } from "../src/database/database.js";
import { declareQueue } from "../src/queues/queue.repository.js";
import {
  acknowledgeMessage,
  claimNextMessage,
  releaseMessage,
  requeueExpiredMessages,
  requeueMessagesForConnection,
  publishMessage
} from "../src/messages/message.repository.js";

import { declareExchange } from "../src/exchanges/exchange.repository.js";
import { bindQueueToExchange } from "../src/bindings/binding.repository.js";


const createdQueues: string[] = [];

async function createQueue(
  options: {
    maxDeliveryCount?: number;
    deadLetterQueue?: string;
  } = {}
) {
  const name = `test-${randomUUID()}`;

  const queue = await declareQueue({
    name,
    ...options
  });

  createdQueues.push(name);

  return queue;
}

const createdExchanges: string[] = [];

async function createExchange(
  type: "direct" | "fanout" | "topic" | "headers"
) {
  const name = `test-exchange-${randomUUID()}`;

  const exchange = await declareExchange({
    name,
    type
  });

  createdExchanges.push(name);

  return exchange;
}

async function getQueueMessages(queueId: string) {
  const result = await pool.query<{
    id: string;
    payload: Buffer;
    headers: Record<string, unknown>;
    routing_key: string;
  }>(
    `SELECT id, payload, headers, routing_key
     FROM messages
     WHERE queue_id = $1
     ORDER BY created_at ASC, id ASC`,
    [queueId]
  );

  return result.rows;
}

async function insertMessage(queueId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO messages (
       queue_id,
       payload,
       headers,
       routing_key
     )
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      queueId,
      Buffer.from(JSON.stringify({ orderId: 123 })),
      JSON.stringify({ source: "integration-test" }),
      "orders.created"
    ]
  );

  return result.rows[0]!.id;
}

async function getMessage(id: string) {
  const result = await pool.query<{
    id: string;
    queue_id: string;
    status: string;
    delivery_count: number;
    headers: Record<string, unknown>;
  }>(
    `SELECT id, queue_id, status, delivery_count, headers
     FROM messages
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] ?? null;
}

describe("Message Repository Integration Tests", () => {
  after(async () => {
    // Delete only exchanges created by this test suite.
    // Deleting exchanges also removes their bindings through ON DELETE CASCADE.
    for (const exchangeName of createdExchanges) {
      await pool.query(
        "DELETE FROM exchanges WHERE name = $1",
        [exchangeName]
      );
    }

    // Delete only queues created by this test suite.
    for (const queueName of createdQueues) {
      await pool.query(
        "DELETE FROM queues WHERE name = $1",
        [queueName]
      );
    }

    await pool.end();
  });

  it("claims a message and acknowledges it successfully", async () => {
    const queue = await createQueue();
    const messageId = await insertMessage(queue.id);
    const connectionId = randomUUID();

    const delivery = await claimNextMessage(
      queue.name,
      connectionId
    );

    assert.ok(delivery);
    assert.equal(delivery.id, messageId);
    assert.equal(delivery.deliveryCount, 1);

    const acknowledged = await acknowledgeMessage(
      delivery.deliveryTag,
      connectionId
    );

    assert.equal(acknowledged, true);
    assert.equal(await getMessage(messageId), null);
  });

  it("requeues a message when NACKed before the retry limit", async () => {
    const queue = await createQueue({
      maxDeliveryCount: 3
    });

    const messageId = await insertMessage(queue.id);
    const connectionId = randomUUID();

    const delivery = await claimNextMessage(
      queue.name,
      connectionId
    );

    assert.ok(delivery);

    const result = await releaseMessage(
      delivery.deliveryTag,
      connectionId,
      true
    );

    assert.equal(result.released, true);
    assert.equal(result.deadLettered, false);
    assert.equal(result.sourceQueueName, queue.name);

    const message = await getMessage(messageId);

    assert.ok(message);
    assert.equal(message.status, "ready");
    assert.equal(message.delivery_count, 1);
  });

  it("moves a message to its DLQ after retry exhaustion", async () => {
    // The DLQ must exist before declaring the source queue.
    const dlq = await createQueue();

    const sourceQueue = await createQueue({
      maxDeliveryCount: 2,
      deadLetterQueue: dlq.name
    });

    const messageId = await insertMessage(sourceQueue.id);
    const connectionId = randomUUID();

    // First delivery: retry remains available.
    const firstDelivery = await claimNextMessage(
      sourceQueue.name,
      connectionId
    );

    assert.ok(firstDelivery);
    assert.equal(firstDelivery.deliveryCount, 1);

    const firstRelease = await releaseMessage(
      firstDelivery.deliveryTag,
      connectionId,
      true
    );

    assert.equal(firstRelease.released, true);
    assert.equal(firstRelease.deadLettered, false);

    // Second delivery: retry limit is reached.
    const secondDelivery = await claimNextMessage(
      sourceQueue.name,
      connectionId
    );

    assert.ok(secondDelivery);
    assert.equal(secondDelivery.id, messageId);
    assert.equal(secondDelivery.deliveryCount, 2);

    const secondRelease = await releaseMessage(
      secondDelivery.deliveryTag,
      connectionId,
      true
    );

    assert.equal(secondRelease.released, true);
    assert.equal(secondRelease.deadLettered, true);
    assert.equal(secondRelease.sourceQueueName, sourceQueue.name);
    assert.equal(secondRelease.destinationQueueName, dlq.name);

    // Verify that the same message now belongs to the DLQ.
    const deadLetteredMessage = await getMessage(messageId);

    assert.ok(deadLetteredMessage);
    assert.equal(deadLetteredMessage.queue_id, dlq.id);
    assert.equal(deadLetteredMessage.status, "ready");
    assert.equal(deadLetteredMessage.delivery_count, 0);

    const headers = deadLetteredMessage.headers;

    assert.equal(headers["x-first-death-queue"], sourceQueue.name);
    assert.equal(headers["x-last-death-queue"], sourceQueue.name);
    assert.equal(headers["x-last-death-reason"], "max-delivery-count");

    const deathHistory = headers["x-death"] as Array<{
      queue: string;
      reason: string;
      count: number;
    }>;

    assert.equal(deathHistory.length, 1);
    assert.equal(deathHistory[0]!.queue, sourceQueue.name);
    assert.equal(deathHistory[0]!.reason, "max-delivery-count");
    assert.equal(deathHistory[0]!.count, 2);

    // Verify that the DLQ can deliver and ACK the message.
    const dlqDelivery = await claimNextMessage(
      dlq.name,
      connectionId
    );

    assert.ok(dlqDelivery);
    assert.equal(dlqDelivery.id, messageId);
    assert.equal(dlqDelivery.deliveryCount, 1);

    const acknowledged = await acknowledgeMessage(
      dlqDelivery.deliveryTag,
      connectionId
    );

    assert.equal(acknowledged, true);
    assert.equal(await getMessage(messageId), null);
  });

  it("marks a message dead when no DLQ is configured", async () => {
    const queue = await createQueue({
      maxDeliveryCount: 1
    });

    const messageId = await insertMessage(queue.id);
    const connectionId = randomUUID();

    const delivery = await claimNextMessage(
      queue.name,
      connectionId
    );

    assert.ok(delivery);
    assert.equal(delivery.deliveryCount, 1);

    const result = await releaseMessage(
      delivery.deliveryTag,
      connectionId,
      true
    );

    assert.equal(result.released, true);
    assert.equal(result.deadLettered, true);
    assert.equal(result.destinationQueueName, null);

    const message = await getMessage(messageId);

    assert.ok(message);
    assert.equal(message.status, "dead");
    assert.equal(message.queue_id, queue.id);
    assert.equal(message.delivery_count, 1);
  });

  it("discards a message when NACK uses requeue=false", async () => {
    const queue = await createQueue();
    const messageId = await insertMessage(queue.id);
    const connectionId = randomUUID();

    const delivery = await claimNextMessage(
      queue.name,
      connectionId
    );

    assert.ok(delivery);

    const result = await releaseMessage(
      delivery.deliveryTag,
      connectionId,
      false
    );

    assert.equal(result.released, true);
    assert.equal(result.deadLettered, false);
    assert.equal(await getMessage(messageId), null);
  });

  it("dead-letters an expired delivery after retry exhaustion", async () => {
    const dlq = await createQueue();

    const sourceQueue = await createQueue({
      maxDeliveryCount: 1,
      deadLetterQueue: dlq.name
    });

    const messageId = await insertMessage(sourceQueue.id);
    const connectionId = randomUUID();

    const delivery = await claimNextMessage(
      sourceQueue.name,
      connectionId
    );

    assert.ok(delivery);

    // Simulate a delivery that has exceeded its ACK timeout.
    await pool.query(
      `UPDATE messages
       SET delivered_at = NOW() - INTERVAL '10 seconds'
       WHERE id = $1`,
      [messageId]
    );

    const recovered = await requeueExpiredMessages(1);

    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]!.deliveryTag, delivery.deliveryTag);
    assert.equal(recovered[0]!.deadLettered, true);
    assert.equal(recovered[0]!.destinationQueueName, dlq.name);

    const message = await getMessage(messageId);

    assert.ok(message);
    assert.equal(message.queue_id, dlq.id);
    assert.equal(message.status, "ready");
  });

  it("applies retry limits when a consumer disconnects", async () => {
    const dlq = await createQueue();

    const sourceQueue = await createQueue({
      maxDeliveryCount: 1,
      deadLetterQueue: dlq.name
    });

    const messageId = await insertMessage(sourceQueue.id);
    const connectionId = randomUUID();

    const delivery = await claimNextMessage(
      sourceQueue.name,
      connectionId
    );

    assert.ok(delivery);

    const releasedCount = await requeueMessagesForConnection(
      connectionId
    );

    assert.equal(releasedCount, 1);

    const message = await getMessage(messageId);

    assert.ok(message);
    assert.equal(message.queue_id, dlq.id);
    assert.equal(message.status, "ready");
  });

  it("routes messages through a direct exchange using exact routing keys", async () => {
    const exchange = await createExchange("direct");

    const matchingQueue = await createQueue();
    const unmatchedQueue = await createQueue();

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: matchingQueue.name,
      routingKey: "orders.created"
    });

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: unmatchedQueue.name,
      routingKey: "orders.cancelled"
    });

    const result = await publishMessage({
      exchangeName: exchange.name,
      routingKey: "orders.created",
      message: { orderId: 101 }
    });

    assert.equal(result.routedQueues, 1);

    const matchingMessages = await getQueueMessages(matchingQueue.id);
    const unmatchedMessages = await getQueueMessages(unmatchedQueue.id);

    assert.equal(matchingMessages.length, 1);
    assert.equal(unmatchedMessages.length, 0);

    assert.deepEqual(
      JSON.parse(matchingMessages[0]!.payload.toString("utf8")),
      { orderId: 101 }
    );
  });

  it("routes messages to every bound queue through a fanout exchange", async () => {
    const exchange = await createExchange("fanout");

    const queueA = await createQueue();
    const queueB = await createQueue();
    const queueC = await createQueue();

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: queueA.name
    });

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: queueB.name
    });

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: queueC.name
    });

    const result = await publishMessage({
      exchangeName: exchange.name,
      routingKey: "anything",
      message: { event: "system.broadcast" }
    });

    assert.equal(result.routedQueues, 3);

    assert.equal((await getQueueMessages(queueA.id)).length, 1);
    assert.equal((await getQueueMessages(queueB.id)).length, 1);
    assert.equal((await getQueueMessages(queueC.id)).length, 1);
  });

  it("routes messages through topic exchange wildcard bindings", async () => {
    const exchange = await createExchange("topic");

    const singleWordQueue = await createQueue();
    const multipleWordsQueue = await createQueue();
    const unmatchedQueue = await createQueue();

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: singleWordQueue.name,
      routingKey: "orders.*"
    });

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: multipleWordsQueue.name,
      routingKey: "orders.#"
    });

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: unmatchedQueue.name,
      routingKey: "payments.#"
    });

    const result = await publishMessage({
      exchangeName: exchange.name,
      routingKey: "orders.created",
      message: { orderId: 202 }
    });

    assert.equal(result.routedQueues, 2);

    assert.equal((await getQueueMessages(singleWordQueue.id)).length, 1);
    assert.equal((await getQueueMessages(multipleWordsQueue.id)).length, 1);
    assert.equal((await getQueueMessages(unmatchedQueue.id)).length, 0);
  });

  it("routes messages through headers exchange using all and any matching", async () => {
    const exchange = await createExchange("headers");

    const allQueue = await createQueue();
    const anyQueue = await createQueue();
    const unmatchedQueue = await createQueue();

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: allQueue.name,
      arguments: {
        "x-match": "all",
        format: "json",
        region: "apac"
      }
    });

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: anyQueue.name,
      arguments: {
        "x-match": "any",
        format: "xml",
        region: "apac"
      }
    });

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: unmatchedQueue.name,
      arguments: {
        "x-match": "all",
        format: "xml",
        region: "europe"
      }
    });

    const result = await publishMessage({
      exchangeName: exchange.name,
      message: { reportId: 303 },
      headers: {
        format: "json",
        region: "apac"
      }
    });

    assert.equal(result.routedQueues, 2);

    assert.equal((await getQueueMessages(allQueue.id)).length, 1);
    assert.equal((await getQueueMessages(anyQueue.id)).length, 1);
    assert.equal((await getQueueMessages(unmatchedQueue.id)).length, 0);
  });

  it("inserts only one message when multiple bindings match the same queue", async () => {
    const exchange = await createExchange("topic");
    const queue = await createQueue();

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: queue.name,
      routingKey: "orders.*"
    });

    await bindQueueToExchange({
      exchangeName: exchange.name,
      queueName: queue.name,
      routingKey: "orders.#"
    });

    const result = await publishMessage({
      exchangeName: exchange.name,
      routingKey: "orders.created",
      message: { orderId: 404 }
    });

    assert.equal(result.routedQueues, 1);

    const messages = await getQueueMessages(queue.id);

    assert.equal(messages.length, 1);
  });

});
