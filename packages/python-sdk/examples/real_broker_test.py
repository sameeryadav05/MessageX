"""End-to-end check against a running MessageX broker.

    MESSAGEX_USER=... MESSAGEX_PASSWORD=... python examples/real_broker_test.py
"""
import asyncio
import os
import time

from messagex import MessageX


async def main() -> None:
    suffix = int(time.time() * 1000)
    exchange_name = f"sdk-test-exchange-{suffix}"
    queue_name = f"sdk-test-queue-{suffix}"
    routing_key = "orders.created"

    async with MessageX(
        host=os.environ.get("MESSAGEX_HOST", "127.0.0.1"),
        port=int(os.environ.get("MESSAGEX_PORT", "5678")),
        username=os.environ["MESSAGEX_USER"],
        password=os.environ["MESSAGEX_PASSWORD"],
        client_name="messagex-python-sdk-integration-test",
    ) as client:
        print("1. Connected and authenticated!")

        print("2.", await client.exchange.declare(exchange_name, "direct", durable=True))
        print("3.", await client.queue.declare(queue_name, durable=True))
        print("4.", await client.exchange.bind(exchange_name, queue_name, routing_key))

        received: "asyncio.Future[dict]" = asyncio.get_running_loop().create_future()

        async def on_message(message):
            print("Received:", message.body)
            await message.ack()
            if not received.done():
                received.set_result(message.body)

        subscription = await client.consume(queue_name, on_message)

        print("6.", await client.publish(
            exchange_name,
            {"orderId": "ORD-SDK-1001", "amount": 2500, "status": "created"},
            routing_key=routing_key,
            headers={"source": "messagex-sdk-test"},
        ))

        body = await asyncio.wait_for(received, timeout=10)
        assert body["orderId"] == "ORD-SDK-1001", "Received payload does not match!"
        await subscription.cancel()
        print("\nALL REAL BROKER TESTS PASSED!")


if __name__ == "__main__":
    asyncio.run(main())
