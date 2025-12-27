"""Server configuration storage and management.

Stores MCP server configurations in a JSON file with in-memory caching.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional


class ServerStatus(str, Enum):
    """Connection status for an MCP server."""

    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class MCPServer:
    """Configuration and state for an MCP server."""

    server_id: str
    label: str
    base_url: str
    status: ServerStatus = ServerStatus.DISCONNECTED
    error_message: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "server_id": self.server_id,
            "label": self.label,
            "base_url": self.base_url,
            "status": self.status.value,
            "error_message": self.error_message,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MCPServer":
        """Create from dictionary."""
        return cls(
            server_id=data["server_id"],
            label=data["label"],
            base_url=data["base_url"],
            status=ServerStatus(data.get("status", "disconnected")),
            error_message=data.get("error_message"),
        )


@dataclass
class ServerStore:
    """Manages MCP server configurations with file persistence."""

    data_dir: Path
    servers: Dict[str, MCPServer] = field(default_factory=dict)
    _loaded: bool = field(default=False, repr=False)

    @property
    def servers_file(self) -> Path:
        """Path to the servers JSON file."""
        return self.data_dir / "servers.json"

    async def ensure_loaded(self) -> None:
        """Load servers from disk if not already loaded."""
        if self._loaded:
            return
        await self.load()

    async def load(self) -> None:
        """Load servers from the JSON file."""

        def _read() -> Dict[str, MCPServer]:
            if not self.servers_file.exists():
                return {}
            try:
                with open(self.servers_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                return {
                    sid: MCPServer.from_dict(server)
                    for sid, server in data.get("servers", {}).items()
                }
            except (json.JSONDecodeError, KeyError, ValueError):
                return {}

        self.servers = await asyncio.to_thread(_read)
        # Reset connection status on load (we're not connected to anything yet)
        for server in self.servers.values():
            server.status = ServerStatus.DISCONNECTED
            server.error_message = None
        self._loaded = True

    async def save(self) -> None:
        """Save servers to the JSON file."""

        def _write() -> None:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            data = {"servers": {sid: s.to_dict() for sid, s in self.servers.items()}}
            with open(self.servers_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

        await asyncio.to_thread(_write)

    async def add_server(self, label: str, base_url: str) -> MCPServer:
        """Add a new server configuration."""
        await self.ensure_loaded()
        server_id = str(uuid.uuid4())
        server = MCPServer(server_id=server_id, label=label, base_url=base_url)
        self.servers[server_id] = server
        await self.save()
        return server

    async def remove_server(self, server_id: str) -> bool:
        """Remove a server configuration."""
        await self.ensure_loaded()
        if server_id in self.servers:
            del self.servers[server_id]
            await self.save()
            return True
        return False

    async def get_server(self, server_id: str) -> Optional[MCPServer]:
        """Get a server by ID."""
        await self.ensure_loaded()
        return self.servers.get(server_id)

    async def list_servers(self) -> List[MCPServer]:
        """List all servers."""
        await self.ensure_loaded()
        return list(self.servers.values())

    async def update_status(
        self,
        server_id: str,
        status: ServerStatus,
        error_message: Optional[str] = None,
    ) -> Optional[MCPServer]:
        """Update a server's connection status."""
        await self.ensure_loaded()
        server = self.servers.get(server_id)
        if server:
            server.status = status
            server.error_message = error_message
            # Don't save status changes - they're runtime state
        return server
