import net from "node:net";
import { randomUUID } from "node:crypto";

const queueName = process.argv[2];
const requeueArg = process.argv[3] ?? "true";

if (!queueName) {
  console.error("Usage: node scripts/test-nack.mjs <queueName> <true|false>");
  process.exit(1);
}

if (!["true", "false"].includes(requeueArg)) {
  console.error("requeue must be true or false");
  process.exit(1);
}

const requeue = requeueArg === "true";

const socket = net.createConnection({
  host: "127.0.0.1",
  port: 5678
});

let buffer = Buffer.alloc(0);
const pending = new Map();
let nackSent = false;

function sendCommand(command, payload) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();

    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`${command} timed out`));
    }, 5000);

    pending.set(requestId, {
      resolve: (response) => {
        clearTimeout(timeout);
        resolve(response);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    });

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

    socket.write(Buffer.concat([header, body]));
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
      if (
        message.event === "MESSAGE_DELIVERED" &&
        !nackSent
      ) {
        nackSent = true;

        console.log("\nMessage received:");
        console.dir(message.payload, { depth: null });

        console.log(`\nSending NACK (requeue: ${requeue})...`);

        sendCommand("NACK", {
          deliveryTag: message.payload.deliveryTag,
          requeue
        })
          .then((response) => {
            console.log("\nNACK successful:");
            console.dir(response, { depth: null });
            socket.end();
          })
          .catch((error) => {
            console.error("\nNACK failed:", error.message);
            socket.destroy();
          });
      }

      continue;
    }

    const request = pending.get(message.requestId);

    if (request) {
      pending.delete(message.requestId);

      if (message.success) {
        request.resolve(message);
      } else {
        request.reject(
          new Error(JSON.stringify(message.error))
        );
      }
    }
  }
});

socket.on("connect", async () => {
  try {
    await sendCommand("CONNECT", {
      clientName: "messagex-nack-test"
    });

    console.log("Connected to MessageX");

    const response = await sendCommand("CONSUME", {
      queueName
    });

    console.log("Consumer registered:");
    console.dir(response.payload, { depth: null });

    console.log("\nWaiting for one message to NACK...");
  } catch (error) {
    console.error("NACK test failed:", error.message);
    socket.destroy();
  }
});

socket.on("error", (error) => {
  console.error("Socket error:", error.message);
});