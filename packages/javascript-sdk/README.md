# MessageX Node.js SDK

The official Node.js client for the [MessageX](https://github.com/sameeryadav05/MessageX) message broker.

Written in TypeScript and distributed as compiled JavaScript with TypeScript declarations. The same package works in JavaScript and TypeScript projects.

> **Runtime:** Node.js 20 or newer. This SDK uses Node's TCP socket API and is not a browser SDK.

## Installation

```bash
npm install messagex-client
```

## JavaScript (ES modules)

```js
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
```

## TypeScript

The package ships declaration files, so TypeScript gets typed options and return values automatically.

```ts
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
      console.error("Processing failed:", error);
      await message.nack({ requeue: true });
    }
  }
});

// Stop receiving messages when your application shuts down.
await subscription.cancel();
await client.close();
```

## API

### Connection

- `new MessageX(options)` — create a client.
- `await client.connect()` — open TCP connection, send `CONNECT`, then authenticate with `AUTH`.
- `await client.close()` — close the socket and reject pending requests.
- `client.isConnected`, `client.isAuthenticated` — connection state.
- Events: `connect`, `disconnect`, `close`, `message`, `event`, `warning`, `consumerError`, `error`.

Options: `host`, `port` (default 5678), `username`, `password`, `clientName`, `connectTimeout`, `requestTimeout`, `maxFrameSize`.

### Queues

- `client.queue.declare({ name, durable, exclusive, autoDelete, maxDeliveryCount, deadLetterQueue })`
- `client.queue.delete(queueName)`

### Exchanges and bindings

- `client.exchange.declare({ name, type, durable })`
- `client.exchange.delete(exchangeName)`
- `client.exchange.bind({ exchangeName, queueName, routingKey, arguments })`
- `client.exchange.unbind({ exchangeName, queueName, routingKey, arguments })`

Supported exchange types: `direct`, `fanout`, `topic`, `headers`.

### Publishing and consuming

- `client.publish({ exchangeName, routingKey, message, headers })`
- `client.consume({ queueName, onMessage })` returns a subscription with `consumerTag`, `queueName`, and `cancel()`.
- Delivered messages expose `body`, `headers`, `routingKey`, `deliveryCount`, `deliveryTag`, `ack()`, and `nack({ requeue })`.

The broker currently uses prefetch count 1 per consumer connection. A message handler should settle each delivery with `ack()` or `nack()`.

## Security and networking

The current broker TCP listener does not provide TLS. Do not expose port 5678 directly to the public internet or send credentials over an untrusted network. Use a private network, VPN, or SSH tunnel. The current MessageX Docker launcher binds broker TCP to localhost on the host; applications outside that host need a secure private connectivity path.

The SDK does not automatically reconnect. Recreate/reconnect the client in your application when the `disconnect` event fires.

## Development

From the repository root:

```bash
npm install
npm run build --workspace=messagex-client
npm test --workspace=messagex-client
```

## Current protocol coverage

The client implements protocol version 1 commands supported by the broker: CONNECT, AUTH, QUEUE_DECLARE, QUEUE_DELETE, EXCHANGE_DECLARE, EXCHANGE_DELETE, BIND, UNBIND, PUBLISH, CONSUME, ACK, NACK and CANCEL. 

Management HTTP APIs, browser WebSocket transport, TLS transport, automatic reconnect, transactions, and batch publishing are not part of this initial release.