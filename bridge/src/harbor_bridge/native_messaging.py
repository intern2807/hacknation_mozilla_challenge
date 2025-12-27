"""Native messaging protocol implementation for Firefox extensions.

This module handles the native messaging framing protocol:
- Messages are prefixed with a 4-byte little-endian length
- The payload is JSON-encoded UTF-8 text
"""

from __future__ import annotations

import asyncio
import json
import struct
import sys
from typing import Any, Dict, Optional, Tuple


# Maximum message size (1 MB, Firefox's limit)
MAX_MESSAGE_SIZE = 1024 * 1024


class NativeMessagingError(Exception):
    """Base exception for native messaging errors."""

    pass


class MessageTooLargeError(NativeMessagingError):
    """Raised when a message exceeds the maximum size."""

    pass


class InvalidMessageError(NativeMessagingError):
    """Raised when a message cannot be decoded."""

    pass


def encode_message(message: Dict[str, Any]) -> bytes:
    """Encode a message for native messaging.

    Args:
        message: A JSON-serializable dictionary.

    Returns:
        Bytes with 4-byte little-endian length prefix followed by JSON payload.

    Raises:
        MessageTooLargeError: If the encoded message exceeds MAX_MESSAGE_SIZE.
    """
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_MESSAGE_SIZE:
        raise MessageTooLargeError(
            f"Message size {len(payload)} exceeds maximum {MAX_MESSAGE_SIZE}"
        )
    length_prefix = struct.pack("<I", len(payload))
    return length_prefix + payload


def decode_length_prefix(data: bytes) -> int:
    """Decode the 4-byte little-endian length prefix.

    Args:
        data: Exactly 4 bytes representing the message length.

    Returns:
        The message length as an integer.

    Raises:
        InvalidMessageError: If data is not exactly 4 bytes.
    """
    if len(data) != 4:
        raise InvalidMessageError(f"Expected 4 bytes for length prefix, got {len(data)}")
    result: Tuple[int, ...] = struct.unpack("<I", data)
    return result[0]


def decode_payload(data: bytes) -> Dict[str, Any]:
    """Decode a JSON payload.

    Args:
        data: UTF-8 encoded JSON bytes.

    Returns:
        The decoded dictionary.

    Raises:
        InvalidMessageError: If the payload is not valid JSON or not a dict.
    """
    try:
        message = json.loads(data.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise InvalidMessageError(f"Failed to decode JSON payload: {e}") from e

    if not isinstance(message, dict):
        raise InvalidMessageError(f"Expected JSON object, got {type(message).__name__}")

    return message


def _read_stdin_sync() -> Optional[bytes]:
    """Read a single message from stdin synchronously.

    Returns:
        The payload bytes, or None if EOF is reached.

    Raises:
        InvalidMessageError: If the message format is invalid.
        MessageTooLargeError: If the message exceeds the size limit.
    """
    length_bytes = sys.stdin.buffer.read(4)
    if not length_bytes or len(length_bytes) < 4:
        return None

    length = decode_length_prefix(length_bytes)
    if length > MAX_MESSAGE_SIZE:
        raise MessageTooLargeError(f"Message size {length} exceeds maximum {MAX_MESSAGE_SIZE}")

    payload = sys.stdin.buffer.read(length)
    if len(payload) < length:
        raise InvalidMessageError(f"Expected {length} bytes, got {len(payload)}")
    return payload


async def read_message(
    reader: Optional[asyncio.StreamReader] = None,
) -> Optional[Dict[str, Any]]:
    """Read a single message from stdin using native messaging framing.

    Args:
        reader: Optional asyncio StreamReader. If None, reads from stdin in a thread.

    Returns:
        The decoded message dictionary, or None if EOF is reached.

    Raises:
        InvalidMessageError: If the message format is invalid.
        MessageTooLargeError: If the message exceeds the size limit.
    """
    if reader is not None:
        # Use the provided async reader
        length_bytes = await reader.readexactly(4)
        if not length_bytes:
            return None

        length = decode_length_prefix(length_bytes)
        if length > MAX_MESSAGE_SIZE:
            raise MessageTooLargeError(f"Message size {length} exceeds maximum {MAX_MESSAGE_SIZE}")

        payload_bytes = await reader.readexactly(length)
        return decode_payload(payload_bytes)

    # Read from stdin in a thread (stdin is blocking)
    result: Optional[bytes] = await asyncio.to_thread(_read_stdin_sync)
    if result is None:
        return None
    return decode_payload(result)


def _write_stdout_sync(data: bytes) -> None:
    """Write data to stdout synchronously."""
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


async def write_message(
    message: Dict[str, Any],
    writer: Optional[asyncio.StreamWriter] = None,
) -> None:
    """Write a message to stdout using native messaging framing.

    Args:
        message: The message dictionary to send.
        writer: Optional asyncio StreamWriter. If None, writes to stdout in a thread.

    Raises:
        MessageTooLargeError: If the message exceeds the size limit.
    """
    encoded = encode_message(message)

    if writer is not None:
        writer.write(encoded)
        await writer.drain()
    else:
        # Write to stdout in a thread
        await asyncio.to_thread(_write_stdout_sync, encoded)
