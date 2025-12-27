"""Message handlers for the native messaging bridge.

Each handler processes a specific message type and returns a response.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable, Coroutine, Dict, Optional

from harbor_bridge import __version__
from harbor_bridge.mcp_client import get_mcp_client
from harbor_bridge.server_store import MCPServer, ServerStatus, ServerStore

logger = logging.getLogger(__name__)

# Type alias for message handlers
MessageHandler = Callable[[Dict[str, Any], ServerStore], Coroutine[Any, Any, Dict[str, Any]]]


def make_error_response(
    request_id: str,
    code: str,
    message: str,
    details: Optional[Any] = None,
) -> Dict[str, Any]:
    """Create a standardized error response."""
    error: Dict[str, Any] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return {
        "type": "error",
        "request_id": request_id,
        "error": error,
    }


def make_result_response(
    request_type: str,
    request_id: str,
    **kwargs: Any,
) -> Dict[str, Any]:
    """Create a standardized result response."""
    return {
        "type": f"{request_type}_result",
        "request_id": request_id,
        **kwargs,
    }


async def handle_hello(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle hello message - returns pong with bridge version."""
    return {
        "type": "pong",
        "request_id": message.get("request_id", ""),
        "bridge_version": __version__,
    }


async def handle_add_server(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle add_server message - adds a new MCP server configuration."""
    request_id = message.get("request_id", "")
    label = message.get("label")
    base_url = message.get("base_url")

    if not label or not isinstance(label, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'label' parameter",
        )

    if not base_url or not isinstance(base_url, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'base_url' parameter",
        )

    try:
        server = await store.add_server(label=label, base_url=base_url)
        return make_result_response(
            "add_server",
            request_id,
            server=server.to_dict(),
        )
    except Exception as e:
        logger.exception("Failed to add server")
        return make_error_response(
            request_id,
            "internal_error",
            f"Failed to add server: {e}",
        )


async def handle_remove_server(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle remove_server message - removes an MCP server configuration."""
    request_id = message.get("request_id", "")
    server_id = message.get("server_id")

    if not server_id or not isinstance(server_id, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'server_id' parameter",
        )

    try:
        removed = await store.remove_server(server_id)
        if not removed:
            return make_error_response(
                request_id,
                "not_found",
                f"Server not found: {server_id}",
            )
        return make_result_response("remove_server", request_id, removed=True)
    except Exception as e:
        logger.exception("Failed to remove server")
        return make_error_response(
            request_id,
            "internal_error",
            f"Failed to remove server: {e}",
        )


async def handle_list_servers(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle list_servers message - returns all configured servers."""
    request_id = message.get("request_id", "")

    try:
        servers = await store.list_servers()
        return make_result_response(
            "list_servers",
            request_id,
            servers=[s.to_dict() for s in servers],
        )
    except Exception as e:
        logger.exception("Failed to list servers")
        return make_error_response(
            request_id,
            "internal_error",
            f"Failed to list servers: {e}",
        )


async def handle_connect_server(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle connect_server message - attempts to connect to an MCP server."""
    request_id = message.get("request_id", "")
    server_id = message.get("server_id")

    if not server_id or not isinstance(server_id, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'server_id' parameter",
        )

    server = await store.get_server(server_id)
    if not server:
        return make_error_response(
            request_id,
            "not_found",
            f"Server not found: {server_id}",
        )

    # Update status to connecting
    await store.update_status(server_id, ServerStatus.CONNECTING)

    try:
        client = get_mcp_client()
        result = await client.connect(server.base_url)

        if result.success:
            await store.update_status(server_id, ServerStatus.CONNECTED)
            return make_result_response(
                "connect_server",
                request_id,
                server=server.to_dict(),
                connection_info=result.server_info,
            )
        else:
            await store.update_status(server_id, ServerStatus.ERROR, result.message)
            return make_error_response(
                request_id,
                "connection_failed",
                result.message,
            )
    except Exception as e:
        logger.exception("Failed to connect to server")
        await store.update_status(server_id, ServerStatus.ERROR, str(e))
        return make_error_response(
            request_id,
            "connection_error",
            f"Connection error: {e}",
        )


async def handle_disconnect_server(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle disconnect_server message - disconnects from an MCP server."""
    request_id = message.get("request_id", "")
    server_id = message.get("server_id")

    if not server_id or not isinstance(server_id, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'server_id' parameter",
        )

    server = await store.get_server(server_id)
    if not server:
        return make_error_response(
            request_id,
            "not_found",
            f"Server not found: {server_id}",
        )

    try:
        client = get_mcp_client()
        await client.disconnect(server.base_url)
        await store.update_status(server_id, ServerStatus.DISCONNECTED)

        # Refresh server state
        server = await store.get_server(server_id)
        return make_result_response(
            "disconnect_server",
            request_id,
            server=server.to_dict() if server else None,
        )
    except Exception as e:
        logger.exception("Failed to disconnect from server")
        return make_error_response(
            request_id,
            "internal_error",
            f"Failed to disconnect: {e}",
        )


async def handle_list_tools(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle list_tools message - lists tools from a connected MCP server."""
    request_id = message.get("request_id", "")
    server_id = message.get("server_id")

    if not server_id or not isinstance(server_id, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'server_id' parameter",
        )

    server = await store.get_server(server_id)
    if not server:
        return make_error_response(
            request_id,
            "not_found",
            f"Server not found: {server_id}",
        )

    if server.status != ServerStatus.CONNECTED:
        return make_error_response(
            request_id,
            "not_connected",
            f"Server is not connected (status: {server.status.value})",
        )

    try:
        client = get_mcp_client()
        tools = await client.list_tools(server.base_url)
        return make_result_response(
            "list_tools",
            request_id,
            tools=[asdict(t) for t in tools],
            _todo="Full MCP tools/list protocol not yet implemented",
        )
    except Exception as e:
        logger.exception("Failed to list tools")
        return make_error_response(
            request_id,
            "internal_error",
            f"Failed to list tools: {e}",
        )


async def handle_list_resources(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle list_resources message - lists resources from a connected MCP server."""
    request_id = message.get("request_id", "")
    server_id = message.get("server_id")

    if not server_id or not isinstance(server_id, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'server_id' parameter",
        )

    server = await store.get_server(server_id)
    if not server:
        return make_error_response(
            request_id,
            "not_found",
            f"Server not found: {server_id}",
        )

    if server.status != ServerStatus.CONNECTED:
        return make_error_response(
            request_id,
            "not_connected",
            f"Server is not connected (status: {server.status.value})",
        )

    try:
        client = get_mcp_client()
        resources = await client.list_resources(server.base_url)
        return make_result_response(
            "list_resources",
            request_id,
            resources=[asdict(r) for r in resources],
            _todo="Full MCP resources/list protocol not yet implemented",
        )
    except Exception as e:
        logger.exception("Failed to list resources")
        return make_error_response(
            request_id,
            "internal_error",
            f"Failed to list resources: {e}",
        )


async def handle_list_prompts(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle list_prompts message - lists prompts from a connected MCP server."""
    request_id = message.get("request_id", "")
    server_id = message.get("server_id")

    if not server_id or not isinstance(server_id, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'server_id' parameter",
        )

    server = await store.get_server(server_id)
    if not server:
        return make_error_response(
            request_id,
            "not_found",
            f"Server not found: {server_id}",
        )

    if server.status != ServerStatus.CONNECTED:
        return make_error_response(
            request_id,
            "not_connected",
            f"Server is not connected (status: {server.status.value})",
        )

    try:
        client = get_mcp_client()
        prompts = await client.list_prompts(server.base_url)
        return make_result_response(
            "list_prompts",
            request_id,
            prompts=[asdict(p) for p in prompts],
            _todo="Full MCP prompts/list protocol not yet implemented",
        )
    except Exception as e:
        logger.exception("Failed to list prompts")
        return make_error_response(
            request_id,
            "internal_error",
            f"Failed to list prompts: {e}",
        )


async def handle_call_tool(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Handle call_tool message - invokes a tool on a connected MCP server."""
    request_id = message.get("request_id", "")
    server_id = message.get("server_id")
    tool_name = message.get("tool_name")
    arguments = message.get("arguments", {})

    if not server_id or not isinstance(server_id, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'server_id' parameter",
        )

    if not tool_name or not isinstance(tool_name, str):
        return make_error_response(
            request_id,
            "invalid_params",
            "Missing or invalid 'tool_name' parameter",
        )

    server = await store.get_server(server_id)
    if not server:
        return make_error_response(
            request_id,
            "not_found",
            f"Server not found: {server_id}",
        )

    if server.status != ServerStatus.CONNECTED:
        return make_error_response(
            request_id,
            "not_connected",
            f"Server is not connected (status: {server.status.value})",
        )

    try:
        client = get_mcp_client()
        result = await client.call_tool(server.base_url, tool_name, arguments)

        if result.success:
            return make_result_response(
                "call_tool",
                request_id,
                content=result.content,
            )
        else:
            return make_error_response(
                request_id,
                "tool_error",
                result.error or "Tool invocation failed",
            )
    except Exception as e:
        logger.exception("Failed to call tool")
        return make_error_response(
            request_id,
            "internal_error",
            f"Failed to call tool: {e}",
        )


# Handler registry
HANDLERS: Dict[str, MessageHandler] = {
    "hello": handle_hello,
    "add_server": handle_add_server,
    "remove_server": handle_remove_server,
    "list_servers": handle_list_servers,
    "connect_server": handle_connect_server,
    "disconnect_server": handle_disconnect_server,
    "list_tools": handle_list_tools,
    "list_resources": handle_list_resources,
    "list_prompts": handle_list_prompts,
    "call_tool": handle_call_tool,
}


async def dispatch_message(message: Dict[str, Any], store: ServerStore) -> Dict[str, Any]:
    """Dispatch a message to the appropriate handler."""
    message_type = message.get("type")
    request_id = message.get("request_id", "")

    if not message_type:
        return make_error_response(
            request_id,
            "invalid_message",
            "Missing 'type' field in message",
        )

    handler = HANDLERS.get(message_type)
    if not handler:
        return make_error_response(
            request_id,
            "unknown_message_type",
            f"Unknown message type: {message_type}",
            details={"received_type": message_type},
        )

    return await handler(message, store)
