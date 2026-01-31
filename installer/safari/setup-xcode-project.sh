#!/bin/bash
#
# Safari Extension Xcode Project Setup
#
# This script uses Apple's safari-web-extension-converter to create the
# Xcode project wrapper, then patches it with our custom SafariWebExtensionHandler
# that supports native messaging via harbor-bridge.
#
# Prerequisites:
#   - Xcode (with command line tools)
#   - Node.js and npm (for building the extension)
#
# Usage:
#   ./setup-xcode-project.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXTENSION_DIR="$PROJECT_ROOT/extension"
SAFARI_DIR="$SCRIPT_DIR"
HARBOR_PROJECT="$SAFARI_DIR/Harbor"

echo "=== Harbor Safari Extension Setup ==="
echo ""

# Check prerequisites
if ! command -v xcodebuild &> /dev/null; then
    echo "Error: Xcode command line tools not found."
    echo "Install with: xcode-select --install"
    exit 1
fi

if ! command -v xcrun &> /dev/null; then
    echo "Error: xcrun not found. Ensure Xcode is properly installed."
    exit 1
fi

# Check if converter is available (Xcode 13+)
if ! xcrun --find safari-web-extension-converter &> /dev/null; then
    echo "Error: safari-web-extension-converter not found."
    echo "This tool requires Xcode 13 or later."
    exit 1
fi

# Build the extension first
echo "Step 1: Building extension for Safari..."
cd "$EXTENSION_DIR"

if [ ! -f "package.json" ]; then
    echo "Error: package.json not found in $EXTENSION_DIR"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "  Installing dependencies..."
    npm install
fi

# Build Safari variant (outputs to dist-safari/)
echo "  Running build:safari..."
npm run build:safari

# Check if project already exists
if [ -d "$HARBOR_PROJECT" ]; then
    echo ""
    echo "Warning: Xcode project already exists at $HARBOR_PROJECT"
    read -p "Do you want to regenerate it? This will overwrite existing files. [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing project."
        echo "To update just the handler, run:"
        echo "  cp $SAFARI_DIR/SafariWebExtensionHandler.swift \"$HARBOR_PROJECT/Harbor Extension/SafariWebExtensionHandler.swift\""
        exit 0
    fi
    rm -rf "$HARBOR_PROJECT"
fi

# Create the Xcode project using Apple's converter
echo ""
echo "Step 2: Creating Xcode project with safari-web-extension-converter..."
echo ""

cd "$SAFARI_DIR"

# Use the Safari manifest
MANIFEST_PATH="$EXTENSION_DIR/manifest.safari.json"
if [ ! -f "$MANIFEST_PATH" ]; then
    MANIFEST_PATH="$EXTENSION_DIR/manifest.json"
fi

# Create a temporary directory with extension files
# The converter expects a flat structure with manifest.json at the root
TEMP_EXT_DIR=$(mktemp -d)
trap "rm -rf $TEMP_EXT_DIR" EXIT

# Safari build output is in dist-safari/ which already contains everything
# including manifest.json, assets/, demo/, etc.
SAFARI_DIST="$EXTENSION_DIR/dist-safari"

if [ ! -d "$SAFARI_DIST" ]; then
    echo "Error: Safari build output not found at $SAFARI_DIST"
    exit 1
fi

# Copy all built files (dist-safari already has the correct structure)
cp -r "$SAFARI_DIST/"* "$TEMP_EXT_DIR/"

echo "  Extension files prepared in: $TEMP_EXT_DIR"

# Run the converter
# --app-name: Name of the app
# --bundle-identifier: Base bundle ID
# --swift: Use Swift for the handler
# --macos-only: Only generate macOS target
# --copy-resources: Copy files into project (required since temp dir is deleted)
# --no-open: Don't open Xcode automatically
# --no-prompt: Don't prompt for confirmation
xcrun safari-web-extension-converter "$TEMP_EXT_DIR" \
    --app-name "Harbor" \
    --bundle-identifier "org.harbor" \
    --swift \
    --macos-only \
    --copy-resources \
    --no-open \
    --no-prompt \
    --project-location "$SAFARI_DIR" \
    --force

echo ""
echo "Step 3: Patching with custom SafariWebExtensionHandler..."

# Replace the generated handler with our custom one
HANDLER_DEST="$HARBOR_PROJECT/Harbor Extension/SafariWebExtensionHandler.swift"
if [ -f "$HANDLER_DEST" ]; then
    cp "$SAFARI_DIR/SafariWebExtensionHandler.swift" "$HANDLER_DEST"
    echo "  Replaced SafariWebExtensionHandler.swift"
else
    echo "Warning: Could not find generated handler at $HANDLER_DEST"
    echo "  You may need to manually copy SafariWebExtensionHandler.swift"
fi

# Create a build phase script to copy harbor-bridge binary
echo ""
echo "Step 4: Adding harbor-bridge build integration..."

# Create the copy script
cat > "$HARBOR_PROJECT/copy-harbor-bridge.sh" << 'COPY_SCRIPT'
#!/bin/bash
# Copy harbor-bridge binary into the app bundle
# This script is run as a build phase in Xcode

BRIDGE_SOURCE="${SRCROOT}/../../bridge-rs/target/release/harbor-bridge"
BRIDGE_DEST="${BUILT_PRODUCTS_DIR}/${PRODUCT_NAME}.app/Contents/MacOS/harbor-bridge"

if [ -f "$BRIDGE_SOURCE" ]; then
    echo "Copying harbor-bridge to app bundle..."
    cp "$BRIDGE_SOURCE" "$BRIDGE_DEST"
    chmod +x "$BRIDGE_DEST"
    echo "Done: $BRIDGE_DEST"
else
    echo "warning: harbor-bridge not found at $BRIDGE_SOURCE"
    echo "Build the bridge first: cd bridge-rs && cargo build --release"
fi
COPY_SCRIPT

chmod +x "$HARBOR_PROJECT/copy-harbor-bridge.sh"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo ""
echo "1. Build harbor-bridge (if not already done):"
echo "   cd $PROJECT_ROOT/bridge-rs"
echo "   cargo build --release"
echo ""
echo "2. Open the Xcode project:"
echo "   open $HARBOR_PROJECT/Harbor.xcodeproj"
echo ""
echo "3. In Xcode, add a 'Run Script' build phase to the Harbor target:"
echo "   - Select Harbor target → Build Phases → + → New Run Script Phase"
echo "   - Add: \"\${SRCROOT}/copy-harbor-bridge.sh\""
echo "   - Drag it AFTER 'Copy Bundle Resources'"
echo ""
echo "4. Configure code signing:"
echo "   - Select Harbor target → Signing & Capabilities"
echo "   - Select your development team"
echo "   - Do the same for 'Harbor Extension' target"
echo ""
echo "5. Build and run (⌘R)"
echo ""
echo "6. Enable the extension in Safari:"
echo "   - Safari → Settings → Extensions"
echo "   - Check 'Harbor'"
echo ""
echo "For development, you may need:"
echo "   Safari → Develop → Allow Unsigned Extensions"
echo ""
