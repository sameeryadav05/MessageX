import net from "node:net";
import { randomUUID } from "node:crypto";

const socket = net.createConnection({
  host: "127.0.0.1",
  port: 5678,
});

let buffer = Buffer.alloc(0);
const pending = new Map();

function sendCommand(command, payload) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();

    pending.set(requestId, { resolve, reject });

    const message = {
      version: 1,
      type: "COMMAND",
      command,
      requestId,
      payload,
    };

    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);

    socket.write(Buffer.concat([header, body]));

    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error(`${command} timed out`));
      }
    }, 5000);
  });
}

socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (buffer.length >= 4) {
    const length = buffer.readUInt32BE(0);

    if (buffer.length < 4 + length) break;

    const body = buffer.subarray(4, 4 + length);
    buffer = buffer.subarray(4 + length);

    const response = JSON.parse(body.toString("utf8"));
    const request = pending.get(response.requestId);

    if (request) {
      pending.delete(response.requestId);

      if (response.success) {
        request.resolve(response);
      } else {
        request.reject(new Error(JSON.stringify(response.error)));
      }
    }
  }
});

socket.on("connect", async () => {
  try {
    console.log("TCP connected to MessageX");

    const connectResponse = await sendCommand("CONNECT", {
      clientName: "messagex-test-client",
    });

    console.log("CONNECT successful:", connectResponse);

    const exchangeName = `test-exchange-${Date.now()}`;

    const exchangeResponse = await sendCommand("EXCHANGE_DECLARE", {
      name: exchangeName,
      type: "direct",
      durable: true,
    });

    console.log("EXCHANGE_DECLARE successful:", exchangeResponse);
    console.log("Created exchange:", exchangeName);

    const queueName = `test-queue-${Date.now()}`;

    const queueResponse = await sendCommand("QUEUE_DECLARE", {
      name: queueName,
      durable: true,
      exclusive: false,
      autoDelete: false,
    });

    console.log("QUEUE_DECLARE successful:", queueResponse);
    console.log("Created queue:", queueName);

    const bindingResponse = await sendCommand("BIND", {
      exchangeName,
      queueName,
      routingKey: "orders.created",
    });

    console.log("BIND successful:", bindingResponse);

    const publishResponse = await sendCommand("PUBLISH", {
      exchangeName,
      routingKey: "orders.created",
      message: {
        orderId: "ORD-1001",
        amount: 2500,
        status: "created",
      },
      headers: {
        source: "test-client",
        environment: "development",
      },
    });
    console.log("PUBLISH successful:", publishResponse);

    socket.end();
  } catch (error) {
    console.error("Test failed:", error.message);
    socket.destroy();
    process.exitCode = 1;
  }
});

socket.on("error", (error) => {
  console.error("TCP error:", error.message);
  process.exitCode = 1;
});
