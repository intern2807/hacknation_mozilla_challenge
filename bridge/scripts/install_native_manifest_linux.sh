#!/bin/bash
# Install Harbor native messaging manifest for Firefox on Linux
# This script is idempotent - safe to run multiple times

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE_PATH="$BRIDGE_DIR/harbor_bridge_host.json.template"
LAUNCHER_PATH="$SCRIPT_DIR/harbor_bridge_launcher.sh"

# Firefox native messaging hosts directory on Linux
MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
MANIFEST_PATH="$MANIFEST_DIR/com.harbor.bridge.json"

# Default extension ID (matches manifest.json)
DEFAULT_EXTENSION_ID="harbor@example.com"

# Check for extension ID argument
EXTENSION_ID="${1:-$DEFAULT_EXTENSION_ID}"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║         Harbor Native Messaging Manifest Installer           ║"
echo "║                        (Linux)                               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Extension ID: $EXTENSION_ID"
echo ""

# Create the manifest directory if it doesn't exist
mkdir -p "$MANIFEST_DIR"
echo "✓ Manifest directory: $MANIFEST_DIR"

# Make the launcher executable
chmod +x "$LAUNCHER_PATH"
echo "✓ Launcher executable: $LAUNCHER_PATH"

# Generate the manifest from template
sed -e "s|__BRIDGE_LAUNCHER_PATH__|$LAUNCHER_PATH|g" \
    -e "s|__EXTENSION_ID__|$EXTENSION_ID|g" \
    "$TEMPLATE_PATH" > "$MANIFEST_PATH"

echo "✓ Manifest installed: $MANIFEST_PATH"
echo ""
echo "────────────────────────────────────────────────────────────────"
cat "$MANIFEST_PATH"
echo ""
echo "────────────────────────────────────────────────────────────────"
echo ""
echo "Installation complete!"
echo ""

# Check if Python environment is set up
if [ ! -d "$BRIDGE_DIR/.venv" ]; then
    echo "⚠  Python environment not found. Set it up with:"
    echo ""
    echo "   cd $BRIDGE_DIR"
    echo "   python3 -m venv .venv"
    echo "   source .venv/bin/activate"
    echo "   pip install --upgrade pip && pip install -e ."
    echo ""
fi

echo "Next steps:"
echo "  1. Load extension in Firefox: about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on' and select extension/dist/manifest.json"
echo "  3. Open the Harbor sidebar and click 'Send Hello'"
echo ""
echo "If using a different extension ID, re-run:"
echo "  $0 YOUR_EXTENSION_ID"
