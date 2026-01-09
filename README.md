# Harbor

<p align="center">
  <strong>The reference implementation of the Web Agent API</strong>
</p>

Harbor is a Firefox browser extension that implements the **[Web Agent API](spec/)** — a proposed standard for bringing AI agent capabilities to web applications.

## What is the Web Agent API?

The **Web Agent API** is a specification that defines how web pages can access AI capabilities:

- **`window.ai`** — Text generation (Chrome Prompt API compatible)
- **`window.agent`** — Tool calling, browser access, and autonomous agent tasks via [MCP](https://modelcontextprotocol.io/)

**Harbor** is Mozilla's reference implementation of this specification, available as a Firefox extension with a native Node.js bridge. It connects web pages to local AI models (Ollama, llamafile) or cloud providers — with user consent and local-first privacy.

```
┌──────────────────┐                              ┌──────────────────┐
│ Firefox Extension│  ◄── stdin/stdout JSON ──►  │ Node.js Bridge   │
│   (sidebar UI)   │                              │  (auto-started)  │
└──────────────────┘                              └────────┬─────────┘
                                                           │
                                    ┌──────────────────────┼──────────────────────┐
                                    │                      │                      │
                              ┌─────▼─────┐         ┌──────▼──────┐        ┌──────▼──────┐
                              │ LLM       │         │ MCP Servers │        │ MCP Servers │
                              │ (Ollama)  │         │  (stdio)    │        │  (Docker)   │
                              └───────────┘         └─────────────┘        └─────────────┘
```

## ✨ Features

- **Local LLM Integration** — Use Ollama, llamafile, or other local models
- **MCP Server Management** — Install, run, and manage MCP servers from a curated directory
- **JS AI Provider** — Exposes `window.ai` and `window.agent` APIs to web pages
- **Permission System** — Per-origin capability grants with user consent
- **Process Isolation** — Optional crash isolation for MCP servers (forked processes)
- **Docker Isolation** — Optional containerized execution for MCP servers

---

## 📚 Documentation

### Web Agent API Specification

| Document | Description |
|----------|-------------|
| **[Web Agent API Spec](spec/)** | The API specification (`window.ai`, `window.agent`) |
| [Explainer](spec/explainer.md) | Full specification with Web IDL and examples |
| [Security & Privacy](spec/security-privacy.md) | Security model and privacy considerations |

### Harbor Implementation

#### For Users

| Document | Description |
|----------|-------------|
| **[User Guide](docs/USER_GUIDE.md)** | Install Harbor, set up LLMs, manage MCP servers |

#### For Web Developers

| Document | Description |
|----------|-------------|
| **[Developer Guide](docs/DEVELOPER_GUIDE.md)** | Build apps using the Web Agent API |
| [JS API Reference](docs/JS_AI_PROVIDER_API.md) | Detailed API with examples and TypeScript types |
| [Demo Code](demo/) | Working examples |

#### For AI Agents

| Document | Description |
|----------|-------------|
| **[LLMS.txt](docs/LLMS.txt)** | Compact, token-efficient reference for AI coding assistants |

#### For Contributors

| Document | Description |
|----------|-------------|
| **[Contributing Guide](CONTRIBUTING.md)** | Build, test, and contribute to Harbor |
| [Architecture](ARCHITECTURE.md) | System design and component overview |
| [MCP Host](docs/MCP_HOST.md) | MCP execution environment internals |
| [Testing Plan](docs/TESTING_PLAN.md) | Test coverage and QA procedures |

---

## 🚀 Quick Start

### Prerequisites

- **Firefox** 109+
- **Node.js** 18+ (for development)
- **Ollama** or **llamafile** (for LLM)

### Installation

**Option 1: macOS Installer**
```bash
# Download and run Harbor-x.x.x.pkg
# Restart Firefox after installation
```

**Option 2: Build from Source**
```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/anthropics/harbor.git
cd harbor

# Build extension
cd extension && npm install && npm run build && cd ..

# Build bridge (including submodule)
cd bridge-ts/src/any-llm-ts && npm install && npm run build && cd ../..
npm install && npm run build && cd ..

# Install native messaging manifest
cd bridge-ts/scripts && ./install_native_manifest_macos.sh && cd ../..

# Load extension in Firefox
# Go to: about:debugging#/runtime/this-firefox
# Click "Load Temporary Add-on" → select extension/dist/manifest.json
```

### Verify Installation

1. Click the Harbor sidebar icon in Firefox
2. You should see "Connected" status
3. Click "Detect" under LLM settings to find your local model

---

## 🎯 How It Works

**Web Page Integration (Web Agent API):**
```javascript
// Check if Web Agent API is available
if (window.agent) {
  // Request permissions
  await window.agent.requestPermissions({
    scopes: ['model:prompt', 'mcp:tools.list', 'mcp:tools.call'],
    reason: 'Enable AI features'
  });

  // Use AI text generation
  const session = await window.ai.createTextSession();
  const response = await session.prompt('Hello!');

  // Run agent tasks with tools
  for await (const event of window.agent.run({ task: 'Search my files' })) {
    console.log(event);
  }
}
```

**Permission Scopes:**

| Scope | Description |
|-------|-------------|
| `model:prompt` | Basic text generation |
| `model:tools` | AI with tool calling |
| `mcp:tools.list` | List available MCP tools |
| `mcp:tools.call` | Execute MCP tools |
| `browser:activeTab.read` | Read active tab content |

---

## 🗂 Project Structure

```
harbor/
├── extension/          # Firefox Extension (TypeScript, Vite)
├── bridge-ts/          # Node.js Native Messaging Bridge
│   ├── src/
│   │   ├── host/       # MCP execution environment
│   │   ├── mcp/        # MCP protocol client
│   │   ├── chat/       # Chat orchestration
│   │   ├── llm/        # LLM providers
│   │   ├── installer/  # Server installation
│   │   └── catalog/    # Server directory
│   └── scripts/        # Native manifest installers
├── demo/               # Example web pages
├── docs/               # Documentation
└── installer/          # Distributable packages
```

---

## 🛠 Development

```bash
# Watch mode (bridge)
cd bridge-ts && npm run dev

# Watch mode (extension)
cd extension && npm run dev

# Run tests
cd bridge-ts && npm test
cd extension && npm test
```

See [Contributing Guide](CONTRIBUTING.md) for detailed development instructions.

---

## 📊 Roadmap

- [x] Native messaging bridge
- [x] MCP server management
- [x] LLM integration (Ollama, llamafile)
- [x] Chat orchestration with tool calling
- [x] JS AI Provider (window.ai, window.agent)
- [x] Permission system
- [ ] v1.0 Production release
- [ ] Windows/Linux installers
- [ ] Chrome extension support

---

## 📄 License

MIT
