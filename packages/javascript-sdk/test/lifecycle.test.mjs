import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { MessageX } from "../dist/index.js";
import { FrameDecoder, encodeFrame } from "../dist/frame.js";

function waitFor(predicate, message, timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 5);
  });
}

test("concurrent connect calls share one TCP connection", async (t) => {
  const sockets = new Set();
  let acceptedConnections = 0;

  const server = net.createServer((socket) => {
    acceptedConnections += 1;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    const decoder = new FrameDecoder();

    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const command = JSON.parse(frame.toString("utf8"));
        const payload = command.command === "AUTH"
          ? { authenticated: true }
          : { connectionId: "connection-1" };

        socket.write(encodeFrame({
          version: 1,
          type: "RESPONSE",
          requestId: command.requestId,
          success: true,
          payload
        }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const client = new MessageX({
    host: "127.0.0.1",
    port: address.port,
    username: "test-user",
    password: "test-password",
    requestTimeout: 1_000
  });

  t.after(async () => {
    await client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  await Promise.all([client.connect(), client.connect()]);

  assert.equal(client.isAuthenticated, true);
  assert.equal(acceptedConnections, 1);
});

test("application commands are rejected before authentication completes", async (t) => {
  let authCommand;
  let publishReceived = false;
  let releaseAuth;

  const authGate = new Promise((resolve) => {
    releaseAuth = resolve;
  });

  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();

    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const command = JSON.parse(frame.toString("utf8"));

        if (command.command === "CONNECT") {
          socket.write(encodeFrame({
            version: 1,
            type: "RESPONSE",
            requestId: command.requestId,
            success: true,
            payload: { connectionId: "connection-1" }
          }));
        } else if (command.command === "AUTH") {
          authCommand = command;
          void authGate.then(() => socket.write(encodeFrame({
            version: 1,
            type: "RESPONSE",
            requestId: authCommand.requestId,
            success: true,
            payload: { authenticated: true }
          })));
        } else if (command.command === "PUBLISH") {
          publishReceived = true;
          socket.write(encodeFrame({
            version: 1,
            type: "RESPONSE",
            requestId: command.requestId,
            success: true,
            payload: { exchangeName: "test", routedQueues: 1 }
          }));
        }
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const client = new MessageX({
    host: "127.0.0.1",
    port: address.port,
    username: "test-user",
    password: "test-password",
    requestTimeout: 1_000
  });

  t.after(async () => {
    releaseAuth();
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  });

  const connecting = client.connect();
  await waitFor(() => Boolean(authCommand), "AUTH command was not received");

  await assert.rejects(
    client.publish({ exchangeName: "test", message: { hello: "world" } }),
    /authenticated/i
  );
  assert.equal(publishReceived, false);

  releaseAuth();
  await connecting;
});

test("pending requests reject when the broker closes the connection", async (t) => {
  let socketRef;

  const server = net.createServer((socket) => {
    socketRef = socket;
    const decoder = new FrameDecoder();

    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const command = JSON.parse(frame.toString("utf8"));
        if (command.command === "PUBLISH") continue;

        socket.write(encodeFrame({
          version: 1,
          type: "RESPONSE",
          requestId: command.requestId,
          success: true,
          payload: command.command === "AUTH"
            ? { authenticated: true }
            : { connectionId: "connection-1" }
        }));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const client = new MessageX({
    host: "127.0.0.1",
    port: address.port,
    username: "test-user",
    password: "test-password",
    requestTimeout: 5_000
  });

  t.after(async () => {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  });

  await client.connect();

  const pendingPublish = client.publish({
    exchangeName: "test",
    message: { hello: "world" }
  });

  socketRef.destroy();

  await assert.rejects(pendingPublish, /connection.*closed|terminated/i);
});
