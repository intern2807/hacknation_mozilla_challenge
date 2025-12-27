"""Tests for message handlers."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Dict

import pytest

from harbor_bridge.handlers import (
    dispatch_message,
    handle_hello,
    handle_add_server,
    handle_list_servers,
    make_error_response,
    make_result_response,
)
from harbor_bridge.server_store import ServerStore


@pytest.fixture
def temp_store() -> ServerStore:
    """Create a temporary server store for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield ServerStore(data_dir=Path(tmpdir))


class TestHelpers:
    """Tests for helper functions."""

    def test_make_error_response(self):
        """Test error response creation."""
        response = make_error_response(
            "req-123",
            "some_error",
            "Something went wrong",
        )
        assert response["type"] == "error"
        assert response["request_id"] == "req-123"
        assert response["error"]["code"] == "some_error"
        assert response["error"]["message"] == "Something went wrong"
        assert "details" not in response["error"]

    def test_make_error_response_with_details(self):
        """Test error response creation with details."""
        response = make_error_response(
            "req-123",
            "some_error",
            "Something went wrong",
            details={"extra": "info"},
        )
        assert response["error"]["details"] == {"extra": "info"}

    def test_make_result_response(self):
        """Test result response creation."""
        response = make_result_response(
            "add_server",
            "req-123",
            server={"id": "s1"},
        )
        assert response["type"] == "add_server_result"
        assert response["request_id"] == "req-123"
        assert response["server"] == {"id": "s1"}


class TestHelloHandler:
    """Tests for hello message handler."""

    @pytest.mark.asyncio
    async def test_hello_returns_pong(self, temp_store):
        """Test that hello returns pong with version."""
        message = {"type": "hello", "request_id": "test-123"}
        response = await handle_hello(message, temp_store)

        assert response["type"] == "pong"
        assert response["request_id"] == "test-123"
        assert "bridge_version" in response


class TestAddServerHandler:
    """Tests for add_server message handler."""

    @pytest.mark.asyncio
    async def test_add_server_success(self, temp_store):
        """Test successful server addition."""
        message = {
            "type": "add_server",
            "request_id": "req-1",
            "label": "Test Server",
            "base_url": "http://localhost:8000",
        }
        response = await handle_add_server(message, temp_store)

        assert response["type"] == "add_server_result"
        assert response["request_id"] == "req-1"
        assert "server" in response
        assert response["server"]["label"] == "Test Server"
        assert response["server"]["base_url"] == "http://localhost:8000"
        assert "server_id" in response["server"]

    @pytest.mark.asyncio
    async def test_add_server_missing_label(self, temp_store):
        """Test add_server with missing label."""
        message = {
            "type": "add_server",
            "request_id": "req-1",
            "base_url": "http://localhost:8000",
        }
        response = await handle_add_server(message, temp_store)

        assert response["type"] == "error"
        assert response["error"]["code"] == "invalid_params"

    @pytest.mark.asyncio
    async def test_add_server_missing_url(self, temp_store):
        """Test add_server with missing URL."""
        message = {
            "type": "add_server",
            "request_id": "req-1",
            "label": "Test",
        }
        response = await handle_add_server(message, temp_store)

        assert response["type"] == "error"
        assert response["error"]["code"] == "invalid_params"


class TestListServersHandler:
    """Tests for list_servers message handler."""

    @pytest.mark.asyncio
    async def test_list_servers_empty(self, temp_store):
        """Test listing servers when none exist."""
        message = {"type": "list_servers", "request_id": "req-1"}
        response = await handle_list_servers(message, temp_store)

        assert response["type"] == "list_servers_result"
        assert response["servers"] == []

    @pytest.mark.asyncio
    async def test_list_servers_with_servers(self, temp_store):
        """Test listing servers after adding some."""
        # Add a server first
        await temp_store.add_server("Server 1", "http://localhost:8001")
        await temp_store.add_server("Server 2", "http://localhost:8002")

        message = {"type": "list_servers", "request_id": "req-1"}
        response = await handle_list_servers(message, temp_store)

        assert response["type"] == "list_servers_result"
        assert len(response["servers"]) == 2


class TestDispatchMessage:
    """Tests for message dispatch."""

    @pytest.mark.asyncio
    async def test_dispatch_hello(self, temp_store):
        """Test dispatching hello message."""
        message = {"type": "hello", "request_id": "req-1"}
        response = await dispatch_message(message, temp_store)

        assert response["type"] == "pong"

    @pytest.mark.asyncio
    async def test_dispatch_unknown_type(self, temp_store):
        """Test dispatching unknown message type."""
        message = {"type": "unknown_type", "request_id": "req-1"}
        response = await dispatch_message(message, temp_store)

        assert response["type"] == "error"
        assert response["error"]["code"] == "unknown_message_type"

    @pytest.mark.asyncio
    async def test_dispatch_missing_type(self, temp_store):
        """Test dispatching message without type."""
        message = {"request_id": "req-1"}
        response = await dispatch_message(message, temp_store)

        assert response["type"] == "error"
        assert response["error"]["code"] == "invalid_message"
