import net from "node:net";
import { randomUUID } from "node:crypto";

const socket = net.createConnection({
  host: "127.0.0.1",
  port: 5678
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
      payload
    };

    const body = Buffer.from(JSON.stringify(message));
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

      if (response.success) request.resolve(response);
      else request.reject(new Error(JSON.stringify(response.error)));
    }
  }
});

socket.on("connect", async () => {
  try {
    const queueName = process.argv[2];

    if (!queueName) {
      throw new Error("Provide the existing queue name");
    }

    await sendCommand("CONNECT", {
      clientName: "messagex-publisher-test"
    });

    const exchangeName = `ack-test-exchange-${Date.now()}`;

    await sendCommand("EXCHANGE_DECLARE", {
      name: exchangeName,
      type: "direct",
      durable: true
    });

    await sendCommand("BIND", {
      exchangeName,
      queueName,
      routingKey: "ack.test"
    });

    const result = await sendCommand("PUBLISH", {
      exchangeName,
      routingKey: "ack.test",
      message: {
        test: "ACK verification",
        orderId: "ORD-ACK-001",
        amount: 1500
      },
      headers: {
        source: "ack-test"
      }
    });

    console.log("PUBLISH successful:");
    console.dir(result, { depth: null });
  } catch (error) {
    console.error("Publish failed:", error.message);
  } finally {
    socket.end();
  }
});

socket.on("error", (error) => {
  console.error("Socket error:", error.message);
});