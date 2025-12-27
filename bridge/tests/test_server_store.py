"""Tests for server store."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from harbor_bridge.server_store import MCPServer, ServerStatus, ServerStore


@pytest.fixture
def temp_store() -> ServerStore:
    """Create a temporary server store for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield ServerStore(data_dir=Path(tmpdir))


class TestMCPServer:
    """Tests for MCPServer dataclass."""

    def test_to_dict(self):
        """Test converting server to dictionary."""
        server = MCPServer(
            server_id="s1",
            label="Test",
            base_url="http://localhost:8000",
            status=ServerStatus.CONNECTED,
        )
        d = server.to_dict()

        assert d["server_id"] == "s1"
        assert d["label"] == "Test"
        assert d["base_url"] == "http://localhost:8000"
        assert d["status"] == "connected"
        assert d["error_message"] is None

    def test_from_dict(self):
        """Test creating server from dictionary."""
        d = {
            "server_id": "s1",
            "label": "Test",
            "base_url": "http://localhost:8000",
            "status": "connected",
        }
        server = MCPServer.from_dict(d)

        assert server.server_id == "s1"
        assert server.label == "Test"
        assert server.status == ServerStatus.CONNECTED


class TestServerStore:
    """Tests for ServerStore."""

    @pytest.mark.asyncio
    async def test_add_server(self, temp_store):
        """Test adding a server."""
        server = await temp_store.add_server("Test", "http://localhost:8000")

        assert server.label == "Test"
        assert server.base_url == "http://localhost:8000"
        assert server.server_id is not None
        assert server.status == ServerStatus.DISCONNECTED

    @pytest.mark.asyncio
    async def test_list_servers(self, temp_store):
        """Test listing servers."""
        await temp_store.add_server("S1", "http://localhost:8001")
        await temp_store.add_server("S2", "http://localhost:8002")

        servers = await temp_store.list_servers()
        assert len(servers) == 2

    @pytest.mark.asyncio
    async def test_get_server(self, temp_store):
        """Test getting a server by ID."""
        server = await temp_store.add_server("Test", "http://localhost:8000")
        fetched = await temp_store.get_server(server.server_id)

        assert fetched is not None
        assert fetched.server_id == server.server_id

    @pytest.mark.asyncio
    async def test_get_server_not_found(self, temp_store):
        """Test getting a non-existent server."""
        fetched = await temp_store.get_server("nonexistent")
        assert fetched is None

    @pytest.mark.asyncio
    async def test_remove_server(self, temp_store):
        """Test removing a server."""
        server = await temp_store.add_server("Test", "http://localhost:8000")
        removed = await temp_store.remove_server(server.server_id)

        assert removed is True
        assert await temp_store.get_server(server.server_id) is None

    @pytest.mark.asyncio
    async def test_remove_server_not_found(self, temp_store):
        """Test removing a non-existent server."""
        removed = await temp_store.remove_server("nonexistent")
        assert removed is False

    @pytest.mark.asyncio
    async def test_update_status(self, temp_store):
        """Test updating server status."""
        server = await temp_store.add_server("Test", "http://localhost:8000")
        await temp_store.update_status(server.server_id, ServerStatus.CONNECTED)

        fetched = await temp_store.get_server(server.server_id)
        assert fetched is not None
        assert fetched.status == ServerStatus.CONNECTED

    @pytest.mark.asyncio
    async def test_persistence(self):
        """Test that servers persist across store instances."""
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)

            # Create store and add server
            store1 = ServerStore(data_dir=data_dir)
            server = await store1.add_server("Test", "http://localhost:8000")

            # Create new store instance
            store2 = ServerStore(data_dir=data_dir)
            servers = await store2.list_servers()

            assert len(servers) == 1
            assert servers[0].label == "Test"
            # Status should be reset to disconnected on load
            assert servers[0].status == ServerStatus.DISCONNECTED
