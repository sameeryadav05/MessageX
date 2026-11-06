import net from "node:net";
import { randomUUID } from "node:crypto";

const socket = net.createConnection({
  host: "127.0.0.1",
  port: 5678
});

let buffer = Buffer.alloc(0);

function sendCommand(command, payload) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();

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

    const timeout = setTimeout(() => {
      reject(new Error(`${command} timed out`));
    }, 5000);

    const listener = (response) => {
      if (response.requestId !== requestId) return;

      clearTimeout(timeout);
      socket.off("message", listener);

      if (response.success) {
        resolve(response);
      } else {
        reject(new Error(JSON.stringify(response.error)));
      }
    };

    socket.on("message", listener);
  });
}

socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);

  while (buffer.length >= 4) {
    const length = buffer.readUInt32BE(0);

    if (buffer.length < 4 + length) break;

    const body = buffer.subarray(4, 4 + length);
    buffer = buffer.subarray(4 + length);

    const message = JSON.parse(body.toString("utf8"));

    if (message.type === "EVENT") {
      console.log("\nMESSAGE EVENT RECEIVED:");
      console.dir(message, { depth: null });
    } else {
      socket.emit("message", message);
    }
  }
});

socket.on("connect", async () => {
  try {
    await sendCommand("CONNECT", {
      clientName: "messagex-consumer-test"
    });

    console.log("Consumer connected");

    const queueName = process.argv[2];

    if (!queueName) {
      throw new Error("Provide a queue name as an argument");
    }

    const response = await sendCommand("CONSUME", {
      queueName
    });

    console.log("CONSUME successful:");
    console.dir(response, { depth: null });

    console.log("\nWaiting for messages...");

  } catch (error) {
    console.error("Consumer failed:", error.message);
    socket.destroy();
    process.exitCode = 1;
  }
});

socket.on("error", (error) => {
  console.error("Socket error:", error.message);
});