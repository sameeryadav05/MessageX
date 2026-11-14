from __future__ import annotations

import json
import struct
from typing import Any, List

HEADER_SIZE = 4
DEFAULT_MAX_FRAME_SIZE = 1024 * 1024


def encode_frame(message: Any, max_frame_size: int = DEFAULT_MAX_FRAME_SIZE) -> bytes:
    """Encode ``message`` as JSON with a 4-byte big-endian length prefix."""
    try:
        text = json.dumps(message, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise TypeError("MessageX protocol message must be JSON serializable") from exc

    body = text.encode("utf-8")
    if len(body) == 0 or len(body) > max_frame_size:
        raise ValueError(f"MessageX frame size must be between 1 and {max_frame_size} bytes")
    return struct.pack(">I", len(body)) + body


class FrameDecoder:
    """Incremental decoder that turns a byte stream into frame bodies."""

    def __init__(self, max_frame_size: int = DEFAULT_MAX_FRAME_SIZE) -> None:
        self._max_frame_size = max_frame_size
        self._buffer = bytearray()

    def push(self, chunk: bytes) -> List[bytes]:
        if not chunk:
            return []
        self._buffer.extend(chunk)
        frames: List[bytes] = []

        while len(self._buffer) >= HEADER_SIZE:
            (length,) = struct.unpack_from(">I", self._buffer, 0)
            if length < 1 or length > self._max_frame_size:
                self.reset()
                raise ValueError(f"Invalid MessageX frame length: {length}")

            frame_length = HEADER_SIZE + length
            if len(self._buffer) < frame_length:
                break

            frames.append(bytes(self._buffer[HEADER_SIZE:frame_length]))
            del self._buffer[:frame_length]

        return frames

    def reset(self) -> None:
        self._buffer = bytearray()

    @property
    def buffered_bytes(self) -> int:
        return len(self._buffer)
