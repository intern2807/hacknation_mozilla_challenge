# Harbor Safari Extension

This directory contains the build infrastructure for the Safari version of Harbor, including full native messaging support via harbor-bridge.

## Overview

Safari Web Extensions require a macOS app wrapper. Unlike Chrome/Firefox where native messaging uses a separate executable with a JSON manifest, Safari bundles everything inside the app. Our `SafariWebExtensionHandler` spawns harbor-bridge as a subprocess to provide the same LLM and MCP capabilities.

## Prerequisites

1. **Xcode 13+** (for `safari-web-extension-converter`)
2. **Rust toolchain** (for building harbor-bridge)
3. **Node.js and npm** (for building the extension)
4. **Apple Developer Account** (optional for development, required for distribution)
5. **macOS 12.0+** (Monterey or later)

## Quick Start

### Build Distributable Installer (Recommended)

To create a `.pkg` installer or `.dmg` for distribution:

```bash
# Quick development build (current architecture, no signing)
./build-installer.sh --fast

# Full release build with .pkg installer
./build-installer.sh release

# Create a DMG disk image
./build-installer.sh dmg

# Full production build with signing and notarization
./build-installer.sh release --notarize
```

The installer includes:
- **Harbor.app** - The macOS app container
- **Harbor Extension** - Main Safari extension for LLM/MCP
- **Web Agents API Extension** - Provides window.ai to web pages
- **harbor-bridge** - Universal binary (arm64 + x64) native bridge

### Development Build

For local testing without creating an installer:

```bash
./build.sh
```

This will:
1. Run the setup script if no Xcode project exists (uses `safari-web-extension-converter`)
2. Build harbor-bridge with Cargo
3. Build the extension with npm
4. Build the macOS app with Xcode
5. Copy harbor-bridge into the app bundle

### Step-by-Step Setup

If you prefer more control:

#### 1. Create the Xcode Project

```bash
./setup-xcode-project.sh
```

This uses Apple's `safari-web-extension-converter` to create the Xcode project wrapper, then patches it with our custom `SafariWebExtensionHandler.swift` that enables native messaging.

#### 2. Configure Signing in Xcode

1. Open `Harbor/Harbor.xcodeproj`
2. Select the "Harbor" target → Signing & Capabilities
3. Select your development team (or "Sign to Run Locally")
4. Repeat for the "Harbor Extension" target

#### 3. Build

```bash
./build.sh          # Development build
./build.sh release  # Release archive
```

## Installer Build Options

The `build-installer.sh` script supports various options:

```bash
# Modes
./build-installer.sh              # Debug build (unsigned .app)
./build-installer.sh release      # Release .pkg installer
./build-installer.sh dmg          # Create .dmg disk image
./build-installer.sh app-only     # Release .app without installer

# Options
--fast              # Current architecture only (faster builds)
--universal         # Force universal binary (default for release)
--sign              # Sign with Developer ID
--notarize          # Notarize for distribution (requires --sign)
--clean             # Clean all artifacts before building
--clean-only        # Just clean, don't build
--skip-bridge       # Skip rebuilding harbor-bridge
--skip-extensions   # Skip rebuilding extensions
--help              # Show all options
```

### Credentials Setup

For signing and notarization, create `installer/credentials.env`:

```bash
cp installer/credentials.env.example installer/credentials.env
```

Then edit it with your Apple Developer credentials:

```bash
# Apple Developer Team ID (required for signing)
DEVELOPMENT_TEAM="XXXXXXXXXX"

# Code signing identity
CODE_SIGN_IDENTITY="Developer ID Application: Your Name (XXXXXXXXXX)"

# For package signing
DEVELOPER_ID_INSTALLER="Developer ID Installer: Your Name (XXXXXXXXXX)"

# For notarization
APPLE_ID="your@email.com"
APPLE_TEAM_ID="XXXXXXXXXX"
```

### Output Files

After building, find outputs in `build/output/`:

| File | Description |
|------|-------------|
| `Harbor.app` | The macOS application bundle |
| `Harbor-{version}.pkg` | Installer package (with `release` mode) |
| `Harbor-{version}.dmg` | Disk image (with `dmg` mode) |

## Native Messaging Architecture

Safari's native messaging works differently from Chrome/Firefox:

```
┌─────────────────────────────────────────────────────────────┐
│                      Harbor.app                              │
├─────────────────────────────────────────────────────────────┤
│  Contents/                                                   │
│  ├── MacOS/                                                  │
│  │   ├── Harbor              (main app)                     │
│  │   └── harbor-bridge       (native helper)                │
│  └── PlugIns/                                                │
│      └── Harbor Extension.appex/                            │
│          └── SafariWebExtensionHandler.swift                │
│              ↓                                               │
│              Spawns harbor-bridge as subprocess              │
│              Relays messages via stdin/stdout                │
└─────────────────────────────────────────────────────────────┘
```

