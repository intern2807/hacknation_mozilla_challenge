#!/bin/bash
# Harbor Bridge Launcher
# This script is called by Firefox to start the native messaging bridge

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BRIDGE_DIR"

# Use the Python from the venv directly (uv creates this)
exec "$BRIDGE_DIR/.venv/bin/python" -m harbor_bridge.main
