#!/bin/bash
# Harbor Safari Installer Build Script
# Creates a distributable .pkg or .dmg installer for Safari
#
# This builds:
#   1. harbor-bridge as a universal binary (arm64 + x64)
#   2. Harbor Safari extension
#   3. Web Agents API Safari extension
#   4. Harbor.app wrapper containing everything
#   5. Distributable .pkg installer OR .dmg disk image
#
# Prerequisites:
#   - Xcode 13+ with command line tools
#   - Rust toolchain with both targets: aarch64-apple-darwin, x86_64-apple-darwin
#   - Node.js and npm
#   - Apple Developer account (for signing and notarization)
#
# Usage:
#   ./build-installer.sh              # Build debug .app
#   ./build-installer.sh release      # Build signed release .pkg
#   ./build-installer.sh dmg          # Build .dmg disk image
#   ./build-installer.sh --fast       # Quick dev build (current arch only)
#   ./build-installer.sh --help       # Show all options

set -e

# =============================================================================
# Configuration
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BRIDGE_DIR="$PROJECT_ROOT/bridge-rs"
EXTENSION_DIR="$PROJECT_ROOT/extension"
WEB_AGENTS_DIR="$PROJECT_ROOT/web-agents-api"
XCODE_PROJECT="$SCRIPT_DIR/Harbor/Harbor.xcodeproj"
CREDENTIALS_FILE="$PROJECT_ROOT/installer/credentials.env"

# Output paths
BUILD_DIR="$SCRIPT_DIR/build"
OUTPUT_DIR="$BUILD_DIR/output"

# Version: use timestamp for dev builds, or explicit VERSION env var
if [ -z "$VERSION" ]; then
    VERSION="0.$(date +%y%m%d).$(date +%H%M)"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo_step() {
    echo -e "${BLUE}==>${NC} $1"
}

