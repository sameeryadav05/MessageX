
import { MessageX } from "messagex-client";
import { randomUUID } from "node:crypto";

const client = new MessageX({
  host: "mq.imsameer.me",
  port: 5678,
  username: "admin",
  password: '123456789000',
  clientName: "consumer-integration-test",
});

const id = randomUUID().slice(0, 8);
const exchangeName = `consumer-test-exchange-${id}`;
const queueName = `consumer-test-queue-${id}`;
const routingKey = "orders.created";

async function main() {
  try {
    await client.connect();
    console.log("Connected and authenticated!");

    await client.exchange.declare({
      name: exchangeName,
      type: "direct",
      durable: true,
    });

    await client.queue.declare({
      name: queueName,
      durable: true,
    });

    await client.exchange.bind({
      exchangeName,
      queueName,
      routingKey,
    });

    console.log("Exchange, queue and binding created!");

    // Subscribe before publishing.
    const receivedMessage = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Message delivery timed out"));
      }, 10000);

      client.consume({
        queueName,
        onMessage: async (message) => {
          try {
            console.log("Message received:", message.body);

            await message.ack();
            console.log("Message ACK successful!");

            clearTimeout(timeout);
            resolve(message);
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        },
      }).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    console.log("Consumer subscribed!");

    const publishResult = await client.publish({
      exchangeName,
      routingKey,
      message: {
        orderId: "ORD-CONSUMER-1001",
        amount: 2500,
        status: "created",
      },
      headers: {
        source: "messagex-sdk-consumer-test",
      },
    });

    console.log("Publish result:", publishResult);

    await receivedMessage;

    console.log("\nALL PRODUCER-CONSUMER TESTS PASSED!");
  } catch (error) {
    console.error("Integration test failed:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
