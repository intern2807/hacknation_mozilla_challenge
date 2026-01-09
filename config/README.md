# Harbor Configuration

This directory contains configuration templates and documentation for Harbor's credentials and settings.

## Directory Structure

```
config/
├── README.md                    # This file
├── build.env.example           # Build-time credentials (signing, publishing)
├── oauth.env.example           # OAuth provider credentials (baked into releases)
└── runtime.env.example         # User runtime settings (optional)
```

## Credential Types

### 1. Build Credentials (`build.env`)

**Used during**: Build and release process  
**Who sets these**: Raffi Krikorian &lt;raffi@mozilla.org&gt;  
**Examples**: Mozilla AMO keys, Apple signing certificates

These are used to sign and publish Harbor. Not shipped with the app.

### 2. OAuth Provider Credentials (`oauth.env`)

**Used during**: Build (baked into app) and runtime  
**Who sets these**: Raffi Krikorian (defaults), Users (overrides)  
**Examples**: Google Client ID, GitHub Client ID

These enable Harbor's "clientIdSource: harbor" feature where Harbor handles OAuth on behalf of MCP servers. The official release includes Harbor's OAuth credentials. Users can override with their own.

### 3. Runtime Settings (`~/.harbor/config.env`)

**Used during**: Runtime only  
**Who sets these**: End users  
**Location**: `~/.harbor/config.env` (not in repo)  
**Examples**: Custom OAuth credentials, feature flags

Users can override any baked-in setting.

## Setup for Developers

```bash
# 1. Copy example files
cp config/build.env.example config/build.env
cp config/oauth.env.example config/oauth.env

# 2. Fill in your credentials
# (see instructions in each file)

# 3. Build will automatically load these
npm run build
```

## Security Notes

- `*.env` files in this directory are gitignored
- Never commit actual credentials
- OAuth client IDs are not secrets (PKCE flow)
- OAuth client secrets should be treated carefully
- See each `.example` file for specific guidance

