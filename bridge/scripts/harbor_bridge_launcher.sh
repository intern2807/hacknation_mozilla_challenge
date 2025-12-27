#!/bin/bash
# Harbor Bridge Launcher
# This script is called by Firefox to start the native messaging bridge

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$(dirname "$SCRIPT_DIR")"

# Activate virtual environment if it exists
if [ -d "$BRIDGE_DIR/.venv" ]; then
    source "$BRIDGE_DIR/.venv/bin/activate"
fi

# Run the bridge
exec python -m harbor_bridge.main

