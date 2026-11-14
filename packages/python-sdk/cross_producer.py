
import asyncio
import os

from messagex import MessageX


async def main():
    async with MessageX(
        host="127.0.0.1",
        port=5678,
        username=os.environ["MESSAGEX_USER"],
        password=os.environ["MESSAGEX_PASSWORD"],
        client_name="python-cross-language-producer",
    ) as client:
        result = await client.publish(
            "cross-language-test",
            {
                "source": "python",
                "message": "Hello from Python to JavaScript!",
                "test": "cross-language",
            },
            routing_key="cross.test",
            headers={"language": "python"},
        )

        print("Python publish result:", result)


asyncio.run(main())
