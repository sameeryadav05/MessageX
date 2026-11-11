
import { MessageX } from "messagex-client";
import "dotenv/config";

const client = new MessageX({
  host: "localhost",
  port: 5678,
  username: process.env.MESSAGEX_USER,
  password: process.env.MESSAGEX_PASSWORD,
  clientName: "dashboard-integration-test"
});

try {
  await client.connect();
  console.log("Connected to MessageX!");


const consumer = await client.consume({
  queueName: "dashboard.test.queue",

  onMessage: async (message) => {
    console.log("Received:", {
      messageId: message.messageId,
      body: message.body,
      deliveryCount: message.deliveryCount
    });

    if (message.body.id === 2002 && message.deliveryCount === 1) {
      console.log("First delivery: NACK with requeue");

      await message.nack({ requeue: true });
      return;
    }

    console.log("Redelivered: ACK");

    await message.ack();

    console.log("ACK successful!");
  }
});


  console.log("Consumer started. Waiting for messages...");
  
  process.on("SIGINT", async () => {
    await consumer.cancel();
    client.destroy();
    process.exit(0);
  });
} catch (error) {
  console.error("SDK integration test failed:", error);
  client.destroy();
  process.exit(1);
}
