# Contributing to Harbor

This guide is for developers who want to contribute to Harbor itself. If you're looking to build applications using Harbor, see [Developer Guide](docs/DEVELOPER_GUIDE.md) instead.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Project Structure](#project-structure)
3. [Development Workflow](#development-workflow)
4. [Testing](#testing)
5. [Code Style](#code-style)
6. [Pull Request Process](#pull-request-process)

---

## Getting Started

### Prerequisites

- **Node.js** 18+ (with npm)
- **Firefox** 109+ (for testing the extension)
- **Python 3.9+** with uvx (for Python MCP servers)
- **Docker** (optional, for isolated server execution)
- **Git** (with submodule support)

### Initial Setup

```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/anthropics/harbor.git
cd harbor

# If you already cloned without submodules:
git submodule update --init --recursive
```

### Full Build

```bash
# Build the any-llm-ts dependency (submodule)
cd bridge-ts/src/any-llm-ts
npm install
npm run build
cd ../../..

# Build the bridge
cd bridge-ts
npm install
npm run build
cd ..

# Build the extension
cd extension
npm install
npm run build
cd ..

# Install native messaging manifest
cd bridge-ts/scripts
./install_native_manifest_macos.sh  # or linux version
cd ../..
```

### Load Extension for Testing

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `extension/dist/manifest.json`
4. The Harbor sidebar icon should appear

---

## Project Structure

```
harbor/
├── extension/              # Firefox Extension (TypeScript + Vite)
│   ├── src/
│   │   ├── background.ts   # Native messaging, server management
│   │   ├── sidebar.ts      # Main sidebar UI
│   │   ├── provider/       # JS AI Provider injection
│   │   └── catalog/        # Catalog UI components
│   └── dist/               # Built output
│
├── bridge-ts/              # Node.js Native Messaging Bridge
│   ├── src/
│   │   ├── main.ts         # Entry point
│   │   ├── handlers.ts     # Message handlers
│   │   ├── host/           # MCP execution environment
│   │   ├── mcp/            # MCP protocol client
│   │   ├── chat/           # Chat orchestration
│   │   ├── llm/            # LLM provider abstraction
│   │   ├── installer/      # Server installation
│   │   ├── catalog/        # Directory system
│   │   ├── auth/           # OAuth and credentials
│   │   └── any-llm-ts/     # LLM library (git submodule)
│   └── dist/               # Built output
│
├── demo/                   # Demo web pages
│   ├── chat-poc/           # Full chat demo
│   └── summarizer/         # Page summarization demo
│
├── docs/                   # Documentation
│   ├── USER_GUIDE.md       # End-user guide
│   ├── DEVELOPER_GUIDE.md  # API reference for app developers
│   ├── LLMS.txt            # AI agent reference
│   ├── JS_AI_PROVIDER_API.md
│   ├── MCP_HOST.md
│   └── TESTING_PLAN.md
│
├── installer/              # Distributable packages
│   └── macos/              # macOS .pkg builder
│
├── ARCHITECTURE.md         # System architecture
├── CONTRIBUTING.md         # This file
└── README.md               # Project overview
```

### Key Components

| Component | Path | Description |
|-----------|------|-------------|
| **Native Messaging** | `bridge-ts/src/native-messaging.ts` | Stdin/stdout JSON framing |
| **Message Handlers** | `bridge-ts/src/handlers.ts` | All bridge message types |
| **MCP Host** | `bridge-ts/src/host/` | Permission, rate limiting, tool registry |
| **MCP Client** | `bridge-ts/src/mcp/` | MCP protocol implementation |
| **Chat Orchestrator** | `bridge-ts/src/chat/orchestrator.ts` | Agent loop with tool calling |
| **LLM Manager** | `bridge-ts/src/llm/manager.ts` | LLM provider abstraction |
| **Installer** | `bridge-ts/src/installer/manager.ts` | Server installation/lifecycle |
| **Provider Injection** | `extension/src/provider/` | window.ai/agent injection |

---

## Development Workflow

### Watch Mode

For active development, use watch mode to auto-rebuild on changes:

```bash
# Terminal 1: Watch bridge
cd bridge-ts
npm run dev

# Terminal 2: Watch extension
cd extension
npm run dev
```

After each rebuild:
- Bridge: Changes take effect on next extension reload
- Extension: Go to `about:debugging` and click "Reload" on the Harbor extension

### Debugging

**Extension (Browser Console):**
```
Cmd+Shift+J (Mac) or Ctrl+Shift+J
```

**Bridge (Logs):**
The bridge logs to stderr. In production, logs are captured by the extension. For development, you can run the bridge manually:

```bash
cd bridge-ts
echo '{"type":"hello","request_id":"1"}' | node dist/main.js
```

**MCP Server Logs:**
```bash
# View logs for a running server
# In the sidebar, click server name → "Logs"
```

### Data Locations

During development, Harbor stores data in `~/.harbor/`:

| File | Purpose |
|------|---------|
| `harbor.db` | Server configurations (SQLite) |
| `catalog.db` | Catalog cache (SQLite) |
| `installed_servers.json` | Installed servers |
| `secrets/credentials.json` | API keys |
| `sessions/*.json` | Chat sessions |

To reset all state:
```bash
rm -rf ~/.harbor
```

---

## Testing

### Test Suites

| Package | Command | Coverage |
|---------|---------|----------|
| Bridge | `cd bridge-ts && npm test` | Host, chat, permissions |
| Extension | `cd extension && npm test` | Provider injection |
| LLM Library | `cd bridge-ts/src/any-llm-ts && npm test` | LLM providers |

### Running Tests

```bash
# Run all bridge tests
cd bridge-ts
npm test

# Watch mode (during development)
npm run test:watch

# With coverage report
npm run test:coverage

# Run specific test file
npm test -- src/host/__tests__/permissions.test.ts
```

### Test Files

**Host Tests** (`bridge-ts/src/host/__tests__/`):
- `permissions.test.ts` — Permission grants, expiry, allowlists
- `tool-registry.test.ts` — Tool namespacing, registration
- `rate-limiter.test.ts` — Budgets, concurrency limits
- `observability.test.ts` — Metrics recording
- `host.integration.test.ts` — End-to-end host flows

**Chat Tests** (`bridge-ts/src/chat/__tests__/`):
- `orchestrator.test.ts` — Agent loop, tool routing

### Writing Tests

We use [Vitest](https://vitest.dev/) for testing. Example:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { grantPermission, checkPermission } from '../permissions.js';

describe('permissions', () => {
  beforeEach(() => {
    // Reset state before each test
  });

  it('should grant and check permissions', async () => {
    await grantPermission('https://example.com', 'default', 'mcp:tools.list', 'ALLOW_ALWAYS');
    
    const result = checkPermission('https://example.com', 'default', 'mcp:tools.list');
    expect(result.granted).toBe(true);
  });
});
```

### Manual QA

See [TESTING_PLAN.md](docs/TESTING_PLAN.md) for comprehensive manual QA scenarios including:
- Server installation and connection
- Permission flows
- Tool invocation
- Rate limiting
- VS Code button detection
- JSON configuration import

---

## Code Style

### TypeScript

- Use strict TypeScript (`strict: true` in tsconfig)
- Prefer `interface` over `type` for object shapes
- Use explicit return types on exported functions
- Document public APIs with JSDoc comments

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | `kebab-case.ts` | `tool-registry.ts` |
| Classes | `PascalCase` | `McpHost` |
| Functions | `camelCase` | `listTools()` |
| Constants | `SCREAMING_SNAKE` | `MAX_RETRIES` |
| Interfaces | `PascalCase` | `ToolDescriptor` |

### Error Handling

Use typed error codes for all errors:

```typescript
interface ApiError {
  code: string;      // e.g., 'ERR_PERMISSION_DENIED'
  message: string;   // Human-readable message
  details?: unknown; // Additional context
}
```

Standard error codes are defined in `bridge-ts/src/host/types.ts`.

### Commit Messages

Use conventional commits:

```
feat: add tool router for intelligent server selection
fix: handle server crash during tool call
docs: update developer guide with new APIs
test: add integration tests for permissions
chore: upgrade vitest to v1.0
```

---

## Pull Request Process

### Before Submitting

1. **Run tests**:
   ```bash
   cd bridge-ts && npm test
   cd extension && npm test
   ```

2. **Test manually**:
   - Load the extension in Firefox
   - Verify your changes work as expected
   - Check the Browser Console for errors

3. **Update documentation** if you're changing:
   - APIs → Update `DEVELOPER_GUIDE.md` and `LLMS.txt`
   - Architecture → Update `ARCHITECTURE.md`
   - User-facing features → Update `USER_GUIDE.md`

### PR Template

```markdown
## Description
<!-- What does this PR do? -->

## Testing
<!-- How did you test this? -->

## Checklist
- [ ] Tests pass (`npm test`)
- [ ] Extension loads without errors
- [ ] Documentation updated (if applicable)
```

### Review Process

1. Open a PR against `main`
2. Wait for CI checks to pass
3. Request review from maintainers
4. Address feedback
5. Merge when approved

---

## Common Tasks

### Adding a New Message Type

1. Define the message type in `bridge-ts/src/types.ts`
2. Add handler in `bridge-ts/src/handlers.ts`
3. Add response handling in `extension/src/background.ts`
4. Update documentation in `README.md` or `DEVELOPER_GUIDE.md`

### Adding a New MCP Server to Curated List

Edit `bridge-ts/src/directory/curated-servers.ts`:

```typescript
{
  id: 'my-new-server',
  title: 'My Server',
  description: 'What it does',
  source: 'npm',
  package: '@scope/my-mcp-server',
  runtime: 'node',
  tools: [/* tool descriptions */],
  category: 'utilities',
}
```

### Adding a New LLM Provider

1. Create provider file in `bridge-ts/src/llm/` (e.g., `newprovider.ts`)
2. Implement the `LLMProvider` interface
3. Register in `bridge-ts/src/llm/manager.ts`
4. Update detection logic

---

## Release Checklist

Before a release:

- [ ] All tests pass
- [ ] Manual QA completed (see TESTING_PLAN.md)
- [ ] Version bumped in `package.json` files
- [ ] CHANGELOG updated
- [ ] Documentation reviewed and up-to-date
- [ ] Extension signed (for production)
- [ ] Installer built and tested

---

## Getting Help

- **Architecture questions**: Check `ARCHITECTURE.md` first
- **API questions**: Check `DEVELOPER_GUIDE.md`
- **Test questions**: Check `TESTING_PLAN.md`
- **File issues**: For bugs or feature requests


