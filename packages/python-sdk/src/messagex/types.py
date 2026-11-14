from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional, TypedDict, Union

try:  # Python 3.8+
    from typing import Literal
except ImportError:  # pragma: no cover
    from typing_extensions import Literal  # type: ignore

ExchangeType = Literal["direct", "fanout", "topic", "headers"]


@dataclass
class DeliveredMessage:
    """A message delivered to a consumer. Settle it with :meth:`ack` or :meth:`nack`."""

    consumer_tag: str
    queue_name: str
    message_id: str
    delivery_tag: str
    body: Any
    headers: Dict[str, Any]
    routing_key: str
    delivery_count: int
    created_at: str
    _ack: Optional[Callable[[], Awaitable[None]]] = field(default=None, repr=False, compare=False)
    _nack: Optional[Callable[[bool], Awaitable[None]]] = field(default=None, repr=False, compare=False)

    async def ack(self) -> None:
        """Acknowledge successful processing."""
        assert self._ack is not None
        await self._ack()

    async def nack(self, requeue: bool = True) -> None:
        """Reject the delivery, optionally requeueing it."""
        assert self._nack is not None
        await self._nack(requeue)


MessageHandler = Callable[[DeliveredMessage], Union[None, Awaitable[None]]]


@dataclass
class ConsumerSubscription:
    consumer_tag: str
    queue_name: str
    _cancel: Callable[[], Awaitable[None]] = field(repr=False, compare=False)

    async def cancel(self) -> None:
        await self._cancel()


@dataclass
class PublishResult:
    exchange_name: str
    routed_queues: int


class QueueInfo(TypedDict, total=False):
    id: str
    name: str
    durable: bool
    exclusive: bool
    autoDelete: bool
    maxDeliveryCount: Optional[int]
    deadLetterQueue: Optional[str]


class ExchangeInfo(TypedDict, total=False):
    id: str
    name: str
    type: str
    durable: bool


class BindingInfo(TypedDict, total=False):
    id: str
    exchangeName: str
    queueName: str
    routingKey: str
    arguments: Dict[str, Any]
