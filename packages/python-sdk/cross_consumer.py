
import asyncio
import os

from messagex import MessageX


async def main():
    exchange_name = "cross-language-js-test"
    queue_name = "cross-language-js-queue"
    routing_key = "cross.javascript"

    async with MessageX(
        host="127.0.0.1",
        port=5678,
        username=os.environ["MESSAGEX_USER"],
        password=os.environ["MESSAGEX_PASSWORD"],
        client_name="python-cross-language-consumer",
    ) as client:

        print("1. Connected:", client.is_connected)
        print("2. Authenticated:", client.is_authenticated)

        exchange = await client.exchange.declare(
            exchange_name, "direct", durable=True
        )
        print("3. Exchange declaration:", exchange)

        queue = await client.queue.declare(queue_name, durable=True)
        print("4. Queue declaration:", queue)

        binding = await client.exchange.bind(
            exchange_name, queue_name, routing_key
        )
        print("5. Binding:", binding)

        received = asyncio.get_running_loop().create_future()

        async def handler(message):
            print("6. Received JavaScript message:", message.body)
            await message.ack()
            print("7. ACK successful!")

            if not received.done():
                received.set_result(message.body)

        subscription = await client.consume(queue_name, handler)
        print("8. Python consumer is waiting for JavaScript...")

        try:
            body = await asyncio.wait_for(received, timeout=60)

            assert body["source"] == "javascript"
            assert body["test"] == "cross-language"

            print("CROSS-LANGUAGE TEST B PASSED!")

        finally:
            await subscription.cancel()


if __name__ == "__main__":
    asyncio.run(main())
