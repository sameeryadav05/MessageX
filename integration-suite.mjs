
import { MessageX } from "./packages/javascript-sdk/dist/index.js";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const HOST = process.env.MESSAGEX_HOST ?? "127.0.0.1";
const PORT = Number(process.env.MESSAGEX_PORT ?? 5678);
const USER = process.env.MESSAGEX_USER;
const PASSWORD = process.env.MESSAGEX_PASSWORD;

if (!USER || !PASSWORD) {
  console.error("Set MESSAGEX_USER and MESSAGEX_PASSWORD first.");
  process.exit(1);
}

const PYTHON = process.env.PYTHON ?? "python";
const results = [];

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

const names = {
  exchange: `suite-ex-${suffix}`,
  queue: `suite-q-${suffix}`,
  dlq: `suite-dlq-${suffix}`,
  route: `suite.route.${suffix}`,
  disconnectExchange: `suite-disconnect-ex-${suffix}`,
  disconnectQueue: `suite-disconnect-q-${suffix}`,
  timeoutExchange: `suite-timeout-ex-${suffix}`,
  timeoutQueue: `suite-timeout-q-${suffix}`,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function client(name) {
  return new MessageX({
    host: HOST,
    port: PORT,
    username: USER,
    password: PASSWORD,
    clientName: `integration-suite-${name}`,
  });
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, fn) {
  const start = Date.now();
  process.stdout.write(`\n[RUN] ${name} ... `);

  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`PASS (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`FAIL (${Date.now() - start}ms)`);
    console.error("      ", error.message);
  }
}

function pythonProcess(mode, extra = {}) {
  const code = String.raw`
import asyncio, json, os, sys
from messagex import MessageX

async def main():
    mode = os.environ["SUITE_MODE"]
    exchange = os.environ.get("SUITE_EXCHANGE", "")
    queue = os.environ.get("SUITE_QUEUE", "")
    route = os.environ.get("SUITE_ROUTE", "suite.test")

    client = MessageX(
        host=os.environ.get("MESSAGEX_HOST", "127.0.0.1"),
        port=int(os.environ.get("MESSAGEX_PORT", "5678")),
        username=os.environ["MESSAGEX_USER"],
        password=os.environ["MESSAGEX_PASSWORD"],
        client_name="messagex-integration-python-" + mode,
    )

    await client.connect()

    if mode == "consumer":
        await client.exchange.declare(exchange, "direct", durable=True)
        await client.queue.declare(queue, durable=True)
        await client.exchange.bind(exchange, queue, route)

        future = asyncio.get_running_loop().create_future()

        async def handler(message):
            await message.ack()
            print("RESULT:" + json.dumps(message.body), flush=True)
            if not future.done():
                future.set_result(message.body)

        sub = await client.consume(queue, handler)
        print("READY", flush=True)
        await asyncio.wait_for(future, timeout=60)
        await sub.cancel()
        await client.close()
        return

    if mode == "producer":
        result = await client.publish(
            exchange,
            {"source": "python", "test": "cross-language",
             "message": "Python producer"},
            routing_key=route,
            headers={"language": "python"},
        )
        print("RESULT:" + json.dumps({
            "routedQueues": result.routed_queues
        }), flush=True)
        await client.close()
        return

    if mode == "dlq-consumer":
        future = asyncio.get_running_loop().create_future()

        async def handler(message):
            await message.ack()
            print("RESULT:" + json.dumps({
                "body": message.body,
                "headers": message.headers
            }), flush=True)
            if not future.done():
                future.set_result(message.body)

        sub = await client.consume(queue, handler)
        print("READY", flush=True)
        await asyncio.wait_for(future, timeout=60)
        await sub.cancel()
        await client.close()
        return

    if mode == "disconnect-consumer":
        await client.queue.declare(queue, durable=True)
        sub = await client.consume(queue, lambda message: None)
        print("READY", flush=True)

        async def handler(message):
            print("RECEIVED_UNACKED", flush=True)
            # Deliberately terminate without ACK/NACK to simulate a crash.
            os._exit(0)

        # Replace the consumer callback using a separate client below is not
        # possible; this mode is implemented in the dedicated branch above.
        await asyncio.Event().wait()
        return

    if mode == "timeout-consumer":
        future = asyncio.get_running_loop().create_future()

        async def handler(message):
            print("UNACKED:" + json.dumps(message.body), flush=True)
            if not future.done():
                future.set_result(True)
            # Intentionally do not ACK or NACK.
            await asyncio.Event().wait()

        sub = await client.consume(queue, handler)
        print("READY", flush=True)
        await future
        await asyncio.Event().wait()
        return

    await client.close()
    raise RuntimeError("Unknown Python mode: " + mode)

asyncio.run(main())
`;

  const child = spawn(PYTHON, ["-u", "-c", code], {
    env: {
      ...process.env,
      MESSAGEX_HOST: HOST,
      MESSAGEX_PORT: String(PORT),
      MESSAGEX_USER: USER,
      MESSAGEX_PASSWORD: PASSWORD,
      SUITE_MODE: mode,
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = [];
  const rl = readline.createInterface({ input: child.stdout });

  rl.on("line", (line) => {
    lines.push(line);
    console.log(`      [Python] ${line}`);
  });

  child.stderr.on("data", (data) => {
    process.stderr.write(`      [Python error] ${data}`);
  });

  function waitForLine(prefix, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const existing = lines.find((line) => line.startsWith(prefix));
      if (existing) return resolve(existing);

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Python process did not print ${prefix}`));
      }, timeout);

      const onLine = (line) => {
        if (line.startsWith(prefix)) {
          cleanup();
          resolve(line);
        }
      };

      const onExit = (code) => {
        cleanup();
        reject(new Error(`Python process exited early (${code})`));
      };

      function cleanup() {
        clearTimeout(timer);
        rl.off("line", onLine);
        child.off("exit", onExit);
      }

      rl.on("line", onLine);
      child.on("exit", onExit);
    });
  }

  return { child, lines, waitForLine };
}

