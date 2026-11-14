from __future__ import annotations

import asyncio
import inspect
import logging
from typing import Any, Callable, Dict, List

logger = logging.getLogger("messagex")


class EventEmitter:
    """Tiny Node-style emitter. Listeners may be sync functions or coroutine functions."""

    def __init__(self) -> None:
        self._listeners: Dict[str, List[Callable[..., Any]]] = {}
        self._background: set = set()

    def on(self, event: str, listener: Callable[..., Any]) -> "EventEmitter":
        self._listeners.setdefault(event, []).append(listener)
        return self

    def once(self, event: str, listener: Callable[..., Any]) -> "EventEmitter":
        def wrapper(*args: Any) -> Any:
            self.off(event, wrapper)
            return listener(*args)

        wrapper.__wrapped__ = listener  # type: ignore[attr-defined]
        return self.on(event, wrapper)

    def off(self, event: str, listener: Callable[..., Any]) -> "EventEmitter":
        items = self._listeners.get(event, [])
        for item in list(items):
            if item is listener or getattr(item, "__wrapped__", None) is listener:
                items.remove(item)
                break
        return self

    def listener_count(self, event: str) -> int:
        return len(self._listeners.get(event, []))

    def emit(self, event: str, *args: Any) -> bool:
        listeners = list(self._listeners.get(event, []))
        for listener in listeners:
            try:
                result = listener(*args)
                if inspect.isawaitable(result):
                    task = asyncio.ensure_future(self._run(event, result))
                    self._background.add(task)
                    task.add_done_callback(self._background.discard)
            except Exception:
                logger.exception("Unhandled exception in %r listener", event)
        return bool(listeners)

    async def _run(self, event: str, awaitable: Any) -> None:
        try:
            await awaitable
        except Exception:
            logger.exception("Unhandled exception in %r listener", event)
