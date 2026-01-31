#!/bin/bash
# Copy harbor-bridge binary into the app bundle
# This script is run as a build phase in Xcode
#
# The bridge runs as an HTTP server started by the main app,
# so it goes in the main app's MacOS folder.

BRIDGE_SOURCE="${SRCROOT}/../../../bridge-rs/target/release/harbor-bridge"

# Also check the Harbor folder (where we copy it during development)
if [ ! -f "$BRIDGE_SOURCE" ]; then
    BRIDGE_SOURCE="${SRCROOT}/harbor-bridge"
fi

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
