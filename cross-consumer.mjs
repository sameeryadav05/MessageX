
import { MessageX } from "./packages/javascript-sdk/dist/index.js";

const client = new MessageX({
  host: "127.0.0.1",
  port: 5678,
  username: process.env.MESSAGEX_USER,
  password: process.env.MESSAGEX_PASSWORD
});

const exchangeName = "cross-language-test";
const queueName = "cross-language-queue";
const routingKey = "cross.test";

try {
  await client.connect();

  await client.exchange.declare({
    name: exchangeName,
    type: "direct",
    durable: true
  });

  await client.queue.declare({
    name: queueName,
    durable: true
  });

  await client.exchange.bind({
    exchangeName,
    queueName,
    routingKey
  });

  console.log("JavaScript consumer waiting for Python message...");

  const timeout = setTimeout(() => {
    console.error("Timed out waiting for Python message");
    process.exitCode = 1;
    client.close();
  }, 20000);

  const subscription = await client.consume({
    queueName,
    onMessage: async (message) => {
      try {
        console.log("Received Python message:", message.body);

        if (message.body?.source !== "python") {
          throw new Error("Unexpected message source");
        }

        await message.ack();
        console.log("Cross-language ACK successful!");

        clearTimeout(timeout);
        await subscription.cancel();
        await client.exchange.unbind({
          exchangeName,
          queueName,
          routingKey
        });
        await client.queue.delete(queueName);
        await client.exchange.delete(exchangeName);
        await client.close();
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
        clearTimeout(timeout);
        await client.close();
      }
    }
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await client.close();
}