The `SafariWebExtensionHandler`:
- Receives messages from the extension via `beginRequest(with:)`
- Spawns harbor-bridge with `--native-messaging` flag
- Communicates using the same length-prefixed JSON protocol as Chrome/Firefox
- Returns responses back to the extension

## Project Structure

```
installer/safari/
├── README.md                      # This file
├── setup-xcode-project.sh         # Creates Xcode project using converter
├── build.sh                       # Main build script
├── SafariWebExtensionHandler.swift # Custom handler with native messaging
└── Harbor/                        # Xcode project (generated)
    ├── Harbor.xcodeproj
    ├── Harbor/                    # macOS app target
    └── Harbor Extension/          # Safari extension target
        ├── SafariWebExtensionHandler.swift  # Patched with our version
        └── Resources/
            ├── manifest.json
            ├── dist/
            └── assets/
```

## Development

### Enable Unsigned Extensions

For development without code signing:

1. Safari → Settings → Advanced → "Show Develop menu in menu bar"
2. Safari → Develop → Allow Unsigned Extensions

### View Extension Logs

- Safari → Develop → Web Extension Background Content

### View Native Handler Logs

The `SafariWebExtensionHandler` logs to the unified logging system:

```bash
log stream --predicate 'subsystem == "org.harbor.extension"'
```

### Debugging harbor-bridge

Check the bridge log file:
```bash
tail -f ~/Library/Caches/harbor-bridge.log
```

## Distribution

### Development/Testing

1. Enable "Allow Unsigned Extensions" in Safari
2. Run the app: `open build/Debug/Harbor.app`
3. Enable the extension in Safari Settings → Extensions

### App Store Distribution

1. Build a release archive:
   ```bash
   ./build.sh release
   ```

2. Open in Xcode Organizer:
   ```bash
   open build/Harbor.xcarchive
   ```

3. Click "Distribute App" and follow the App Store flow

### Direct Distribution (Developer ID)

1. Build release archive
2. Export with Developer ID signing
3. Notarize:
   ```bash
   xcrun notarytool submit Harbor.zip \
     --apple-id YOUR_ID \
     --password APP_PASSWORD \
     --team-id TEAM_ID \
     --wait
   ```
4. Staple the ticket:
   ```bash
   xcrun stapler staple Harbor.app
   ```

## Differences from Firefox/Chrome

| Feature | Firefox/Chrome | Safari |
|---------|---------------|--------|
| Distribution | Extension store or self-hosted | App Store or notarized app |
| Native Messaging | Separate binary + JSON manifest | Bundled in app, Swift handler |
| Sidebar | `sidebar_action` | Not supported (use popup) |
| Permissions | Browser prompts | System + browser |
| Updates | Extension store auto-update | App Store or manual |
| Installation | Browser-managed | App installation |

## Troubleshooting

### "Extension not loaded"

1. Ensure "Allow Unsigned Extensions" is enabled (Develop menu)
2. Check that the extension is enabled in Safari Settings → Extensions
3. Look for errors in Xcode console when building

### "Cannot connect to native messaging host"

1. Verify harbor-bridge exists in the app bundle:
   ```bash
   ls -la "build/Debug/Harbor.app/Contents/MacOS/"
   ```
2. Check the handler logs:
   ```bash
   log stream --predicate 'subsystem == "org.harbor.extension"'
   ```
3. Ensure harbor-bridge was built:
   ```bash
   ls -la ../../bridge-rs/target/release/harbor-bridge
   ```

### "harbor-bridge binary not found"

The build script should copy it automatically. If not:
```bash
cp ../../bridge-rs/target/release/harbor-bridge \
   "build/Debug/Harbor.app/Contents/MacOS/"
```

### Xcode build errors

1. Ensure Xcode 13+ is installed
2. Check that signing is configured (even "Sign to Run Locally" works)
3. Clean build folder: Product → Clean Build Folder

### safari-web-extension-converter errors

If the converter fails:
1. Ensure the extension builds successfully: `cd extension && npm run build`
2. Check manifest.safari.json is valid JSON
3. Try running the converter manually to see detailed errors

## Resources

- [Safari Web Extensions Guide](https://developer.apple.com/documentation/safariservices/safari_web_extensions)
- [Converting a Web Extension for Safari](https://developer.apple.com/documentation/safariservices/safari_web_extensions/converting_a_web_extension_for_safari)
- [safari-web-extension-converter](https://developer.apple.com/documentation/safariservices/safari_web_extensions/converting_a_web_extension_for_safari#3744459)
- [NSExtensionRequestHandling](https://developer.apple.com/documentation/foundation/nsextensionrequesthandling)
