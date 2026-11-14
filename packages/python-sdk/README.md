# MessageX Python SDK

The official **asyncio** client for the [MessageX](https://github.com/sameeryadav05/MessageX) self-hosted message broker.

[![PyPI](https://img.shields.io/pypi/v/messagex-client)](https://pypi.org/project/messagex-client/)
[![Python](https://img.shields.io/badge/Python-%3E%3D3.9-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Zero runtime dependencies · fully typed (`py.typed`) · same protocol (v1) as the [JavaScript SDK](https://www.npmjs.com/package/messagex-client).

## Contents

- [Installation](#installation)
- [Quick start](#quick-start-5-minutes)
- [Core concepts](#core-concepts)
- [Connecting](#connecting)
- [Declaring queues and exchanges](#declaring-queues-and-exchanges)
- [Publishing messages](#publishing-messages)
- [Consuming messages](#consuming-messages)
- [Routing with exchange types](#routing-with-exchange-types)
- [Retries and dead-letter queues](#retries-and-dead-letter-queues)
- [Events](#events)
- [Error handling](#error-handling)
- [Recipes](#recipes) (auto-reconnect, graceful shutdown, FastAPI, logging)
- [Troubleshooting](#troubleshooting)
- [API reference](#api-reference)
- [Security and limitations](#security-and-limitations)

---

## Installation

```bash
pip install messagex-client
```

The package name on PyPI is `messagex-client`; you import it as `messagex`:

```python
from messagex import MessageX
```

Requires Python 3.9+ and a running MessageX broker (the standard Docker deployment listens on `localhost:5678`).

> **This is an asyncio library.** Every network call is a coroutine, so you `await` it inside an `async def` function and start your program with `asyncio.run(...)`. In Jupyter/IPython you can use top-level `await` directly.

---

## Quick start (5 minutes)

Set your broker credentials once:

```bash
export MESSAGEX_USER="your-username"
export MESSAGEX_PASSWORD="your-password"
```

### 1. Consumer: `consumer.py`

```python
import asyncio
import os

from messagex import MessageX


async def handle(message):
    print("Received:", message.body)
    await message.ack()              # tell the broker we're done with it


async def main():
    async with MessageX(
        host="127.0.0.1",
        username=os.environ["MESSAGEX_USER"],
        password=os.environ["MESSAGEX_PASSWORD"],
    ) as client:
        # Set up the topology (exchange -> binding -> queue)
        await client.exchange.declare("orders.exchange", "direct", durable=True)
        await client.queue.declare("orders", durable=True)
        await client.exchange.bind("orders.exchange", "orders", "orders.created")

        await client.consume("orders", handle)
        print("Waiting for messages. Press Ctrl+C to stop.")
        await asyncio.Event().wait()   # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
```

### 2. Producer: `producer.py`

```python
import asyncio
import os

from messagex import MessageX


async def main():
    async with MessageX(
        host="127.0.0.1",
        username=os.environ["MESSAGEX_USER"],
        password=os.environ["MESSAGEX_PASSWORD"],
    ) as client:
        result = await client.publish(
            "orders.exchange",
            {"orderId": "ORD-1001", "amount": 2500, "status": "created"},
            routing_key="orders.created",
            headers={"source": "checkout-service"},
        )
        print("Routed to", result.routed_queues, "queue(s)")


asyncio.run(main())
```

Run `python consumer.py` in one terminal, then `python producer.py` in another. The consumer prints the order.

---

## Core concepts

```
 Producer ──publish──▶  Exchange  ──binding (routing key)──▶  Queue  ──deliver──▶  Consumer
                       "orders.exchange"    "orders.created"   "orders"           ack / nack
```

| Concept | What it is |
|---|---|
| **Exchange** | Receives published messages and decides which queue(s) get them. Has a type: `direct`, `fanout`, `topic` or `headers`. |
| **Queue** | Holds messages until a consumer processes them. |
| **Binding** | A rule linking an exchange to a queue, usually with a *routing key*. |
| **Routing key** | A label on each published message that bindings match against. |
| **Consumer** | Your code, subscribed to a queue. Each delivered message must be **acked** (done) or **nacked** (failed). |

A message is **published to an exchange** (never directly to a queue). If no binding matches, `result.routed_queues` is `0`.

---

## Connecting

```python
client = MessageX(
    host="127.0.0.1",          # required
    username="user",           # required
    password="secret",         # required
    port=5678,                 # default 5678
    client_name="billing-service",
    connect_timeout=10.0,      # seconds
    request_timeout=15.0,      # seconds
    max_frame_size=1_048_576,  # bytes
)
```

### Option A: context manager (recommended)

```python
async with MessageX(host=..., username=..., password=...) as client:
    ...            # connected and authenticated here
# closed automatically, even if an exception was raised
```

### Option B: manual lifecycle

```python
client = MessageX(host=..., username=..., password=...)
await client.connect()
try:
    ...
finally:
    await client.close()
```

`connect()` is safe to call more than once; concurrent calls share a single TCP connection. Check state with `client.is_connected` and `client.is_authenticated`.

### Reading config from the environment

```python
import os
from messagex import MessageX

def make_client() -> MessageX:
    return MessageX(
        host=os.environ.get("MESSAGEX_HOST", "127.0.0.1"),
        port=int(os.environ.get("MESSAGEX_PORT", "5678")),
        username=os.environ["MESSAGEX_USER"],
        password=os.environ["MESSAGEX_PASSWORD"],
    )
```

Never hard-code credentials in source control.

---

## Declaring queues and exchanges

Declare what you need when your service starts.

```python
await client.queue.declare(
    "orders",
    durable=True,                  # survive broker restarts
    exclusive=False,
    auto_delete=False,
    max_delivery_count=5,          # see "Retries and dead-letter queues"
    dead_letter_queue="orders.dead",
)

await client.exchange.declare("orders.exchange", "topic", durable=True)

await client.exchange.bind("orders.exchange", "orders", "orders.*")
```

Options you leave out (or pass as `None`) are not sent, so the broker applies its own defaults.

To remove things:

```python
await client.exchange.unbind("orders.exchange", "orders", "orders.*")
await client.queue.delete("orders")
await client.exchange.delete("orders.exchange")
```

These calls return the broker's response as a plain `dict` using the broker's key names, for example:

```python
info = await client.queue.declare("orders", durable=True)
print(info["queue"]["name"])
```

---

## Publishing messages

```python
result = await client.publish(
    "orders.exchange",                       # exchange name
    {"orderId": "ORD-1001", "amount": 2500}, # message: any JSON-serializable value
    routing_key="orders.created",            # optional, default ""
    headers={"source": "checkout-service"},  # optional metadata
)
print(result.exchange_name, result.routed_queues)
```

- The message can be a `dict`, `list`, `str`, number, `bool` or `None`.
- Non-JSON values (for example `datetime`, `Decimal`, `set`, custom objects) raise `TypeError`. Convert them first, e.g. `order["created"] = created.isoformat()`.
- A message larger than `max_frame_size` raises `ValueError`.
- `routed_queues == 0` means the broker accepted the message but no queue was bound to receive it.

---

## Consuming messages

```python
async def handle(message):
    ...

subscription = await client.consume("orders", handle)
```

`consume()` returns a `ConsumerSubscription` with `consumer_tag`, `queue_name` and `await cancel()`.

### The message object

| Attribute / method | Description |
|---|---|
| `message.body` | The decoded message (what the producer published) |
| `message.headers` | Headers dict |
| `message.routing_key` | Routing key it was published with |
| `message.message_id` | Broker message id |
| `message.delivery_count` | How many times this message has been delivered |
| `message.created_at` | Creation timestamp (string) |
| `message.queue_name`, `message.consumer_tag`, `message.delivery_tag` | Delivery identifiers |
| `await message.ack()` | Success: the message is done |
| `await message.nack(requeue=True)` | Failure: put it back (`True`) or reject it (`False`) |

### Always ack or nack

```python
async def handle(message):
    try:
        await process_order(message.body)
        await message.ack()
    except TemporaryError:
        await message.nack(requeue=True)    # try again later
    except Exception:
        await message.nack(requeue=False)   # give up on this message
        raise
```

The SDK **never** acks or nacks for you. The broker currently uses a prefetch of 1 per consumer connection, so an unsettled message can hold up the ones behind it.

### Sync or async handlers

Handlers can be `async def` (recommended, since you can `await message.ack()` inside) or a plain function that returns an awaitable:

```python
def handle(message):
    return message.ack()      # returning the awaitable is enough
```

A plain synchronous handler runs on the event loop, so keep it fast. Do not call blocking code (`time.sleep`, `requests`, heavy CPU work) inside a handler. Use `await asyncio.to_thread(blocking_fn, ...)` for that.

If your handler raises, the SDK emits a [`consumer_error`](#events) event and carries on with the next message.

### Stopping a consumer

```python
await subscription.cancel()   # stop receiving, keep the connection open
await client.close()          # or close everything
```

---

## Routing with exchange types

| Type | Delivers a message to... |
|---|---|
| `direct` | queues bound with a routing key equal to the message's routing key |
| `fanout` | every bound queue (routing key not used for matching) |
| `topic` | queues whose binding pattern matches the routing key, e.g. `orders.*` |
| `headers` | queues whose binding `arguments` match the message headers |

### Direct: one key, one destination

```python
await client.exchange.declare("tasks", "direct")
await client.queue.declare("emails")
await client.exchange.bind("tasks", "emails", "send.email")
await client.publish("tasks", {"to": "a@b.com"}, routing_key="send.email")
```

### Fanout: broadcast to everyone

```python
await client.exchange.declare("events", "fanout")
for name in ("audit", "analytics", "notifications"):
    await client.queue.declare(name)
    await client.exchange.bind("events", name)         # no routing key needed
await client.publish("events", {"type": "user.signup"})   # copied to all three queues
```

### Topic: pattern matching

```python
await client.exchange.declare("orders.exchange", "topic")
await client.queue.declare("all-orders")
await client.exchange.bind("orders.exchange", "all-orders", "orders.*")
await client.publish("orders.exchange", {"id": 1}, routing_key="orders.created")
await client.publish("orders.exchange", {"id": 2}, routing_key="orders.cancelled")
```

### Headers: match on metadata

```python
await client.exchange.declare("reports", "headers")
await client.exchange.bind("reports", "pdf-queue", arguments={"format": "pdf"})
await client.publish("reports", {"id": 7}, headers={"format": "pdf"})
```

The exact matching rules for each type are defined by the broker. See the [MessageX documentation](https://github.com/sameeryadav05/MessageX#readme) for details, especially for `headers` bindings.

### Work queue: scale out by running more consumers

Run the same consumer script in several processes against the same queue to spread the work.

---

## Retries and dead-letter queues

Queues accept `max_delivery_count` and `dead_letter_queue`, so messages that keep failing can be routed to a separate queue instead of looping forever:

```python
await client.queue.declare("orders.dead", durable=True)
await client.queue.declare(
    "orders",
    durable=True,
    max_delivery_count=5,
    dead_letter_queue="orders.dead",
)
```

Use `message.delivery_count` to see which attempt you are on:

```python
async def handle(message):
    try:
        await process(message.body)
        await message.ack()
    except Exception:
        print(f"attempt {message.delivery_count} failed")
        await message.nack(requeue=True)
```

---

## Events

The client emits events you can subscribe to with `on`, `once` and `off`. Listeners can be sync or async.

| Event | Arguments | When |
|---|---|---|
| `connect` | none | Connected and authenticated |
| `disconnect` | none | The connection dropped unexpectedly (not emitted by your own `close()`) |
| `close` | none | `close()` finished |
| `message` | `DeliveredMessage` | Any message delivered (in addition to your handler) |
| `event` | `dict` | Other broker events |
| `consumer_error` | `exception, message` | Your handler raised |
| `warning` | `Exception` | Non-fatal problem (e.g. delivery for an unknown consumer) |
| `error` | `Exception` | Connection or protocol error |

```python
client.on("disconnect", lambda: print("connection lost!"))
client.on("consumer_error", lambda exc, msg: print(f"handler failed on {msg.message_id}: {exc!r}"))
client.on("warning", lambda err: print("warning:", err))
```

If there is no `error` listener, errors are emitted as `warning`. If there is no `warning` listener either, they are written to the `messagex` logger.

---

## Error handling

All SDK errors inherit from `MessageXError`:

| Exception | Meaning |
|---|---|
| `MessageXConnectionError` | Can't connect, not connected/authenticated, or the connection was lost |
| `MessageXTimeoutError` | Connect or a command exceeded its timeout |
| `MessageXBrokerError` | The broker rejected the command; has `.code` and `.message` |

```python
from messagex import (
    MessageXBrokerError, MessageXConnectionError, MessageXTimeoutError,
)

try:
    await client.queue.declare("orders", durable=True)
except MessageXBrokerError as err:
    print("Broker said no:", err.code, err)
except MessageXTimeoutError:
    print("Broker too slow")
except MessageXConnectionError as err:
    print("Connection problem:", err)
```

Argument mistakes raise standard Python errors: `TypeError` (missing credentials, non-JSON message) or `ValueError` (message too large).

---

## Recipes

### Auto-reconnect

The SDK does **not** reconnect or restore subscriptions by itself. After a disconnect you must connect and `consume()` again. A simple, robust pattern is to build a fresh client in a loop:

```python
import asyncio
from messagex import MessageX, MessageXConnectionError, MessageXTimeoutError

async def run_consumer(stop: asyncio.Event):
    delay = 1.0
    while not stop.is_set():
        client = make_client()                 # see "Reading config from the environment"
        lost = asyncio.Event()
        client.on("disconnect", lambda: lost.set())
        try:
            await client.connect()
            await client.consume("orders", handle)
            delay = 1.0                        # healthy again: reset backoff

            waiter = asyncio.ensure_future(lost.wait())
            stopper = asyncio.ensure_future(stop.wait())
            await asyncio.wait({waiter, stopper}, return_when=asyncio.FIRST_COMPLETED)
            waiter.cancel()
            stopper.cancel()
        except (MessageXConnectionError, MessageXTimeoutError) as exc:
            print("connection failed:", exc)
        finally:
            await client.close()

        if not stop.is_set():
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30.0)       # exponential backoff, max 30 s
```

### Graceful shutdown (Ctrl+C / SIGTERM)

```python
import asyncio, signal

async def main():
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)      # not available on Windows

    async with make_client() as client:
        subscription = await client.consume("orders", handle)
        await stop.wait()
        await subscription.cancel()                 # stop taking new work, then exit
```

### Publishing from a FastAPI app

Create one client at startup and reuse it for every request:

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request

@asynccontextmanager
async def lifespan(app: FastAPI):
    client = make_client()
    await client.connect()
    app.state.mx = client
    yield
    await client.close()

app = FastAPI(lifespan=lifespan)

@app.post("/orders")
async def create_order(order: dict, request: Request):
    result = await request.app.state.mx.publish(
        "orders.exchange", order, routing_key="orders.created"
    )
    return {"queued": result.routed_queues > 0}
```

### Publishing from synchronous code

If your code is not async, run a short-lived call with `asyncio.run`:

```python
import asyncio

def publish_once(payload: dict) -> None:
    async def _go():
        async with make_client() as client:
            await client.publish("orders.exchange", payload, routing_key="orders.created")
    asyncio.run(_go())
```

This opens a new connection per call, so use it for scripts and occasional jobs, not high-volume publishing. Don't call `asyncio.run` from inside an already-running event loop.

### Logging

```python
import logging
logging.basicConfig(level=logging.INFO)
logging.getLogger("messagex").setLevel(logging.DEBUG)
```

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `MessageXConnectionError: Could not connect to MessageX at host:port` | Broker not running, wrong host/port, or firewall. Check `docker ps` and the port (default `5678`). |
| `MessageXTimeoutError` while connecting | Host unreachable, or something other than MessageX is listening on that port. Raise `connect_timeout` if the network is slow. |
| `MessageXBrokerError` right after connect | Wrong username/password. Inspect `err.code`. |
| `MessageXConnectionError: ... Call connect() first` | You used the client before `connect()` or after `close()`. |
| `MessageXConnectionError: ... not authenticated` | A command was sent while `connect()` was still in progress. `await client.connect()` first. |
| `publish` works but `routed_queues` is `0` | No binding matches the routing key. Check exchange type, queue binding and routing key spelling. |
| Consumer gets one message and then stops | You didn't `ack()`/`nack()` it. Settle every message. |
| `TypeError: MessageX protocol message must be JSON serializable` | Convert `datetime`/`Decimal`/custom objects to plain JSON types before publishing. |
| `RuntimeWarning: coroutine ... was never awaited` | You forgot `await` on a client call (`await client.publish(...)`). |
| Handler seems to freeze all processing | A blocking call inside a handler is blocking the event loop. Use `await asyncio.to_thread(...)`. |
| `asyncio.run() cannot be called from a running event loop` | You're in Jupyter/an async framework. Use `await main()` instead. |

---

## API reference

### `MessageX(host, username, password, port=5678, *, client_name, connect_timeout, request_timeout, max_frame_size)`

| Argument | Type | Default | Description |
|---|---|---:|---|
| `host` | `str` | required | Broker hostname or IP |
| `username` | `str` | required | Broker username |
| `password` | `str` | required | Broker password |
| `port` | `int` | `5678` | Broker TCP port |
| `client_name` | `str` | `"messagex-python-client"` | Client identifier |
| `connect_timeout` | `float` | `10.0` | TCP connect timeout (seconds) |
| `request_timeout` | `float` | `15.0` | Per-command timeout (seconds) |
| `max_frame_size` | `int` | `1048576` | Max frame body size (bytes) |

### Methods

| Method | Returns |
|---|---|
| `await connect()` | `None` |
| `await close()` | `None` |
| `await publish(exchange_name, message, routing_key="", headers=None)` | `PublishResult(exchange_name, routed_queues)` |
| `await consume(queue_name, on_message)` | `ConsumerSubscription` |
| `await queue.declare(name, *, durable, exclusive, auto_delete, max_delivery_count, dead_letter_queue)` | `dict` |
| `await queue.delete(queue_name)` | `dict` |
| `await exchange.declare(name, type, *, durable)` | `dict` |
| `await exchange.delete(exchange_name)` | `dict` |
| `await exchange.bind(exchange_name, queue_name, routing_key="", arguments=None)` | `dict` |
| `await exchange.unbind(exchange_name, queue_name, routing_key="", arguments=None)` | `dict` |
| `on(event, fn)` / `once(event, fn)` / `off(event, fn)` | the client |

### Properties

`is_connected`, `is_authenticated`

### Exports

`MessageX`, `MessageXError`, `MessageXConnectionError`, `MessageXTimeoutError`, `MessageXBrokerError`, `DeliveredMessage`, `ConsumerSubscription`, `PublishResult`, `ExchangeType`, `MessageHandler`

---

## Security and limitations

- The broker's TCP protocol currently has **no TLS**. Don't send credentials or messages over untrusted networks or expose port `5678` to the public internet. Use a private network, VPN or SSH tunnel, and firewall rules.
- No automatic reconnect or subscription recovery (see the [recipe](#auto-reconnect)).
- Not provided: TLS transport, transactions, batch publishing, management HTTP API, a blocking (non-asyncio) API.
- Implements protocol v1: CONNECT, AUTH, QUEUE_DECLARE, QUEUE_DELETE, EXCHANGE_DECLARE, EXCHANGE_DELETE, BIND, UNBIND, PUBLISH, CONSUME, ACK, NACK, CANCEL.

## Development

```bash
git clone https://github.com/sameeryadav05/MessageX && cd MessageX/packages/python-sdk
pip install -e .
PYTHONPATH=src:tests python -m unittest discover -s tests -v
```

End-to-end example against a running broker: [`examples/real_broker_test.py`](examples/real_broker_test.py).

## License

MIT
