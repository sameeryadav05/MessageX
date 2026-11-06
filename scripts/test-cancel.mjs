
import net from "node:net";
import { randomUUID } from "node:crypto";

const queueName = process.argv[2];

if (!queueName) {
  console.error("Usage: node scripts/test-cancel.mjs <queueName>");
  process.exit(1);
}

const socket = net.createConnection({
  host: "127.0.0.1",
  port: 5678
});

let buffer = Buffer.alloc(0);
const pending = new Map();
let deliveryHandled = false;

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

    if (buffer.length < 4 + length) {
      break;
    }

    const body = buffer.subarray(4, 4 + length);
    buffer = buffer.subarray(4 + length);

    const message = JSON.parse(body.toString("utf8"));

    if (message.type === "EVENT") {
      if (
        message.event === "MESSAGE_DELIVERED" &&
        !deliveryHandled
      ) {
        deliveryHandled = true;
        handleDelivery(message.payload);
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

async function handleDelivery(payload) {
  try {
    console.log("\nMESSAGE DELIVERED:");
    console.dir(payload, { depth: null });

    console.log("\nCancelling consumer...");

    const cancelResponse = await sendCommand("CANCEL", {
      consumerTag: payload.consumerTag
    });

    console.log("\nCANCEL successful:");
    console.dir(cancelResponse, { depth: null });

    console.log("\nACKing in-flight message after cancellation...");

    const ackResponse = await sendCommand("ACK", {
      deliveryTag: payload.deliveryTag
    });

    console.log("\nACK after CANCEL successful:");
    console.dir(ackResponse, { depth: null });

    console.log("\nCANCEL TEST PASSED");

    socket.end();
  } catch (error) {
    console.error("\nCANCEL TEST FAILED:", error.message);

    socket.destroy();
    process.exitCode = 1;
  }
}

socket.on("connect", async () => {
  try {
    await sendCommand("CONNECT", {
      clientName: "messagex-cancel-test"
    });

    console.log("Connected to MessageX");

    const response = await sendCommand("CONSUME", {
      queueName
    });

    console.log("\nConsumer registered:");
    console.dir(response.payload, { depth: null });

    console.log("\nWaiting for a message...");
  } catch (error) {
    console.error("Test setup failed:", error.message);

    socket.destroy();
    process.exitCode = 1;
  }
});

socket.on("error", (error) => {
  console.error("Socket error:", error.message);
});

socket.on("close", () => {
  console.log("TCP connection closed");
});
