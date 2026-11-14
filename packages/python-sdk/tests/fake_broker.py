"""A tiny in-process fake MessageX broker for tests."""
from __future__ import annotations

import asyncio
import json
from typing import Any, Callable, Dict, List, Optional

from messagex.frame import FrameDecoder, encode_frame

Handler = Callable[["FakeBroker", asyncio.StreamWriter, Dict[str, Any]], Optional[bool]]


def response(command: Dict[str, Any], payload: Optional[Dict[str, Any]] = None) -> bytes:
    return encode_frame(
        {
            "version": 1,
            "type": "RESPONSE",
            "requestId": command["requestId"],
            "success": True,
            "payload": payload or {},
        }
    )


def error_response(command: Dict[str, Any], code: str, message: str) -> bytes:
    return encode_frame(
        {
            "version": 1,
            "type": "RESPONSE",
            "requestId": command["requestId"],
            "success": False,
            "error": {"code": code, "message": message},
        }
    )


def delivery_event(**overrides: Any) -> bytes:
    payload = {
        "consumerTag": "consumer-1",
        "queueName": "q",
        "messageId": "message-1",
        "deliveryTag": "delivery-1",
        "body": {"hello": "world"},
        "headers": {},
        "routingKey": "test",
        "deliveryCount": 1,
        "createdAt": "2026-01-01T00:00:00Z",
    }
    payload.update(overrides)
    return encode_frame({"version": 1, "type": "EVENT", "event": "MESSAGE_DELIVERED", "payload": payload})


class FakeBroker:
    """Answers CONNECT/AUTH by default; ``handler`` may override any command.

    A handler returns True when it has fully handled the command.
    """

    def __init__(self, handler: Optional[Handler] = None) -> None:
        self.handler = handler
        self.commands: List[Dict[str, Any]] = []
        self.writers: List[asyncio.StreamWriter] = []
        self.connections = 0
        self._server: Optional[asyncio.AbstractServer] = None

    async def start(self) -> "FakeBroker":
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        return self

    @property
    def port(self) -> int:
        assert self._server is not None
        return self._server.sockets[0].getsockname()[1]

    async def stop(self) -> None:
        for writer in self.writers:
            writer.close()
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()

    async def _serve(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.connections += 1
        self.writers.append(writer)
        decoder = FrameDecoder()
        try:
            while True:
                chunk = await reader.read(65536)
                if not chunk:
                    return
                for frame in decoder.push(chunk):
                    command = json.loads(frame)
                    self.commands.append(command)
                    if self.handler and self.handler(self, writer, command):
                        continue
                    name = command["command"]
                    if name == "AUTH":
                        writer.write(response(command, {"authenticated": True}))
                    else:
                        writer.write(response(command, {"connectionId": "connection-1"}))
        except (ConnectionError, asyncio.CancelledError):
            return
