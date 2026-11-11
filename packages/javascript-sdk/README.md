# MessageX JavaScript / TypeScript SDK

The official Node.js client for the [MessageX](https://github.com/sameeryadav05/MessageX) self-hosted message broker.

[![npm version](https://img.shields.io/npm/v/messagex-client)](https://www.npmjs.com/package/messagex-client)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-supported-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](../../LICENSE)

Written in TypeScript and distributed as compiled ECMAScript modules with TypeScript declaration files. One package supports both JavaScript and TypeScript applications.

> **Runtime:** Node.js 20 or newer. This package uses Node's TCP socket API. It is not a browser SDK.

## Installation

~~~bash
npm install messagex-client
~~~

## Connect to MessageX

Start a MessageX broker first. With the standard Docker deployment, the broker is available at `localhost:5678`.

~~~js
import { MessageX } from "messagex-client";

const client = new MessageX({
  host: process.env.MESSAGEX_HOST ?? "127.0.0.1",
  port: Number(process.env.MESSAGEX_PORT ?? 5678),
  username: process.env.MESSAGEX_USER,
  password: process.env.MESSAGEX_PASSWORD
});

await client.connect();
console.log("Connected:", client.isConnected, client.isAuthenticated);
~~~

The constructor requires `host`, `username`, and `password`. The TCP port defaults to `5678`.

## Publish a message

~~~js
import { MessageX } from "messagex-client";

const client = new MessageX({
  host: "127.0.0.1",
  port: 5678,
  username: process.env.MESSAGEX_USER,
  password: process.env.MESSAGEX_PASSWORD
});

try {
  await client.connect();

  await client.exchange.declare({
    name: "orders.exchange",
    type: "direct",
    durable: true
  });

  await client.queue.declare({
    name: "orders",
    durable: true
  });

  await client.exchange.bind({
    exchangeName: "orders.exchange",
    queueName: "orders",
    routingKey: "orders.created"
  });

  const result = await client.publish({
    exchangeName: "orders.exchange",
    routingKey: "orders.created",
    message: {
      orderId: "ORD-1001",
      amount: 2500,
      status: "created"
    },
    headers: {
      source: "checkout-service"
    }
  });

  console.log("Published:", result);
} finally {
  await client.close();
}
~~~

## Consume and acknowledge messages

~~~ts
import { MessageX } from "messagex-client";

const client = new MessageX({
  host: "127.0.0.1",
  port: 5678,
  username: process.env.MESSAGEX_USER!,
  password: process.env.MESSAGEX_PASSWORD!
});

await client.connect();

const subscription = await client.consume({
  queueName: "orders",
  onMessage: async (message) => {
    try {
      console.log("Received:", message.body);
      await message.ack();
    } catch (error) {
      console.error("Message processing failed:", error);
      await message.nack({ requeue: true });
    }
  }
});

// On application shutdown:
await subscription.cancel();
await client.close();
~~~

Always settle each delivery with `ack()` or `nack()`. The current broker uses a prefetch count of 1 per consumer connection.

## API reference

### Client options

| Option | Type | Default | Description |
|---|---|---:|---|
| `host` | `string` | Required | Broker hostname or IP address |
| `port` | `number` | `5678` | Broker TCP port |
| `username` | `string` | Required | Broker username |
| `password` | `string` | Required | Broker password |
| `clientName` | `string` | `messagex-node-client` | Client identifier |
| `connectTimeout` | `number` | `10000` | TCP connection timeout in milliseconds |
| `requestTimeout` | `number` | `15000` | Command timeout in milliseconds |
| `maxFrameSize` | `number` | `1048576` | Maximum protocol frame body size in bytes |

### Connection

- `new MessageX(options)` — create a client.
- `await client.connect()` — open TCP connection and perform CONNECT/AUTH handshake.
- `await client.close()` — close the socket, clear consumers, and reject pending requests.
- `client.isConnected` — connection state.
- `client.isAuthenticated` — authentication state.

Events: `connect`, `disconnect`, `close`, `message`, `event`, `warning`, `consumerError`, and `error`. Attach an `error` listener if you want to handle emitted connection/protocol errors using the standard Node.js EventEmitter convention.

### Queues

~~~ts
await client.queue.declare({
  name: "orders",
  durable: true,
  exclusive: false,
  autoDelete: false,
  maxDeliveryCount: 5,
  deadLetterQueue: "orders.dead"
});

await client.queue.delete("orders");
~~~

### Exchanges and bindings

Supported exchange types: `direct`, `fanout`, `topic`, and `headers`.

~~~ts
await client.exchange.declare({
  name: "orders.exchange",
  type: "topic",
  durable: true
});

await client.exchange.bind({
  exchangeName: "orders.exchange",
  queueName: "orders",
  routingKey: "orders.*"
});

await client.exchange.unbind({
  exchangeName: "orders.exchange",
  queueName: "orders",
  routingKey: "orders.*"
});

await client.exchange.delete("orders.exchange");
~~~

Binding options also accept an `arguments` object, used by headers exchange bindings.

### Publishing

~~~ts
const result = await client.publish({
  exchangeName: "orders.exchange",
  routingKey: "orders.created",
  message: { orderId: "ORD-1001" },
  headers: { source: "checkout-service" }
});

console.log(result.routedQueues);
~~~

Messages are JSON-serializable values.

### Consuming

`client.consume({ queueName, onMessage })` returns a subscription with `consumerTag`, `queueName`, and `cancel()`.

A delivered message exposes:

| Property / method | Description |
|---|---|
| `consumerTag` | Broker consumer identifier |
| `queueName` | Source queue |
| `messageId` | Broker message identifier |
| `deliveryTag` | Identifier used to settle this delivery |
| `body` | Decoded message body |
| `headers` | Message headers |
| `routingKey` | Message routing key |
| `deliveryCount` | Delivery attempt count |
| `createdAt` | Message creation timestamp |
| `ack()` | Acknowledge successful processing |
| `nack({ requeue })` | Reject a delivery, optionally requeueing it |

The callback may be synchronous or asynchronous. If it throws or rejects, the SDK emits `consumerError`; it does not automatically ACK or NACK on the application's behalf.

## Error handling

The package exports:

- `MessageXError` — base SDK error.
- `MessageXConnectionError` — socket and connection lifecycle errors.
- `MessageXTimeoutError` — connection or command timeout.
- `MessageXBrokerError` — broker-rejected command; includes a `code` property.

~~~ts
import {
  MessageX,
  MessageXBrokerError,
  MessageXConnectionError
} from "messagex-client";

try {
  await client.queue.declare({ name: "orders" });
} catch (error) {
  if (error instanceof MessageXBrokerError) {
    console.error(error.code, error.message);
  } else if (error instanceof MessageXConnectionError) {
    console.error("Connection problem:", error.message);
  } else {
    throw error;
  }
}
~~~

## Networking and security

The SDK connects to the broker's TCP listener (default port `5678`). For local Docker use `127.0.0.1` or `localhost`; for a remote installation use its reachable server IP or DNS name.

The current broker TCP protocol does **not** provide TLS encryption. Do not send credentials or messages over untrusted networks or expose the TCP port broadly to the public internet. Prefer a private network, VPN, or SSH tunnel and restrict access with host/cloud firewall rules.

The SDK does not automatically reconnect or restore subscriptions. Handle the `disconnect` event and implement reconnection/subscription recovery in your application when required.

## Development and tests

From the MessageX repository root:

~~~bash
npm install
npm run build:sdk
npm run test:sdk
~~~

The test suite covers frame encoding/decoding, TCP client behavior, connection lifecycle, consumer event ordering, ACK/NACK behavior, and disconnect handling.

For an end-to-end example against a running broker, see [real-broker-test.mjs](./examples/real-broker-test.mjs).

## Protocol coverage and current limitations

The SDK implements MessageX protocol v1 commands supported by the broker: CONNECT, AUTH, QUEUE_DECLARE, QUEUE_DELETE, EXCHANGE_DECLARE, EXCHANGE_DELETE, BIND, UNBIND, PUBLISH, CONSUME, ACK, NACK, and CANCEL.

The following are not currently provided by this SDK: browser/WebSocket transport, TLS transport, automatic reconnect, transactions, batch publishing, and management HTTP API methods. Python and Java SDKs are separate planned integrations, not exports from this package.

## Links

- [MessageX repository](https://github.com/sameeryadav05/MessageX)
- [MessageX documentation and deployment guide](https://github.com/sameeryadav05/MessageX#readme)
- [npm package](https://www.npmjs.com/package/messagex-client)
- [Issues and bug reports](https://github.com/sameeryadav05/MessageX/issues)

## License

MIT
