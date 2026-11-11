
import { MessageX } from "../dist/index.js";

const client = new MessageX({
  host: "127.0.0.1",
  port: 5678,
  username: process.env.MESSAGEX_USER,
  password: process.env.MESSAGEX_PASSWORD,
  clientName: "messagex-sdk-integration-test",
});

const suffix = Date.now();
const exchangeName = `sdk-test-exchange-${suffix}`;
const queueName = `sdk-test-queue-${suffix}`;
const routingKey = "orders.created";

try {
  console.log("1. Connecting to MessageX...");
  await client.connect();
  console.log("Connected and authenticated!");

  console.log("2. Declaring exchange...");
  console.log(await client.exchange.declare({
    name: exchangeName,
    type: "direct",
    durable: true,
  }));

  console.log("3. Declaring queue...");
  console.log(await client.queue.declare({
    name: queueName,
    durable: true,
  }));

  console.log("4. Binding queue...");
  console.log(await client.exchange.bind({
    exchangeName,
    queueName,
    routingKey,
  }));

  console.log("5. Starting consumer...");
  let resolveReceived;
  let rejectReceived;

  const receivedPromise = new Promise((resolve, reject) => {
    resolveReceived = resolve;
    rejectReceived = reject;
  });

  const timeout = setTimeout(() => {
    rejectReceived(new Error("Timed out waiting for message"));
  }, 10000);

  const subscription = await client.consume({
    queueName,
    onMessage: async (message) => {
      try {
        console.log("Received message:", message.body);
        await message.ack();
        console.log("Message ACK successful!");
        resolveReceived(message.body);
      } catch (error) {
        rejectReceived(error);
      }
    },
  });

  console.log("6. Publishing message...");
  const publishResult = await client.publish({
    exchangeName,
    routingKey,
    message: {
      orderId: "ORD-SDK-1001",
      amount: 2500,
      status: "created",
    },
    headers: {
      source: "messagex-sdk-test",
    },
  });

  console.log("Publish result:", publishResult);

  const received = await receivedPromise;
  clearTimeout(timeout);

  console.log("7. Verifying received payload...");
  if (received?.orderId !== "ORD-SDK-1001") {
    throw new Error("Received payload does not match!");
  }

  console.log("8. Cancelling consumer...");
  await subscription.cancel();

  console.log("\nALL REAL BROKER TESTS PASSED!");
} catch (error) {
  console.error("\nINTEGRATION TEST FAILED:", error);
  process.exitCode = 1;
} finally {
  await client.close();
}
