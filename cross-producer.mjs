import { MessageX } from "./packages/javascript-sdk/dist/index.js";

const client = new MessageX({
  host: "127.0.0.1",
  port: 5678,
  username: process.env.MESSAGEX_USER,
  password: process.env.MESSAGEX_PASSWORD
});

try {
  await client.connect();

  const result = await client.publish({
    exchangeName: "cross-language-js-test",
    routingKey: "cross.javascript",
    message: {
      source: "javascript",
      message: "Hello from JavaScript to Python!",
      test: "cross-language"
    },
    headers: { language: "javascript" }
  });

  console.log("JavaScript publish result:", result);
} catch (error) {
  console.error("Producer failed:", error);
  process.exitCode = 1;
} finally {
  await client.close();
}