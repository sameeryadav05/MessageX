
import net from "node:net";
import { randomUUID } from "node:crypto";

const PORT = 5678;
const TIMEOUT_MS = 65000;

class MessageXClient {
  constructor(name) {
    this.name = name;
    this.socket = net.createConnection({ host: "127.0.0.1", port: PORT });
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.events = [];

    this.connected = new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });

    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);

      while (this.buffer.length >= 4) {
        const length = this.buffer.readUInt32BE(0);

        if (this.buffer.length < 4 + length) break;

        const body = this.buffer.subarray(4, 4 + length);
        this.buffer = this.buffer.subarray(4 + length);

        const message = JSON.parse(body.toString("utf8"));

        if (message.type === "EVENT") {
          this.events.push(message);
          continue;
        }

        const request = this.pending.get(message.requestId);

        if (request) {
          this.pending.delete(message.requestId);
          clearTimeout(request.timer);

          if (message.success) {
            request.resolve(message);
          } else {
            request.reject(new Error(JSON.stringify(message.error)));
          }
        }
      }
    });
  }

  async command(command, payload) {
    await this.connected;

    return new Promise((resolve, reject) => {
      const requestId = randomUUID();

      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${command} timed out`));
      }, 10000);

      this.pending.set(requestId, { resolve, reject, timer });

      const message = {
        version: 1,
        type: "COMMAND",
        requestId,
        command,
        payload
      };

      const body = Buffer.from(JSON.stringify(message));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length, 0);

      this.socket.write(Buffer.concat([header, body]));
    });
  }

  async waitForEvent(eventName, predicate = () => true) {
    const findEvent = () => this.events.find(
      (event) => event.event === eventName && predicate(event.payload)
    );

    const existing = findEvent();
    if (existing) return existing.payload;

    return new Promise((resolve, reject) => {
      const started = Date.now();

      const check = setInterval(() => {
        const event = findEvent();

        if (event) {
          clearInterval(check);
          resolve(event.payload);
        } else if (Date.now() - started > TIMEOUT_MS) {
          clearInterval(check);
          reject(new Error(`Timed out waiting for ${eventName}`));
        }
      }, 100);
    });
  }

  close() {
    this.socket.destroy();
  }
}

const consumerA = new MessageXClient("consumer-A");
const consumerB = new MessageXClient("consumer-B");
const publisher = new MessageXClient("timeout-publisher");

async function main() {
  try {
    await Promise.all([
      consumerA.connected,
      consumerB.connected,
      publisher.connected
    ]);

    await Promise.all([
      consumerA.command("CONNECT", { clientName: "consumer-A" }),
      consumerB.command("CONNECT", { clientName: "consumer-B" }),
      publisher.command("CONNECT", { clientName: "timeout-publisher" })
    ]);

    const suffix = Date.now();
    const queueName = `ack-timeout-queue-${suffix}`;
    const exchangeName = `ack-timeout-exchange-${suffix}`;
    const routingKey = "timeout.test";

    await publisher.command("QUEUE_DECLARE", {
      name: queueName,
      durable: true,
      exclusive: false,
      autoDelete: false
    });

    await publisher.command("EXCHANGE_DECLARE", {
      name: exchangeName,
      type: "direct",
      durable: true
    });

    await publisher.command("BIND", {
      exchangeName,
      queueName,
      routingKey
    });

    await consumerA.command("CONSUME", { queueName });
    await consumerB.command("CONSUME", { queueName });

    console.log("Both consumers registered.");

    await publisher.command("PUBLISH", {
      exchangeName,
      routingKey,
      message: {
        test: "ACK timeout redelivery",
        id: `message-${suffix}`
      },
      headers: { source: "ack-timeout-test" }
    });

    console.log("Message published. Waiting for consumer A...");

    const firstDelivery = await consumerA.waitForEvent(
      "MESSAGE_DELIVERED"
    );

    console.log("\nFIRST DELIVERY:");
    console.dir(firstDelivery, { depth: null });

    console.log("\nConsumer A will not ACK.");
    console.log("Waiting for timeout recovery and consumer B...");

    const secondDelivery = await consumerB.waitForEvent(
      "MESSAGE_DELIVERED",
      (payload) => payload.messageId === firstDelivery.messageId
    );

    console.log("\nREDELIVERY TO CONSUMER B:");
    console.dir(secondDelivery, { depth: null });

    if (secondDelivery.deliveryCount <= firstDelivery.deliveryCount) {
      throw new Error("Redelivery count did not increase.");
    }

    if (secondDelivery.deliveryTag === firstDelivery.deliveryTag) {
      throw new Error("Redelivery should have a new deliveryTag.");
    }

    const ack = await consumerB.command("ACK", {
      deliveryTag: secondDelivery.deliveryTag
    });

    console.log("\nACK FROM CONSUMER B:");
    console.dir(ack, { depth: null });

    console.log("\nACK TIMEOUT TEST PASSED");
    console.log("Same message was redelivered to consumer B.");
    console.log(
      `Delivery count: ${firstDelivery.deliveryCount} -> ${secondDelivery.deliveryCount}`
    );
  } catch (error) {
    console.error("\nACK TIMEOUT TEST FAILED:", error);
    process.exitCode = 1;
  } finally {
    consumerA.close();
    consumerB.close();
    publisher.close();
  }
}

main();
