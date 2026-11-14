from __future__ import annotations

from typing import Any, Mapping


class MessageXError(Exception):
    """Base class for all SDK errors."""


class MessageXConnectionError(MessageXError):
    """Socket and connection lifecycle errors."""


class MessageXTimeoutError(MessageXError):
    """A connection attempt or broker command timed out."""


class MessageXBrokerError(MessageXError):
    """The broker rejected a command. See :attr:`code`."""

    def __init__(self, error: Mapping[str, Any]) -> None:
        message = str(error.get("message", "Broker command failed"))
        super().__init__(message)
        self.code: str = str(error.get("code", "ERR_UNKNOWN"))
        self.message: str = message
