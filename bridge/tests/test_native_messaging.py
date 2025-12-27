"""Tests for native messaging protocol implementation."""

from __future__ import annotations

import json
import struct
from typing import Dict

import pytest

from harbor_bridge.native_messaging import (
    MAX_MESSAGE_SIZE,
    InvalidMessageError,
    MessageTooLargeError,
    decode_length_prefix,
    decode_payload,
    encode_message,
)


class TestEncodeMessage:
    """Tests for encode_message function."""

    def test_encode_simple_message(self):
        """Test encoding a simple message."""
        message = {"type": "hello", "request_id": "123"}
        encoded = encode_message(message)

        # First 4 bytes are the length prefix
        length = struct.unpack("<I", encoded[:4])[0]
        payload = encoded[4:]

        assert length == len(payload)
        assert json.loads(payload.decode("utf-8")) == message

    def test_encode_empty_object(self):
        """Test encoding an empty object."""
        message: Dict[str, object] = {}
        encoded = encode_message(message)

        length = struct.unpack("<I", encoded[:4])[0]
        payload = encoded[4:]

        assert length == 2  # "{}"
        assert payload == b"{}"

    def test_encode_nested_message(self):
        """Test encoding a nested message."""
        message = {
            "type": "data",
            "nested": {"key": "value", "number": 42},
            "array": [1, 2, 3],
        }
        encoded = encode_message(message)

        length = struct.unpack("<I", encoded[:4])[0]
        payload = encoded[4:]

        decoded = json.loads(payload.decode("utf-8"))
        assert decoded == message

    def test_encode_unicode_message(self):
        """Test encoding a message with unicode characters."""
        message = {"type": "hello", "emoji": "👋", "text": "日本語"}
        encoded = encode_message(message)

        length = struct.unpack("<I", encoded[:4])[0]
        payload = encoded[4:]

        assert length == len(payload)
        decoded = json.loads(payload.decode("utf-8"))
        assert decoded == message

    def test_encode_message_too_large(self):
        """Test that encoding a too-large message raises an error."""
        # Create a message that exceeds the limit
        large_data = "x" * (MAX_MESSAGE_SIZE + 1)
        message = {"data": large_data}

        with pytest.raises(MessageTooLargeError):
            encode_message(message)


class TestDecodeLengthPrefix:
    """Tests for decode_length_prefix function."""

    def test_decode_zero_length(self):
        """Test decoding a zero length."""
        data = struct.pack("<I", 0)
        assert decode_length_prefix(data) == 0

    def test_decode_small_length(self):
        """Test decoding a small length."""
        data = struct.pack("<I", 42)
        assert decode_length_prefix(data) == 42

    def test_decode_large_length(self):
        """Test decoding a large length."""
        data = struct.pack("<I", 1000000)
        assert decode_length_prefix(data) == 1000000

    def test_decode_max_length(self):
        """Test decoding the maximum 32-bit length."""
        data = struct.pack("<I", 0xFFFFFFFF)
        assert decode_length_prefix(data) == 0xFFFFFFFF

    def test_decode_invalid_length_too_short(self):
        """Test that decoding too few bytes raises an error."""
        with pytest.raises(InvalidMessageError):
            decode_length_prefix(b"\x00\x00\x00")

    def test_decode_invalid_length_too_long(self):
        """Test that decoding too many bytes raises an error."""
        with pytest.raises(InvalidMessageError):
            decode_length_prefix(b"\x00\x00\x00\x00\x00")

    def test_decode_invalid_length_empty(self):
        """Test that decoding empty bytes raises an error."""
        with pytest.raises(InvalidMessageError):
            decode_length_prefix(b"")


class TestDecodePayload:
    """Tests for decode_payload function."""

    def test_decode_simple_payload(self):
        """Test decoding a simple JSON payload."""
        payload = b'{"type":"hello","request_id":"123"}'
        result = decode_payload(payload)

        assert result == {"type": "hello", "request_id": "123"}

    def test_decode_empty_object(self):
        """Test decoding an empty object."""
        payload = b"{}"
        result = decode_payload(payload)

        assert result == {}

    def test_decode_nested_payload(self):
        """Test decoding a nested payload."""
        data = {"type": "data", "nested": {"key": "value"}, "array": [1, 2, 3]}
        payload = json.dumps(data).encode("utf-8")
        result = decode_payload(payload)

        assert result == data

    def test_decode_unicode_payload(self):
        """Test decoding a payload with unicode."""
        data = {"emoji": "👋", "text": "日本語"}
        payload = json.dumps(data).encode("utf-8")
        result = decode_payload(payload)

        assert result == data

    def test_decode_invalid_json(self):
        """Test that decoding invalid JSON raises an error."""
        payload = b"not valid json"
        with pytest.raises(InvalidMessageError):
            decode_payload(payload)

    def test_decode_json_array_not_object(self):
        """Test that decoding a JSON array raises an error."""
        payload = b"[1, 2, 3]"
        with pytest.raises(InvalidMessageError):
            decode_payload(payload)

    def test_decode_json_string_not_object(self):
        """Test that decoding a JSON string raises an error."""
        payload = b'"just a string"'
        with pytest.raises(InvalidMessageError):
            decode_payload(payload)

    def test_decode_invalid_utf8(self):
        """Test that decoding invalid UTF-8 raises an error."""
        payload = b"\xff\xfe"
        with pytest.raises(InvalidMessageError):
            decode_payload(payload)


class TestRoundTrip:
    """Tests for encoding and then decoding messages."""

    def test_roundtrip_simple(self):
        """Test that a simple message survives round-trip."""
        original = {"type": "hello", "request_id": "abc-123"}
        encoded = encode_message(original)

        # Decode
        length = decode_length_prefix(encoded[:4])
        decoded = decode_payload(encoded[4 : 4 + length])

        assert decoded == original

    def test_roundtrip_complex(self):
        """Test that a complex message survives round-trip."""
        original = {
            "type": "complex",
            "request_id": "xyz",
            "data": {
                "numbers": [1, 2, 3, 4, 5],
                "strings": ["a", "b", "c"],
                "nested": {"deep": {"value": True}},
            },
            "nullable": None,
            "boolean": False,
        }
        encoded = encode_message(original)

        length = decode_length_prefix(encoded[:4])
        decoded = decode_payload(encoded[4 : 4 + length])

        assert decoded == original

    def test_roundtrip_unicode(self):
        """Test that unicode messages survive round-trip."""
        original = {
            "type": "i18n",
            "languages": {
                "en": "Hello",
                "es": "Hola",
                "ja": "こんにちは",
                "ar": "مرحبا",
                "emoji": "👋🌍",
            },
        }
        encoded = encode_message(original)

        length = decode_length_prefix(encoded[:4])
        decoded = decode_payload(encoded[4 : 4 + length])

        assert decoded == original