async function topology(c, exchange, queue, route, options = {}) {
  await c.exchange.declare({
    name: exchange,
    type: "direct",
    durable: true,
  });

  await c.queue.declare({
    name: queue,
    durable: true,
    ...options,
  });

  await c.exchange.bind({
    exchangeName: exchange,
    queueName: queue,
    routingKey: route,
  });
}

async function main() {
  console.log("\n======================================");
  console.log("       MessageX Integration Suite");
  console.log("======================================");
  console.log(`Broker: ${HOST}:${PORT}`);
  console.log(`Test ID: ${suffix}`);

  // 1. JavaScript connection and authentication.
  await test("JavaScript connection and authentication", async () => {
    const c = client("connection");
    try {
      await c.connect();
      check(c.isConnected, "Not connected");
      check(c.isAuthenticated, "Not authenticated");
    } finally {
      await c.close();
    }
  });

  // 2. Python SDK connection.
  await test("Python SDK connection and authentication", async () => {
    const p = pythonProcess("producer", {
      SUITE_EXCHANGE: "unused-suite-exchange",
    });

    // The producer must not publish to a nonexistent exchange.
    // Test connection separately with a Python process that declares topology.
    p.child.kill();
    await sleep(300);
    const probe = pythonProcess("consumer", {
      SUITE_EXCHANGE: names.exchange,
      SUITE_QUEUE: names.queue,
      SUITE_ROUTE: names.route,
    });

    try {
      await probe.waitForLine("READY");
    } finally {
      probe.child.kill();
    }
  });

  // 3. Python producer -> JavaScript consumer.
  await test("Python producer -> JavaScript consumer", async () => {
    const c = client("python-to-js");
    let sub;
    try {
      await c.connect();
      await topology(c, names.exchange, names.queue, names.route);

      const received = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("No Python message received")),
          15000
        );

        c.consume({
          queueName: names.queue,
          onMessage: async (message) => {
            clearTimeout(timer);
            await message.ack();
            resolve(message.body);
          },
        }).then((s) => { sub = s; }).catch(reject);
      });

      const p = pythonProcess("producer", {
        SUITE_EXCHANGE: names.exchange,
        SUITE_ROUTE: names.route,
      });

      await p.waitForLine("RESULT:");
      const body = await received;
      check(body.source === "python", "Unexpected producer");
      check(body.test === "cross-language", "Payload mismatch");
    } finally {
      if (sub) await sub.cancel().catch(() => {});
      await c.close();
    }
  });

  // 4. JavaScript producer -> Python consumer.
  await test("JavaScript producer -> Python consumer", async () => {
    const p = pythonProcess("consumer", {
      SUITE_EXCHANGE: names.exchange,
      SUITE_QUEUE: names.queue,
      SUITE_ROUTE: names.route,
    });

    const c = client("js-to-python");
    try {
      await p.waitForLine("READY");
      await c.connect();

      const result = await c.publish({
        exchangeName: names.exchange,
        routingKey: names.route,
        message: {
          source: "javascript",
          test: "cross-language",
          message: "JavaScript producer",
        },
      });

      check(result.routedQueues === 1, "Expected one routed queue");
      const line = await p.waitForLine("RESULT:", 15000);
      const body = JSON.parse(line.slice(7));
      check(body.source === "javascript", "Wrong producer");
    } finally {
      p.child.kill();
      await c.close();
    }
  });

  // 5. NACK/requeue and redelivery.
  await test("NACK and requeue redelivery", async () => {
    const ex = `${names.exchange}-retry`;
    const q = `${names.queue}-retry`;
    const route = `${names.route}.retry`;
    const c = client("nack-requeue");
    let sub;

    try {
      await c.connect();
      await topology(c, ex, q, route);

      const attempts = [];
      let resolve;
      const received = new Promise((r) => { resolve = r; });

      sub = await c.consume({
        queueName: q,
        onMessage: async (message) => {
          attempts.push(message.deliveryCount);

          if (attempts.length === 1) {
            await message.nack({ requeue: true });
          } else {
            await message.ack();
            resolve();
          }
        },
      });

      await c.publish({
        exchangeName: ex,
        routingKey: route,
        message: { test: "nack-requeue" },
      });

      await Promise.race([
        received,
        sleep(15000).then(() => {
          throw new Error("Redelivery timeout");
        }),
      ]);

      check(attempts.length === 2, `Expected 2 attempts, got ${attempts.length}`);
      check(attempts[1] >= 2, "Delivery count did not increase");

      await sub.cancel();
      sub = undefined;
      await c.exchange.unbind({ exchangeName: ex, queueName: q, routingKey: route });
      await c.queue.delete(q);
      await c.exchange.delete(ex);
    } finally {
      if (sub) await sub.cancel().catch(() => {});
      await c.close();
    }
  });

  // 6. Retry exhaustion -> DLQ, JavaScript source consumer -> Python DLQ consumer.
  await test("Retry exhaustion and cross-language dead-letter queue", async () => {
    const ex = `${names.exchange}-dlq`;
    const q = `${names.queue}-dlq`;
    const dlq = `${names.dlq}-cross`;
    const route = `${names.route}.dlq`;

    const setup = client("dlq-setup");
    const worker = client("dlq-worker");
    let workerSub;
    const python = pythonProcess("dlq-consumer", {
      SUITE_QUEUE: dlq,
    });

    try {
      await setup.connect();
      await setup.exchange.declare({
        name: ex,
        type: "direct",
        durable: true,
      });
      await setup.queue.declare({ name: dlq, durable: true });
      await setup.queue.declare({
        name: q,
        durable: true,
        maxDeliveryCount: 3,
        deadLetterQueue: dlq,
      });
      await setup.exchange.bind({
        exchangeName: ex,
        queueName: q,
        routingKey: route,
      });

      await python.waitForLine("READY");

      await worker.connect();
      let attempts = 0;

      workerSub = await worker.consume({
        queueName: q,
        onMessage: async (message) => {
          attempts++;
          console.log(`      [JS worker] attempt ${message.deliveryCount}`);
          await message.nack({ requeue: true });
        },
      });

      await setup.publish({
        exchangeName: ex,
        routingKey: route,
        message: { test: "dead-letter", origin: "javascript" },
      });

      const line = await python.waitForLine("RESULT:", 30000);
      const result = JSON.parse(line.slice(7));

      check(attempts === 3, `Expected 3 attempts, got ${attempts}`);
      check(result.body.test === "dead-letter", "DLQ payload mismatch");
      check(
        result.headers["x-last-death-reason"] === "max-delivery-count",
        "Missing dead-letter reason header"
      );

      await workerSub.cancel();
      workerSub = undefined;
      await setup.exchange.unbind({
        exchangeName: ex,
        queueName: q,
        routingKey: route,
      });
      await setup.queue.delete(q);
      await setup.queue.delete(dlq);
      await setup.exchange.delete(ex);
    } finally {
      python.child.kill();
      if (workerSub) await workerSub.cancel().catch(() => {});
      await worker.close();
      await setup.close();
    }
  });

  // 7. Queue/exchange lifecycle.
  await test("Queue and exchange lifecycle", async () => {
    const c = client("lifecycle");
    const ex = `${names.exchange}-lifecycle`;
    const q = `${names.queue}-lifecycle`;

    try {
      await c.connect();
      await c.exchange.declare({
        name: ex,
        type: "direct",
        durable: true,
      });
      await c.queue.declare({ name: q, durable: true });

      await c.exchange.bind({
        exchangeName: ex,
        queueName: q,
        routingKey: "lifecycle",
      });

      await c.exchange.unbind({
        exchangeName: ex,
        queueName: q,
        routingKey: "lifecycle",
      });

      await c.queue.delete(q);
      await c.exchange.delete(ex);
    } finally {
      await c.close();
    }
  });

  // 8. Disconnect recovery.
  // The Python child deliberately exits while holding an unacked delivery.
  await test("Disconnect recovery", async () => {
    const ex = names.disconnectExchange;
    const q = names.disconnectQueue;
    const route = "disconnect.test";
    const c = client("disconnect-recovery");
    let sub;

    try {
      await c.connect();
      await topology(c, ex, q, route);

      const pCode = String.raw`
import asyncio, os
from messagex import MessageX

async def main():
    c = MessageX(
        host=os.environ["MESSAGEX_HOST"],
        port=int(os.environ["MESSAGEX_PORT"]),
        username=os.environ["MESSAGEX_USER"],
        password=os.environ["MESSAGEX_PASSWORD"],
    )
    await c.connect()
    async def handler(message):
        print("GOT_UNACKED", flush=True)
        os._exit(0)
    sub = await c.consume(os.environ["SUITE_QUEUE"], handler)
    print("READY", flush=True)
    await asyncio.Event().wait()

asyncio.run(main())
`;
      const p = spawn(PYTHON, ["-u", "-c", pCode], {
        env: {
          ...process.env,
          MESSAGEX_HOST: HOST,
          MESSAGEX_PORT: String(PORT),
          MESSAGEX_USER: USER,
          MESSAGEX_PASSWORD: PASSWORD,
          SUITE_QUEUE: q,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const lines = [];
      const rl = readline.createInterface({ input: p.stdout });
      rl.on("line", (line) => {
        lines.push(line);
        console.log(`      [Python crash-test] ${line}`);
      });

      const wait = (prefix, ms = 15000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out: ${prefix}`)), ms);
        const poll = setInterval(() => {
          const found = lines.find((line) => line.startsWith(prefix));
          if (found) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve(found);
          }
        }, 50);
      });

      await wait("READY");
      await c.publish({
        exchangeName: ex,
        routingKey: route,
        message: { test: "disconnect-recovery" },
      });
      await wait("GOT_UNACKED");
      await new Promise((resolve) => p.once("exit", resolve));

      let resolveMessage;
      const got = new Promise((resolve) => { resolveMessage = resolve; });

      sub = await c.consume({
        queueName: q,
        onMessage: async (message) => {
          await message.ack();
          resolveMessage(message);
        },
      });

      const message = await Promise.race([
        got,
        sleep(15000).then(() => {
          throw new Error("Message was not recovered after disconnect");
        }),
      ]);

      check(message.deliveryCount >= 2, "Expected redelivered message");
      rl.close();
    } finally {
      if (sub) await sub.cancel().catch(() => {});
      await c.close();
    }
  });

  // 9. ACK timeout recovery. Broker defaults: 30s timeout, 5s scan interval.
  await test("ACK timeout recovery", async () => {
    const ex = names.timeoutExchange;
    const q = names.timeoutQueue;
    const route = "timeout.test";
    const publisher = client("timeout-publisher");
    const recovery = client("timeout-recovery");
    let sub;
    let python;

    try {
      await publisher.connect();
      await topology(publisher, ex, q, route);

      python = pythonProcess("timeout-consumer", {
        SUITE_QUEUE: q,
      });

      await python.waitForLine("READY");
      await publisher.publish({
        exchangeName: ex,
        routingKey: route,
        message: { test: "ack-timeout" },
      });
      await python.waitForLine("UNACKED:", 15000);

      await recovery.connect();
      let resolveMessage;
      const got = new Promise((resolve) => { resolveMessage = resolve; });

      sub = await recovery.consume({
        queueName: q,
        onMessage: async (message) => {
          await message.ack();
          resolveMessage(message);
        },
      });

      const message = await Promise.race([
        got,
        sleep(50000).then(() => {
          throw new Error("ACK timeout recovery exceeded 50 seconds");
        }),
      ]);

      check(message.deliveryCount >= 2, "Expected timed-out redelivery");
    } finally {
      python?.child.kill();
      if (sub) await sub.cancel().catch(() => {});
      await recovery.close();
      await publisher.close();
    }
  });

  // Final summary.
  console.log("\n======================================");
  console.log("          TEST SUMMARY");
  console.log("======================================");

  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"}  ${result.name}`
    );
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log("--------------------------------------");
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log("======================================");

  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nIntegration suite crashed:", error);
  process.exitCode = 1;
});
