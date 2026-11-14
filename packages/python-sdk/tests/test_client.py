import asyncio
import unittest

from messagex import (
    MessageX,
    MessageXBrokerError,
    MessageXConnectionError,
    MessageXTimeoutError,
)
from fake_broker import FakeBroker, delivery_event, error_response, response


async def wait_for(predicate, message="condition not met", timeout=1.0):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not predicate():
        if loop.time() > deadline:
            raise AssertionError(message)
        await asyncio.sleep(0.005)


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def start(self, handler=None, **client_kwargs):
        broker = await FakeBroker(handler).start()
        self.addAsyncCleanup(broker.stop)
        kwargs = dict(host="127.0.0.1", port=broker.port, username="u", password="p", request_timeout=1.0)
        kwargs.update(client_kwargs)
        client = MessageX(**kwargs)
        self.addAsyncCleanup(client.close)
        return broker, client

    def test_requires_credentials(self):
        with self.assertRaises(TypeError):
            MessageX(host="", username="u", password="p")
        with self.assertRaises(TypeError):
            MessageX(host="h", username="u", password="")

    async def test_immediate_delivery_before_consume_response_is_not_lost(self):
        def handler(broker, writer, command):
            if command["command"] == "CONSUME":
                writer.write(delivery_event(queueName=command["payload"]["queueName"]))
                writer.write(response(command, {"consumerTag": "consumer-1", "queueName": "q"}))
                return True
            if command["command"] in ("ACK", "CANCEL"):
                writer.write(response(command, {}))
                return True

        broker, client = await self.start(handler)
        await client.connect()
        self.assertTrue(client.is_authenticated)

        received = []

        async def on_message(message):
            received.append(message.body)
            await message.ack()

        sub = await client.consume("q", on_message)
        await wait_for(lambda: received, "message was not delivered")
        self.assertEqual(received, [{"hello": "world"}])
        self.assertEqual(sub.consumer_tag, "consumer-1")
        await sub.cancel()
        await sub.cancel()  # idempotent
        self.assertEqual([c["command"] for c in broker.commands].count("CANCEL"), 1)

    async def test_concurrent_connect_shares_one_tcp_connection(self):
        broker, client = await self.start()
        await asyncio.gather(client.connect(), client.connect())
        self.assertTrue(client.is_authenticated)
        self.assertEqual(broker.connections, 1)

    async def test_commands_rejected_before_authentication_completes(self):
        release = asyncio.Event()
        published = []

        def handler(broker, writer, command):
            if command["command"] == "AUTH":
                async def later():
                    await release.wait()
                    writer.write(response(command, {"authenticated": True}))
                asyncio.ensure_future(later())
                return True
            if command["command"] == "PUBLISH":
                published.append(command)

        broker, client = await self.start(handler)
        connecting = asyncio.ensure_future(client.connect())
        await wait_for(lambda: any(c["command"] == "AUTH" for c in broker.commands))

        with self.assertRaisesRegex(MessageXConnectionError, "authenticated"):
            await client.publish("test", {"hello": "world"})
        self.assertEqual(published, [])

        release.set()
        await connecting
        self.assertTrue(client.is_authenticated)

    async def test_pending_requests_reject_when_broker_closes_connection(self):
        def handler(broker, writer, command):
            if command["command"] == "PUBLISH":
                return True  # never answer

        broker, client = await self.start(handler, request_timeout=5.0)
        await client.connect()
        pending = asyncio.ensure_future(client.publish("test", {"hello": "world"}))
        await wait_for(lambda: any(c["command"] == "PUBLISH" for c in broker.commands))
        broker.writers[0].close()
        with self.assertRaisesRegex(MessageXConnectionError, "closed|terminated"):
            await pending

    async def test_nack_sends_requested_requeue_flag(self):
        nacks = []

        def handler(broker, writer, command):
            if command["command"] == "CONSUME":
                writer.write(response(command, {"consumerTag": "consumer-1", "queueName": "q"}))
                writer.write(delivery_event(deliveryTag="d0"))
                writer.write(delivery_event(deliveryTag="d1"))
                return True
            if command["command"] == "NACK":
                nacks.append(command["payload"])
                writer.write(response(command, {}))
                return True

        broker, client = await self.start(handler)
        await client.connect()
        handled = []

        def on_message(message):
            requeue = not handled
            handled.append(message.delivery_tag)
            return message.nack(requeue=requeue)

        await client.consume("q", on_message)
        await wait_for(lambda: len(nacks) == 2, "expected two NACKs")
        self.assertEqual(sorted((n["deliveryTag"], n["requeue"]) for n in nacks), [("d0", True), ("d1", False)])

    async def test_consumers_cleared_after_disconnect_and_reconnect(self):
        def handler(broker, writer, command):
            if command["command"] == "CONSUME":
                writer.write(response(command, {"consumerTag": "old-consumer", "queueName": "q"}))
                return True

        broker, client = await self.start(handler)
        calls = []
        await client.connect()
        await client.consume("q", lambda m: calls.append(m))

        disconnected = asyncio.get_running_loop().create_future()
        client.once("disconnect", lambda: disconnected.set_result(True))
        broker.writers[0].close()
        await asyncio.wait_for(disconnected, 1.0)
        self.assertFalse(client.is_authenticated)

        await client.connect()
        self.assertEqual(broker.connections, 2)

        warning = asyncio.get_running_loop().create_future()
        client.once("warning", lambda err: warning.set_result(err))
        broker.writers[1].write(delivery_event(consumerTag="old-consumer", queueName="q"))
        await asyncio.wait_for(warning, 1.0)
        self.assertEqual(calls, [])

    async def test_broker_error_surfaces_code(self):
        def handler(broker, writer, command):
            if command["command"] == "QUEUE_DECLARE":
                writer.write(error_response(command, "ERR_QUEUE_EXISTS", "queue exists"))
                return True

        _, client = await self.start(handler)
        await client.connect()
        with self.assertRaises(MessageXBrokerError) as ctx:
            await client.queue.declare("orders")
        self.assertEqual(ctx.exception.code, "ERR_QUEUE_EXISTS")
        self.assertEqual(str(ctx.exception), "queue exists")

    async def test_request_timeout(self):
        def handler(broker, writer, command):
            if command["command"] == "QUEUE_DELETE":
                return True

        _, client = await self.start(handler, request_timeout=0.1)
        await client.connect()
        with self.assertRaises(MessageXTimeoutError):
            await client.queue.delete("orders")

    async def test_connection_refused_raises_connection_error(self):
        client = MessageX(host="127.0.0.1", port=1, username="u", password="p", connect_timeout=1.0)
        with self.assertRaises(MessageXConnectionError):
            await client.connect()

    async def test_publish_declare_and_bind_payloads(self):
        def handler(broker, writer, command):
            name = command["command"]
            if name == "PUBLISH":
                writer.write(response(command, {"exchangeName": "ex", "routedQueues": 2}))
                return True
            if name in ("QUEUE_DECLARE", "EXCHANGE_DECLARE", "BIND"):
                writer.write(response(command, {"ok": True}))
                return True

        broker, client = await self.start(handler)
        await client.connect()

        result = await client.publish("ex", {"a": 1}, routing_key="rk", headers={"h": "v"})
        self.assertEqual((result.exchange_name, result.routed_queues), ("ex", 2))
        await client.queue.declare("q", durable=True, dead_letter_queue="q.dead", max_delivery_count=5)
        await client.exchange.declare("ex", "topic", durable=True)
        await client.exchange.bind("ex", "q", "orders.*")

        by_name = {c["command"]: c["payload"] for c in broker.commands}
        self.assertEqual(
            by_name["PUBLISH"],
            {"exchangeName": "ex", "routingKey": "rk", "message": {"a": 1}, "headers": {"h": "v"}},
        )
        # None values are dropped so broker defaults apply.
        self.assertEqual(
            by_name["QUEUE_DECLARE"],
            {"name": "q", "durable": True, "maxDeliveryCount": 5, "deadLetterQueue": "q.dead"},
        )
        self.assertEqual(by_name["EXCHANGE_DECLARE"], {"name": "ex", "type": "topic", "durable": True})
        self.assertEqual(
            by_name["BIND"],
            {"exchangeName": "ex", "queueName": "q", "routingKey": "orders.*", "arguments": {}},
        )

    async def test_callback_exceptions_emit_consumer_error(self):
        def handler(broker, writer, command):
            if command["command"] == "CONSUME":
                writer.write(response(command, {"consumerTag": "consumer-1", "queueName": "q"}))
                writer.write(delivery_event())
                return True

        _, client = await self.start(handler)
        await client.connect()
        errors = []
        client.on("consumer_error", lambda exc, msg: errors.append((exc, msg)))

        async def boom(message):
            raise RuntimeError("boom")

        await client.consume("q", boom)
        await wait_for(lambda: errors, "consumer_error not emitted")
        self.assertIsInstance(errors[0][0], RuntimeError)
        self.assertEqual(errors[0][1].message_id, "message-1")

    async def test_async_context_manager(self):
        broker, _ = await self.start()
        async with MessageX("127.0.0.1", "u", "p", port=broker.port) as client:
            self.assertTrue(client.is_connected)
            self.assertTrue(client.is_authenticated)
        self.assertFalse(client.is_connected)


if __name__ == "__main__":
    unittest.main()
