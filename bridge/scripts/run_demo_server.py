#!/usr/bin/env python3
"""Demo MCP server for testing Harbor bridge connectivity.

This is a minimal HTTP server that provides a /health endpoint
for testing the connect/disconnect functionality without needing
a full MCP server implementation.

Usage:
    python run_demo_server.py [--port PORT]

Default port is 8765.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any, Dict

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


class DemoMCPHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the demo MCP server."""

    def _send_json(self, status: int, data: Dict[str, Any]) -> None:
        """Send a JSON response."""
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        """Handle GET requests."""
        logger.info(f"GET {self.path}")

        if self.path == "/health" or self.path == "/":
            self._send_json(
                200,
                {
                    "status": "healthy",
                    "server": "harbor-demo-mcp",
                    "version": "0.0.1",
                    "timestamp": datetime.now().isoformat(),
                    "message": "This is a demo MCP server for testing Harbor connectivity.",
                },
            )
        elif self.path == "/mcp":
            # Placeholder for future MCP endpoint
            self._send_json(
                200,
                {
                    "protocol": "mcp",
                    "version": "1.0",
                    "_note": "Full MCP protocol not implemented in demo server",
                },
            )
        else:
            self._send_json(
                404,
                {
                    "error": "not_found",
                    "path": self.path,
                },
            )

    def do_OPTIONS(self) -> None:
        """Handle CORS preflight requests."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        """Override to suppress default logging."""
        pass


def main() -> None:
    """Run the demo server."""
    parser = argparse.ArgumentParser(description="Demo MCP server for Harbor testing")
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="Port to listen on (default: 8765)",
    )
    parser.add_argument(
        "--host",
        type=str,
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)",
    )
    args = parser.parse_args()

    server_address = (args.host, args.port)
    httpd = HTTPServer(server_address, DemoMCPHandler)

    logger.info(f"Starting demo MCP server on http://{args.host}:{args.port}")
    logger.info("Endpoints:")
    logger.info(f"  - http://{args.host}:{args.port}/health")
    logger.info(f"  - http://{args.host}:{args.port}/mcp")
    logger.info("Press Ctrl+C to stop")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        httpd.shutdown()


if __name__ == "__main__":
    main()