echo_success() {
    echo -e "${GREEN}✓${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

echo_error() {
    echo -e "${RED}✗${NC} $1"
}

# =============================================================================
# Help
# =============================================================================

show_help() {
    echo "Harbor Safari Installer Builder"
    echo ""
    echo "Usage: $0 [options] [mode]"
    echo ""
    echo "Modes:"
    echo "  (default)         Build debug .app for local testing"
    echo "  release           Build signed release .pkg for distribution"
    echo "  dmg               Build .dmg disk image"
    echo "  app-only          Build just the .app (no installer)"
    echo ""
    echo "Options:"
    echo "  --fast            Quick dev build (current arch only, no signing)"
    echo "  --arch-only       Same as --fast"
    echo "  --universal       Force universal binary (default for release)"
    echo "  --sign            Sign the app with Developer ID"
    echo "  --notarize        Notarize the app for distribution"
    echo "  --clean           Clean all build artifacts before building"
    echo "  --clean-only      Just clean, don't build"
    echo "  --skip-bridge     Skip building harbor-bridge (use existing)"
    echo "  --skip-extensions Skip building extensions (use existing)"
    echo "  --help            Show this help"
    echo ""
    echo "Examples:"
    echo "  $0                          # Debug build for local testing"
    echo "  $0 --fast                   # Quick dev build"
    echo "  $0 release                  # Full release build with signing"
    echo "  $0 dmg --sign --notarize    # Notarized DMG for distribution"
    echo "  $0 --clean release          # Clean build for release"
    echo ""
    echo "Configuration:"
    echo "  Credentials file: $CREDENTIALS_FILE"
    echo "  Copy from: installer/credentials.env.example"
    echo ""
}

# =============================================================================
# Load Credentials
# =============================================================================

load_credentials() {
    if [ -f "$CREDENTIALS_FILE" ]; then
        echo_step "Loading credentials..."
        set -a
        source "$CREDENTIALS_FILE"
        set +a
        echo_success "Credentials loaded"
    else
        echo_warn "No credentials file found at $CREDENTIALS_FILE"
        echo "       Signing and notarization will be skipped"
    fi
}

# =============================================================================
# Prerequisites Check
# =============================================================================

check_prerequisites() {
    echo_step "Checking prerequisites..."
    
    local missing=0
    
    # Xcode
    if ! command -v xcodebuild &> /dev/null; then
        echo_error "Xcode command line tools not found"
        echo "       Install with: xcode-select --install"
        missing=1
    else
        echo "  ✓ Xcode $(xcodebuild -version 2>/dev/null | head -1 | awk '{print $2}')"
    fi
    
    # Rust
    if ! command -v cargo &> /dev/null; then
        echo_error "Rust/Cargo not found"
        echo "       Install from: https://rustup.rs"
        missing=1
    else
        echo "  ✓ Rust $(rustc --version | awk '{print $2}')"
    fi
    
    # Node.js
    if ! command -v node &> /dev/null; then
        echo_error "Node.js not found"
        echo "       Install from: https://nodejs.org"
        missing=1
    else
        echo "  ✓ Node.js $(node --version)"
    fi
    
    # npm
    if ! command -v npm &> /dev/null; then
        echo_error "npm not found"
        missing=1
    else
        echo "  ✓ npm $(npm --version)"
    fi
    
    if [ $missing -eq 1 ]; then
        echo ""
        echo_error "Missing prerequisites. Please install them and try again."
        exit 1
    fi
    
    echo_success "All prerequisites met"
}

# =============================================================================
# Clean
# =============================================================================

clean_all() {
    echo_step "Cleaning all build artifacts..."
    
    # Clean build output
    rm -rf "$BUILD_DIR"
    
    # Clean bridge-rs
    rm -rf "$BRIDGE_DIR/target"
    
    # Clean extension builds
    rm -rf "$EXTENSION_DIR/dist"
    rm -rf "$EXTENSION_DIR/dist-safari"
    rm -rf "$WEB_AGENTS_DIR/dist"
    rm -rf "$WEB_AGENTS_DIR/dist-safari"
    
    # Clean Xcode derived data for this project
    rm -rf "$SCRIPT_DIR/Harbor/build"
    
    echo_success "Clean complete"
}

# =============================================================================
# Build Universal Bridge Binary
# =============================================================================

build_bridge() {
    local universal=$1
    
    echo_step "Building harbor-bridge..."
    
    cd "$BRIDGE_DIR"
    
    if [ "$universal" = true ]; then
        echo "  Building universal binary (arm64 + x64)..."
        
        # Ensure both targets are installed
        rustup target add aarch64-apple-darwin 2>/dev/null || true
        rustup target add x86_64-apple-darwin 2>/dev/null || true
        
        # Build for arm64
        echo "    Compiling for aarch64-apple-darwin..."
        cargo build --release --target aarch64-apple-darwin
        
        # Build for x64
        echo "    Compiling for x86_64-apple-darwin..."
        cargo build --release --target x86_64-apple-darwin
        
        # Create universal binary with lipo
        echo "    Creating universal binary..."
        mkdir -p "$BUILD_DIR"
        lipo -create \
            "target/aarch64-apple-darwin/release/harbor-bridge" \
            "target/x86_64-apple-darwin/release/harbor-bridge" \
            -output "$BUILD_DIR/harbor-bridge"
        
        echo_success "Universal binary: $BUILD_DIR/harbor-bridge"
    else
        echo "  Building for current architecture..."
        cargo build --release
        
        mkdir -p "$BUILD_DIR"
        cp "target/release/harbor-bridge" "$BUILD_DIR/harbor-bridge"
        
        echo_success "Binary: $BUILD_DIR/harbor-bridge"
    fi
    
    chmod +x "$BUILD_DIR/harbor-bridge"
}

# =============================================================================
# Build Extensions
# =============================================================================

build_extensions() {
    echo_step "Building Safari extensions..."
    
    # Build Harbor extension
    echo "  Building Harbor extension..."
    cd "$EXTENSION_DIR"
    
    if [ ! -d "node_modules" ]; then
        echo "    Installing dependencies..."
        npm install
    fi
    
    npm run build:safari
    echo "    ✓ Harbor extension built"
    
    # Build Web Agents API extension
    echo "  Building Web Agents API extension..."
    cd "$WEB_AGENTS_DIR"
    
    if [ ! -d "node_modules" ]; then
        echo "    Installing dependencies..."
        npm install
    fi
    
    npm run build:safari
    echo "    ✓ Web Agents API extension built"
    
    echo_success "Extensions built"
}

# =============================================================================
# Sync Extensions to Xcode Project
# =============================================================================

sync_extensions() {
    echo_step "Syncing extensions to Xcode project..."
    
    # Sync Harbor extension
    local harbor_dist="$EXTENSION_DIR/dist-safari"
    local harbor_resources="$SCRIPT_DIR/Harbor/Harbor Extension/Resources"
    
    if [ -d "$harbor_resources" ]; then
        # Clear old resources
        rm -rf "$harbor_resources/manifest.json" "$harbor_resources/assets" \
               "$harbor_resources/demo" "$harbor_resources/bundled" \
               "$harbor_resources"/*.js "$harbor_resources"/*.html \
               "$harbor_resources"/*.css "$harbor_resources/js-runtime"
        
        # Copy from dist-safari
        cp -r "$harbor_dist/"* "$harbor_resources/"
        echo "  ✓ Harbor Extension synced"
    else
        echo_warn "Harbor Extension Resources not found"
    fi
    
    # Sync Web Agents extension
    local webagents_dist="$WEB_AGENTS_DIR/dist-safari"
    local webagents_resources="$SCRIPT_DIR/Harbor/Web Agents Extension/Resources"
    
    if [ -d "$webagents_resources" ]; then
        # Clear old resources
        rm -rf "$webagents_resources/manifest.json" "$webagents_resources/assets" \
               "$webagents_resources"/*.js "$webagents_resources"/*.html \
               "$webagents_resources"/*.css
        
        # Copy from dist-safari
        cp -r "$webagents_dist/"* "$webagents_resources/"
        echo "  ✓ Web Agents Extension synced"
    else
        echo_warn "Web Agents Extension Resources not found"
    fi
    
    echo_success "Extensions synced"
}

# =============================================================================
# Build Xcode Project
# =============================================================================

build_xcode() {
    local mode=$1  # debug or release
    
    echo_step "Building with Xcode ($mode)..."
    
    # Check if project exists
    if [ ! -d "$XCODE_PROJECT" ]; then
        echo_error "Xcode project not found at $XCODE_PROJECT"
        echo "       Run: $SCRIPT_DIR/setup-xcode-project.sh"
        exit 1
    fi
    
    mkdir -p "$BUILD_DIR"
    
    if [ "$mode" = "release" ]; then
        echo "  Building release archive..."
        
        # For Developer ID signing, we need manual signing style and hardened runtime
        xcodebuild -project "$XCODE_PROJECT" \
            -scheme "Harbor" \
            -configuration Release \
            -archivePath "$BUILD_DIR/Harbor.xcarchive" \
            archive \
            CODE_SIGN_STYLE="Manual" \
            CODE_SIGN_IDENTITY="${CODE_SIGN_IDENTITY:-}" \
            DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-}" \
            PROVISIONING_PROFILE_SPECIFIER="" \
            ENABLE_HARDENED_RUNTIME="YES" \
            PRODUCT_BUNDLE_IDENTIFIER="org.harbor.app"
        
        echo_success "Archive: $BUILD_DIR/Harbor.xcarchive"
        
    else
        echo "  Building debug app..."
        
        xcodebuild -project "$XCODE_PROJECT" \
            -scheme "Harbor" \
            -configuration Debug \
            build \
            SYMROOT="$BUILD_DIR" \
            CODE_SIGN_IDENTITY="-" \
            CODE_SIGNING_ALLOWED="NO"
        
        APP_PATH="$BUILD_DIR/Debug/Harbor.app"
        
        # Copy harbor-bridge to app bundle
        if [ -d "$APP_PATH" ]; then
            cp "$BUILD_DIR/harbor-bridge" "$APP_PATH/Contents/MacOS/harbor-bridge"
            chmod +x "$APP_PATH/Contents/MacOS/harbor-bridge"
            echo "  ✓ Copied harbor-bridge to app bundle"
        fi
        
        echo_success "App: $APP_PATH"
    fi
}

# =============================================================================
# Export from Archive
# =============================================================================

export_app() {
    local sign=$1
    
    echo_step "Exporting app from archive..."
    
    mkdir -p "$OUTPUT_DIR"
    
    # Create export options plist
    local export_plist="$BUILD_DIR/export-options.plist"
    
    if [ "$sign" = true ] && [ -n "$DEVELOPMENT_TEAM" ]; then
        cat > "$export_plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>developer-id</string>
    <key>teamID</key>
    <string>$DEVELOPMENT_TEAM</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
EOF
    else
        cat > "$export_plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>mac-application</string>
    <key>signingStyle</key>
    <string>manual</string>
    <key>signingCertificate</key>
    <string>-</string>
</dict>
</plist>
EOF
    fi
    
    xcodebuild -exportArchive \
        -archivePath "$BUILD_DIR/Harbor.xcarchive" \
        -exportPath "$OUTPUT_DIR" \
        -exportOptionsPlist "$export_plist"
    
    # Copy harbor-bridge to exported app
    local app_path="$OUTPUT_DIR/Harbor.app"
    if [ -d "$app_path" ]; then
        cp "$BUILD_DIR/harbor-bridge" "$app_path/Contents/MacOS/harbor-bridge"
        chmod +x "$app_path/Contents/MacOS/harbor-bridge"
        
        # Re-sign if signing is enabled (with hardened runtime for notarization)
        if [ "$sign" = true ] && [ -n "$CODE_SIGN_IDENTITY" ]; then
            echo "  Signing harbor-bridge with hardened runtime..."
            codesign --force --options runtime --timestamp \
                --sign "$CODE_SIGN_IDENTITY" \
                "$app_path/Contents/MacOS/harbor-bridge"
            
            echo "  Re-signing app bundle..."
            codesign --force --deep --options runtime --timestamp \
                --sign "$CODE_SIGN_IDENTITY" \
                "$app_path"
        fi
    fi
    
    echo_success "Exported: $app_path"
}

# =============================================================================
# Create PKG Installer
# =============================================================================

create_pkg() {
    local sign=$1
    
    echo_step "Creating PKG installer..."
    
    local app_path="$OUTPUT_DIR/Harbor.app"
    local pkg_path="$OUTPUT_DIR/Harbor-${VERSION}.pkg"
    local component_pkg="$BUILD_DIR/Harbor-component.pkg"
    local component_plist="$BUILD_DIR/component.plist"
    
    # Create component plist file
    cat > "$component_plist" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<array>
    <dict>
        <key>BundleHasStrictIdentifier</key>
        <true/>
        <key>BundleIsRelocatable</key>
        <false/>
        <key>BundleIsVersionChecked</key>
        <true/>
        <key>BundleOverwriteAction</key>
        <string>upgrade</string>
        <key>RootRelativeBundlePath</key>
        <string>Harbor.app</string>
    </dict>
</array>
</plist>
PLIST_EOF
    
    # Create component package from app
    pkgbuild \
        --root "$OUTPUT_DIR" \
        --install-location "/Applications" \
        --component-plist "$component_plist" \
        --identifier "org.harbor.app" \
        --version "$VERSION" \
        --scripts "$SCRIPT_DIR/scripts" \
        "$component_pkg"
    
    # Create distribution XML
    local dist_xml="$BUILD_DIR/distribution.xml"
    cat > "$dist_xml" << EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>Harbor for Safari</title>
    <organization>org.harbor</organization>
    <domains enable_localSystem="true"/>
    
    <volume-check>
        <allowed-os-versions>
            <os-version min="12.0"/>
        </allowed-os-versions>
    </volume-check>
    
    <welcome file="welcome.html" mime-type="text/html"/>
    <license file="license.html" mime-type="text/html"/>
    <conclusion file="conclusion.html" mime-type="text/html"/>
    
    <choices-outline>
        <line choice="default">
            <line choice="org.harbor.app"/>
        </line>
    </choices-outline>
    
    <choice id="default"/>
    
    <choice id="org.harbor.app" 
            visible="false" 
            title="Harbor for Safari"
            description="Harbor Safari extension with AI and MCP tools">
        <pkg-ref id="org.harbor.app"/>
    </choice>
    
    <pkg-ref id="org.harbor.app" 
             version="$VERSION" 
             onConclusion="none">Harbor-component.pkg</pkg-ref>
    
</installer-gui-script>
EOF
    
    # Ensure scripts directory exists with postinstall
    mkdir -p "$SCRIPT_DIR/scripts"
    if [ ! -f "$SCRIPT_DIR/scripts/postinstall" ]; then
        cat > "$SCRIPT_DIR/scripts/postinstall" << 'POSTINSTALL_EOF'
#!/bin/bash
# Harbor Safari - Post-install script
# Opens the app and shows instructions

LOG_FILE="/tmp/harbor-safari-install.log"
echo "Harbor Safari post-install started at $(date)" >> "$LOG_FILE"

# Get the actual user
ACTUAL_USER="${SUDO_USER:-}"
if [ -z "$ACTUAL_USER" ]; then
    ACTUAL_USER=$(stat -f '%Su' /dev/console 2>/dev/null || echo "")
fi

echo "Detected user: $ACTUAL_USER" >> "$LOG_FILE"

# Launch the app as the user
if [ -n "$ACTUAL_USER" ] && [ "$ACTUAL_USER" != "root" ]; then
    su "$ACTUAL_USER" -c "open -a Harbor" 2>> "$LOG_FILE" &
fi

echo "Post-install completed at $(date)" >> "$LOG_FILE"
exit 0
POSTINSTALL_EOF
        chmod +x "$SCRIPT_DIR/scripts/postinstall"
    fi
    
    # Ensure resources exist
    mkdir -p "$SCRIPT_DIR/resources"
    
    if [ ! -f "$SCRIPT_DIR/resources/welcome.html" ]; then
        cat > "$SCRIPT_DIR/resources/welcome.html" << 'WELCOME_EOF'
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
        h1 { color: #1a1a2e; }
        .feature { margin: 10px 0; padding: 10px; background: #f5f5f5; border-radius: 8px; }
    </style>
</head>
<body>
    <h1>⚓ Harbor for Safari</h1>
    <p>Welcome! This installer will set up Harbor, bringing AI assistants and MCP tools to Safari.</p>
    
    <div class="feature">
        <strong>🤖 AI Integration</strong><br>
        Access local AI models (Ollama) and cloud providers directly from web pages.
    </div>
    
    <div class="feature">
        <strong>🔧 MCP Tools</strong><br>
        Model Context Protocol support for powerful AI agent capabilities.
    </div>
    
    <div class="feature">
        <strong>🔒 Privacy First</strong><br>
        Your data stays on your Mac. The native bridge runs locally.
    </div>
    
    <p><strong>Requirements:</strong> macOS 12.0 or later, Safari 16+</p>
</body>
</html>
WELCOME_EOF
    fi
    
    if [ ! -f "$SCRIPT_DIR/resources/conclusion.html" ]; then
        cat > "$SCRIPT_DIR/resources/conclusion.html" << 'CONCLUSION_EOF'
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; }
        h1 { color: #1a1a2e; }
        .step { margin: 15px 0; padding: 15px; background: #e8f4f8; border-radius: 8px; border-left: 4px solid #007AFF; }
        code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    </style>
</head>
<body>
    <h1>✅ Installation Complete!</h1>
    
    <p>Harbor has been installed. Follow these steps to enable the extensions:</p>
    
    <div class="step">
        <strong>Step 1: Open Safari Settings</strong><br>
        Go to <strong>Safari → Settings → Extensions</strong> (or press <code>⌘,</code>)
    </div>
    
    <div class="step">
        <strong>Step 2: Enable Harbor Extensions</strong><br>
        Check the boxes next to:<br>
        • <strong>Harbor</strong> - Core infrastructure<br>
        • <strong>Web Agents API</strong> - Web page AI access
    </div>
    
    <div class="step">
        <strong>Step 3: Grant Permissions</strong><br>
        Allow the extensions to access websites when prompted.
    </div>
    
    <p><strong>For Local AI:</strong> Install <a href="https://ollama.com">Ollama</a> for local model support.</p>
    
    <p>Need help? Visit the <a href="https://github.com/nicholasharris/harbor">Harbor documentation</a>.</p>
</body>
</html>
CONCLUSION_EOF
    fi
    
    # Build final product archive
    productbuild \
        --distribution "$dist_xml" \
        --resources "$SCRIPT_DIR/resources" \
        --package-path "$BUILD_DIR" \
        "$pkg_path"
    
    # Sign the package if requested
    if [ "$sign" = true ] && [ -n "$DEVELOPER_ID_INSTALLER" ]; then
        echo "  Signing package..."
        local signed_pkg="${pkg_path%.pkg}-signed.pkg"
        
        productsign \
            --sign "$DEVELOPER_ID_INSTALLER" \
            "$pkg_path" \
            "$signed_pkg"
        
        mv "$signed_pkg" "$pkg_path"
        echo_success "Signed package: $pkg_path"
    else
        echo_success "Package: $pkg_path"
    fi
}

# =============================================================================
# Create DMG
# =============================================================================

create_dmg() {
    local sign=$1
    
    echo_step "Creating DMG disk image..."
    
    local app_path="$OUTPUT_DIR/Harbor.app"
    local dmg_path="$OUTPUT_DIR/Harbor-${VERSION}.dmg"
    local dmg_temp="$BUILD_DIR/Harbor-temp.dmg"
    
    # Create temporary DMG
    hdiutil create -volname "Harbor" \
        -srcfolder "$app_path" \
        -ov -format UDZO \
        "$dmg_temp"
    
    mv "$dmg_temp" "$dmg_path"
    
    # Sign the DMG if requested
    if [ "$sign" = true ] && [ -n "$CODE_SIGN_IDENTITY" ]; then
        echo "  Signing DMG..."
        codesign --force --sign "$CODE_SIGN_IDENTITY" "$dmg_path"
    fi
    
    echo_success "DMG: $dmg_path"
}

# =============================================================================
# Notarize
# =============================================================================

notarize() {
    local target=$1  # path to .pkg or .dmg
    
    echo_step "Notarizing $target..."
    
    # Use the stored keychain profile (created with: xcrun notarytool store-credentials "AC_PASSWORD")
    xcrun notarytool submit "$target" \
        --keychain-profile "AC_PASSWORD" \
        --wait
    
    # Staple the ticket
    xcrun stapler staple "$target"
    
    echo_success "Notarization complete"
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  Harbor Safari Installer Builder"
    echo "  Version: $VERSION"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    # Parse arguments
    local BUILD_MODE="debug"
    local BUILD_UNIVERSAL=false
    local DO_SIGN=false
    local DO_NOTARIZE=false
    local SKIP_BRIDGE=false
    local SKIP_EXTENSIONS=false
    local DO_PKG=false
    local DO_DMG=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            release)
                BUILD_MODE="release"
                BUILD_UNIVERSAL=true
                DO_SIGN=true
                DO_PKG=true
                shift
                ;;
            dmg)
                BUILD_MODE="release"
                BUILD_UNIVERSAL=true
                DO_DMG=true
                shift
                ;;
            app-only)
                BUILD_MODE="release"
                shift
                ;;
            --fast|--arch-only)
                BUILD_UNIVERSAL=false
                DO_SIGN=false
                shift
                ;;
            --universal)
                BUILD_UNIVERSAL=true
                shift
                ;;
            --sign)
                DO_SIGN=true
                shift
                ;;
            --notarize)
                DO_NOTARIZE=true
                DO_SIGN=true
                shift
                ;;
            --clean)
                clean_all
                shift
                ;;
            --clean-only)
                clean_all
                exit 0
                ;;
            --skip-bridge)
                SKIP_BRIDGE=true
                shift
                ;;
            --skip-extensions)
                SKIP_EXTENSIONS=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                echo_error "Unknown option: $1"
                echo "Run '$0 --help' for usage"
                exit 1
                ;;
        esac
    done
    
    # Load credentials
    load_credentials
    
    # Check prerequisites
    check_prerequisites
    
    # Build bridge
    if [ "$SKIP_BRIDGE" != true ]; then
        build_bridge $BUILD_UNIVERSAL
    else
        echo_step "Skipping bridge build (using existing)"
    fi
    
    # Build extensions
    if [ "$SKIP_EXTENSIONS" != true ]; then
        build_extensions
    else
        echo_step "Skipping extension build (using existing)"
    fi
    
    # Sync extensions to Xcode project
    sync_extensions
    
    # Build with Xcode
    build_xcode $BUILD_MODE
    
    # For release builds, export and create installers
    if [ "$BUILD_MODE" = "release" ]; then
        export_app $DO_SIGN
        
        if [ "$DO_PKG" = true ]; then
            create_pkg $DO_SIGN
            
            if [ "$DO_NOTARIZE" = true ]; then
                notarize "$OUTPUT_DIR/Harbor-${VERSION}.pkg"
            fi
        fi
        
        if [ "$DO_DMG" = true ]; then
            create_dmg $DO_SIGN
            
            if [ "$DO_NOTARIZE" = true ]; then
                notarize "$OUTPUT_DIR/Harbor-${VERSION}.dmg"
            fi
        fi
    fi
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo_success "Build complete!"
    echo ""
    
    if [ "$BUILD_MODE" = "debug" ]; then
        echo "  App: $BUILD_DIR/Debug/Harbor.app"
        echo ""
        echo "To test:"
        echo "  1. Open the app: open \"$BUILD_DIR/Debug/Harbor.app\""
        echo "  2. Safari → Settings → Extensions"
        echo "  3. Enable Harbor and Web Agents extensions"
        echo ""
        echo "For unsigned extensions, first enable:"
        echo "  Safari → Develop → Allow Unsigned Extensions"
    else
        echo "  Output directory: $OUTPUT_DIR"
        echo ""
        ls -la "$OUTPUT_DIR" 2>/dev/null || true
    fi
    
    if [ "$BUILD_UNIVERSAL" = true ]; then
        echo ""
        echo "  Architecture: Universal (Intel + Apple Silicon)"
    fi
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
}

main "$@"
