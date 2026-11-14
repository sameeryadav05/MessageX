from __future__ import annotations

import asyncio
import inspect
import json
import uuid
from typing import Any, Dict, Mapping, Optional, Set

from .errors import (
    MessageXBrokerError,
    MessageXConnectionError,
    MessageXTimeoutError,
)
from .events import EventEmitter, logger
from .frame import FrameDecoder, encode_frame
from .types import (
    BindingInfo,
    ConsumerSubscription,
    DeliveredMessage,
    ExchangeInfo,
    ExchangeType,
    MessageHandler,
    PublishResult,
    QueueInfo,
)

PROTOCOL_VERSION = 1


def _compact(values: Mapping[str, Any]) -> Dict[str, Any]:
    """Drop ``None`` values so the broker applies its own defaults."""
    return {k: v for k, v in values.items() if v is not None}


class _Consumer:
    __slots__ = ("queue_name", "on_message")

    def __init__(self, queue_name: str, on_message: MessageHandler) -> None:
        self.queue_name = queue_name
        self.on_message = on_message


class _QueueApi:
    def __init__(self, client: "MessageX") -> None:
        self._client = client

    async def declare(
        self,
        name: str,
        *,
        durable: Optional[bool] = None,
        exclusive: Optional[bool] = None,
        auto_delete: Optional[bool] = None,
        max_delivery_count: Optional[int] = None,
        dead_letter_queue: Optional[str] = None,
    ) -> Dict[str, QueueInfo]:
        """Declare a queue. Returns the broker payload: ``{"queue": {...}}``."""
        return await self._client._request(
            "QUEUE_DECLARE",
            _compact(
                {
                    "name": name,
                    "durable": durable,
                    "exclusive": exclusive,
                    "autoDelete": auto_delete,
                    "maxDeliveryCount": max_delivery_count,
                    "deadLetterQueue": dead_letter_queue,
                }
            ),
        )  # type: ignore[return-value]

    async def delete(self, queue_name: str) -> Dict[str, Any]:
        return await self._client._request("QUEUE_DELETE", {"queueName": queue_name})


class _ExchangeApi:
    def __init__(self, client: "MessageX") -> None:
        self._client = client

    async def declare(
        self, name: str, type: ExchangeType, *, durable: Optional[bool] = None
    ) -> Dict[str, ExchangeInfo]:
        """Declare an exchange. Returns the broker payload: ``{"exchange": {...}}``."""
        return await self._client._request(
            "EXCHANGE_DECLARE", _compact({"name": name, "type": type, "durable": durable})
        )  # type: ignore[return-value]

    async def delete(self, exchange_name: str) -> Dict[str, Any]:
        return await self._client._request("EXCHANGE_DELETE", {"exchangeName": exchange_name})

    async def bind(
        self,
        exchange_name: str,
        queue_name: str,
        routing_key: str = "",
        arguments: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, BindingInfo]:
        """Bind a queue to an exchange. Returns ``{"binding": {...}}``."""
        return await self._client._request(
            "BIND",
            {
                "exchangeName": exchange_name,
                "queueName": queue_name,
                "routingKey": routing_key,
                "arguments": dict(arguments or {}),
            },
        )  # type: ignore[return-value]

    async def unbind(
        self,
        exchange_name: str,
        queue_name: str,
        routing_key: str = "",
        arguments: Optional[Mapping[str, Any]] = None,
    ) -> Dict[str, Any]:
        return await self._client._request(
            "UNBIND",
            {
                "exchangeName": exchange_name,
                "queueName": queue_name,
                "routingKey": routing_key,
                "arguments": dict(arguments or {}),
            },
        )


