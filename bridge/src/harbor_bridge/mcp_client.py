"""MCP client interface for remote MCP servers.

This module provides an abstraction over MCP protocol operations.
Currently implements basic connectivity checks with placeholders for
full MCP protocol support.

The interface is designed to be swappable with a full MCP library implementation.
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


@dataclass
class MCPTool:
    """Represents an MCP tool."""

    name: str
    description: str
    input_schema: Dict[str, Any]


@dataclass
class MCPResource:
    """Represents an MCP resource."""

    uri: str
    name: str
    description: Optional[str] = None
    mime_type: Optional[str] = None


@dataclass
class MCPPrompt:
    """Represents an MCP prompt."""

    name: str
    description: Optional[str] = None
    arguments: Optional[List[Dict[str, Any]]] = None


@dataclass
class ConnectionResult:
    """Result of a connection attempt."""

    success: bool
    message: str
    server_info: Optional[Dict[str, Any]] = None


@dataclass
class ToolCallResult:
    """Result of a tool invocation."""

    success: bool
    content: Any
    error: Optional[str] = None


class MCPClientInterface(ABC):
    """Abstract interface for MCP client implementations.

    This interface allows swapping between a stub implementation
    and a full MCP library implementation.
    """

    @abstractmethod
    async def connect(self, base_url: str, timeout: float = 10.0) -> ConnectionResult:
        """Attempt to connect to an MCP server.

        Args:
            base_url: The server's base URL.
            timeout: Connection timeout in seconds.

        Returns:
            ConnectionResult with success status and details.
        """
        ...

    @abstractmethod
    async def disconnect(self, base_url: str) -> None:
        """Disconnect from an MCP server.

        Args:
            base_url: The server's base URL.
        """
        ...

    @abstractmethod
    async def list_tools(self, base_url: str) -> List[MCPTool]:
        """List available tools from a connected server.

        Args:
            base_url: The server's base URL.

        Returns:
            List of available tools.
        """
        ...

    @abstractmethod
    async def list_resources(self, base_url: str) -> List[MCPResource]:
        """List available resources from a connected server.

        Args:
            base_url: The server's base URL.

        Returns:
            List of available resources.
        """
        ...

    @abstractmethod
    async def list_prompts(self, base_url: str) -> List[MCPPrompt]:
        """List available prompts from a connected server.

        Args:
            base_url: The server's base URL.

        Returns:
            List of available prompts.
        """
        ...

    @abstractmethod
    async def call_tool(
        self,
        base_url: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> ToolCallResult:
        """Invoke a tool on a connected server.

        Args:
            base_url: The server's base URL.
            tool_name: Name of the tool to invoke.
            arguments: Tool arguments.

        Returns:
            ToolCallResult with the invocation result.
        """
        ...


class StubMCPClient(MCPClientInterface):
    """Stub MCP client for v0 scaffolding.

    Implements basic connectivity checks via HTTP.
    Full MCP protocol operations return placeholders.
    """

    def __init__(self) -> None:
        self._connected: set[str] = set()

    async def connect(self, base_url: str, timeout: float = 10.0) -> ConnectionResult:
        """Attempt to connect by checking server health endpoint."""
        # Validate URL format
        try:
            parsed = urlparse(base_url)
            if not parsed.scheme or not parsed.netloc:
                return ConnectionResult(
                    success=False,
                    message=f"Invalid URL format: {base_url}",
                )
        except Exception as e:
            return ConnectionResult(
                success=False,
                message=f"URL parsing error: {e}",
            )

        # Try to reach the server
        try:
            # Use urllib since we want to keep dependencies minimal
            import urllib.request
            import urllib.error

            # Try /health first, then base URL
            urls_to_try = [
                base_url.rstrip("/") + "/health",
                base_url,
            ]

            last_error: Optional[str] = None
            for url in urls_to_try:
                try:

                    def _fetch() -> Dict[str, Any]:
                        req = urllib.request.Request(url, method="GET")
                        req.add_header("Accept", "application/json")
                        with urllib.request.urlopen(req, timeout=timeout) as resp:
                            return {
                                "status_code": resp.status,
                                "url": url,
                            }

                    result = await asyncio.to_thread(_fetch)
                    self._connected.add(base_url)
                    return ConnectionResult(
                        success=True,
                        message=f"Connected to {result['url']}",
                        server_info=result,
                    )
                except urllib.error.HTTPError as e:
                    last_error = f"HTTP {e.code}: {e.reason}"
                except urllib.error.URLError as e:
                    last_error = f"Connection failed: {e.reason}"
                except Exception as e:
                    last_error = str(e)

            return ConnectionResult(
                success=False,
                message=last_error or "Unknown error",
            )

        except Exception as e:
            return ConnectionResult(
                success=False,
                message=f"Connection error: {e}",
            )

    async def disconnect(self, base_url: str) -> None:
        """Mark server as disconnected."""
        self._connected.discard(base_url)

    async def list_tools(self, base_url: str) -> List[MCPTool]:
        """Return empty list - placeholder for MCP tools/list."""
        # TODO: Implement MCP tools/list protocol
        logger.debug(f"list_tools called for {base_url} - returning placeholder")
        return []

    async def list_resources(self, base_url: str) -> List[MCPResource]:
        """Return empty list - placeholder for MCP resources/list."""
        # TODO: Implement MCP resources/list protocol
        logger.debug(f"list_resources called for {base_url} - returning placeholder")
        return []

    async def list_prompts(self, base_url: str) -> List[MCPPrompt]:
        """Return empty list - placeholder for MCP prompts/list."""
        # TODO: Implement MCP prompts/list protocol
        logger.debug(f"list_prompts called for {base_url} - returning placeholder")
        return []

    async def call_tool(
        self,
        base_url: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> ToolCallResult:
        """Placeholder for tool invocation."""
        # TODO: Implement MCP tools/call protocol
        logger.debug(f"call_tool({tool_name}) called for {base_url} - placeholder")
        return ToolCallResult(
            success=False,
            content=None,
            error="Tool invocation not yet implemented (MCP protocol TODO)",
        )


# Default client instance
_default_client: Optional[MCPClientInterface] = None


def get_mcp_client() -> MCPClientInterface:
    """Get the default MCP client instance."""
    global _default_client
    if _default_client is None:
        _default_client = StubMCPClient()
    return _default_client


def set_mcp_client(client: MCPClientInterface) -> None:
    """Set a custom MCP client implementation."""
    global _default_client
    _default_client = client