class MessageX(EventEmitter):
    """Asyncio client for the MessageX broker.

    Events (``client.on(name, listener)``): ``connect``, ``disconnect``, ``close``,
    ``message``, ``event``, ``warning``, ``consumer_error`` and ``error``.
    """

    def __init__(
        self,
        host: str,
        username: str,
        password: str,
        port: int = 5678,
        *,
        client_name: str = "messagex-python-client",
        connect_timeout: float = 10.0,
        request_timeout: float = 15.0,
        max_frame_size: int = 1024 * 1024,
    ) -> None:
        super().__init__()
        if not host or not username or not password:
            raise TypeError("host, username and password are required")

        self.host = host
        self.port = port
        self._username = username
        self._password = password
        self.client_name = client_name
        self.connect_timeout = connect_timeout
        self.request_timeout = request_timeout
        self.max_frame_size = max_frame_size

        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._reader_task: Optional["asyncio.Task[None]"] = None
        self._connect_task: Optional["asyncio.Task[None]"] = None
        self._decoder = FrameDecoder(max_frame_size)
        self._pending: Dict[str, "asyncio.Future[Dict[str, Any]]"] = {}
        self._consumers: Dict[str, _Consumer] = {}
        self._pending_consumers_by_queue: Dict[str, _Consumer] = {}
        self._callback_tasks: Set["asyncio.Task[None]"] = set()
        self._closing = False
        self._connected = False
        self._authenticated = False

        self.queue = _QueueApi(self)
        self.exchange = _ExchangeApi(self)

    # ------------------------------------------------------------------ state

    @property
    def is_connected(self) -> bool:
        return self._connected and self._writer is not None and not self._writer.is_closing()

    @property
    def is_authenticated(self) -> bool:
        return self._authenticated

    async def __aenter__(self) -> "MessageX":
        await self.connect()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.close()

    # ------------------------------------------------------------- connection

    async def connect(self) -> None:
        """Open the TCP connection and perform the CONNECT/AUTH handshake."""
        if self.is_connected and self._authenticated:
            return

        task = self._connect_task
        if task is None:
            task = asyncio.ensure_future(self._establish_connection())
            self._connect_task = task

            def _clear(done: "asyncio.Task[None]") -> None:
                if self._connect_task is done:
                    self._connect_task = None
                if not done.cancelled():
                    done.exception()  # mark retrieved

            task.add_done_callback(_clear)

        await asyncio.shield(task)

    async def _establish_connection(self) -> None:
        if self.is_connected:
            raise MessageXConnectionError("Socket is connected but authentication is incomplete")

        self._closing = False
        self._decoder.reset()

        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), self.connect_timeout
            )
        except asyncio.TimeoutError:
            raise MessageXTimeoutError(
                f"Timed out connecting to {self.host}:{self.port}"
            ) from None
        except OSError as exc:
            raise MessageXConnectionError(
                f"Could not connect to MessageX at {self.host}:{self.port}: {exc}"
            ) from exc

        self._reader, self._writer = reader, writer
        self._connected = True
        self._reader_task = asyncio.ensure_future(self._read_loop(reader, writer))

        try:
            await self._request("CONNECT", {"clientName": self.client_name})
            await self._request("AUTH", {"username": self._username, "password": self._password})
            self._authenticated = True
            self.emit("connect")
        except BaseException:
            self._destroy_connection()
            raise

    async def close(self) -> None:
        """Close the socket, clear consumers and reject pending requests."""
        self._closing = True
        self._authenticated = False
        self._connected = False
        self._consumers.clear()
        self._pending_consumers_by_queue.clear()

        writer = self._writer
        task = self._reader_task
        if writer is not None:
            writer.close()
            try:
                await asyncio.wait_for(writer.wait_closed(), 1.0)
            except (Exception, asyncio.TimeoutError):
                pass

        if task is not None and task is not asyncio.current_task() and not task.done():
            task.cancel()
            await asyncio.wait([task])

        self._reject_pending(MessageXConnectionError("MessageX client was closed"))
        self._writer = None
        self._reader = None
        self._reader_task = None
        self.emit("close")

    # ------------------------------------------------------------- operations

    async def publish(
        self,
        exchange_name: str,
        message: Any,
        routing_key: str = "",
        headers: Optional[Mapping[str, Any]] = None,
    ) -> PublishResult:
        """Publish a JSON-serializable ``message`` to an exchange."""
        payload = await self._request(
            "PUBLISH",
            {
                "exchangeName": exchange_name,
                "routingKey": routing_key,
                "message": message,
                "headers": dict(headers or {}),
            },
        )
        return PublishResult(
            exchange_name=str(payload.get("exchangeName", exchange_name)),
            routed_queues=int(payload.get("routedQueues", 0)),
        )

    async def consume(self, queue_name: str, on_message: MessageHandler) -> ConsumerSubscription:
        """Start consuming ``queue_name``. ``on_message`` may be sync or async."""
        if not callable(on_message):
            raise TypeError("consume requires an on_message callback")

        consumer = _Consumer(queue_name, on_message)

        # The broker may emit MESSAGE_DELIVERED before replying to CONSUME, so the
        # callback is registered by queue name first to avoid losing that delivery.
        self._pending_consumers_by_queue[queue_name] = consumer
        try:
            payload = await self._request("CONSUME", {"queueName": queue_name})
        finally:
            self._pending_consumers_by_queue.pop(queue_name, None)

        consumer_tag = str(payload.get("consumerTag") or "")
        if not consumer_tag:
            raise MessageXConnectionError("Broker did not return a consumerTag")

        self._consumers[consumer_tag] = consumer
        cancelled = False

        async def cancel() -> None:
            nonlocal cancelled
            if cancelled:
                return
            await self._request("CANCEL", {"consumerTag": consumer_tag})
            cancelled = True
            self._consumers.pop(consumer_tag, None)

        return ConsumerSubscription(consumer_tag, queue_name, cancel)

    # --------------------------------------------------------------- protocol

    async def _request(self, command: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        writer = self._writer
        if writer is None or writer.is_closing() or not self._connected:
            raise MessageXConnectionError("Not connected to MessageX. Call connect() first.")
        if command not in ("CONNECT", "AUTH") and not self._authenticated:
            raise MessageXConnectionError(
                "MessageX client is not authenticated. Await connect() before sending commands."
            )

        request_id = str(uuid.uuid4())
        frame = encode_frame(
            {
                "version": PROTOCOL_VERSION,
                "type": "COMMAND",
                "command": command,
                "requestId": request_id,
                "payload": payload,
            },
            self.max_frame_size,
        )

        future: "asyncio.Future[Dict[str, Any]]" = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            try:
                writer.write(frame)
                await writer.drain()
            except OSError as exc:
                raise MessageXConnectionError(f"Failed to send {command}: {exc}") from exc

            try:
                return await asyncio.wait_for(future, self.request_timeout)
            except asyncio.TimeoutError:
                raise MessageXTimeoutError(
                    f"MessageX command {command} timed out after {self.request_timeout}s"
                ) from None
        finally:
            self._pending.pop(request_id, None)

    async def _read_loop(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            while True:
                chunk = await reader.read(65536)
                if not chunk:
                    break
                try:
                    self._handle_data(chunk)
                except Exception as exc:
                    self._emit_error(exc)
                    self._destroy_connection()
                    return
        except asyncio.CancelledError:
            raise
        except OSError as exc:
            if not self._closing:
                self._emit_error(MessageXConnectionError(str(exc)))
        finally:
            self._handle_close(writer)

    def _handle_data(self, chunk: bytes) -> None:
        for frame in self._decoder.push(chunk):
            parsed = json.loads(frame.decode("utf-8"))
            if parsed.get("version") != PROTOCOL_VERSION:
                raise ValueError(f"Unsupported broker protocol version: {parsed.get('version')}")
            kind = parsed.get("type")
            if kind == "RESPONSE":
                self._handle_response(parsed)
            elif kind == "EVENT":
                self._handle_event(parsed)

    def _handle_response(self, response: Dict[str, Any]) -> None:
        request_id = response.get("requestId")
        future = self._pending.pop(request_id, None)
        if future is None:
            self._emit_warning(
                MessageXConnectionError(f"Received response for unknown requestId {request_id}")
            )
            return
        if future.done():
            return
        if not response.get("success"):
            future.set_exception(
                MessageXBrokerError(
                    response.get("error")
                    or {"code": "ERR_UNKNOWN", "message": "Broker command failed"}
                )
            )
            return
        future.set_result(response.get("payload") or {})

    def _handle_event(self, event: Dict[str, Any]) -> None:
        if event.get("event") != "MESSAGE_DELIVERED":
            self.emit("event", event)
            return

        data = event.get("payload") or {}
        consumer_tag = str(data.get("consumerTag") or "")
        consumer = self._consumers.get(consumer_tag) or self._pending_consumers_by_queue.get(
            str(data.get("queueName") or "")
        )
        if consumer is None:
            self._emit_warning(
                MessageXConnectionError(f"Message delivered for unknown consumer {consumer_tag}")
            )
            return

        delivery_tag = str(data.get("deliveryTag") or "")

        async def ack() -> None:
            await self._request("ACK", {"deliveryTag": delivery_tag})

        async def nack(requeue: bool) -> None:
            await self._request("NACK", {"deliveryTag": delivery_tag, "requeue": requeue})

        delivered = DeliveredMessage(
            consumer_tag=consumer_tag,
            queue_name=str(data.get("queueName") or consumer.queue_name),
            message_id=str(data.get("messageId") or ""),
            delivery_tag=delivery_tag,
            body=data.get("body"),
            headers=dict(data.get("headers") or {}),
            routing_key=str(data.get("routingKey") or ""),
            delivery_count=int(data.get("deliveryCount") or 0),
            created_at=str(data.get("createdAt") or ""),
            _ack=ack,
            _nack=nack,
        )

        self._dispatch(consumer, delivered)
        self.emit("message", delivered)

    def _dispatch(self, consumer: _Consumer, delivered: DeliveredMessage) -> None:
        try:
            result = consumer.on_message(delivered)
        except Exception as exc:
            self.emit("consumer_error", exc, delivered)
            return

        if inspect.isawaitable(result):
            task = asyncio.ensure_future(self._await_callback(result, delivered))
            self._callback_tasks.add(task)
            task.add_done_callback(self._callback_tasks.discard)

    async def _await_callback(self, awaitable: Any, delivered: DeliveredMessage) -> None:
        try:
            await awaitable
        except Exception as exc:
            self.emit("consumer_error", exc, delivered)

    # ---------------------------------------------------------------- cleanup

    def _handle_close(self, writer: asyncio.StreamWriter) -> None:
        if self._writer is not writer:
            return  # a newer connection owns the state now
        was_connected = self._connected
        self._connected = False
        self._authenticated = False
        if not writer.is_closing():
            writer.close()
        self._writer = None
        self._reader = None
        self._decoder.reset()
        self._consumers.clear()
        self._pending_consumers_by_queue.clear()
        self._reject_pending(MessageXConnectionError("Connection to MessageX was closed"))
        if not self._closing and was_connected:
            self.emit("disconnect")

    def _destroy_connection(self) -> None:
        self._connected = False
        self._authenticated = False
        self._consumers.clear()
        self._pending_consumers_by_queue.clear()
        self._reject_pending(MessageXConnectionError("MessageX connection was terminated"))
        writer, task = self._writer, self._reader_task
        self._writer = None
        self._reader = None
        if writer is not None:
            writer.close()
        if task is not None and task is not asyncio.current_task() and not task.done():
            task.cancel()
        self._reader_task = None

    def _reject_pending(self, error: Exception) -> None:
        for request_id, future in list(self._pending.items()):
            if not future.done():
                future.set_exception(error)
            self._pending.pop(request_id, None)

    def _emit_error(self, error: Exception) -> None:
        if self.listener_count("error") > 0:
            self.emit("error", error)
        else:
            self._emit_warning(error)

    def _emit_warning(self, error: Exception) -> None:
        if self.listener_count("warning") > 0:
            self.emit("warning", error)
        else:
            logger.warning("%s", error)
