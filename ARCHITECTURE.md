# Harbor Architecture

This document describes the architecture of Harbor, the reference implementation of the **[Web Agent API](spec/)**.

Harbor is a Firefox extension that implements the Web Agent API specification, bringing AI and MCP (Model Context Protocol) capabilities to web applications.

> **Related Documentation:**
> - [Web Agent API Spec](spec/) — The API specification Harbor implements
> - [User Guide](docs/USER_GUIDE.md) — Installation and usage
> - [Developer Guide](docs/DEVELOPER_GUIDE.md) — Building apps with the Web Agent API
> - [Contributing](CONTRIBUTING.md) — Development setup
> - [MCP Host](docs/MCP_HOST.md) — Execution environment details

---

## Overview

Harbor implements the Web Agent API, providing:

| Capability | Description |
|------------|-------------|
| **Web Agent API** | `window.ai` and `window.agent` APIs for web pages |
| **MCP Server Management** | Install, run, and connect to MCP servers |
| **LLM Integration** | Local model support (Ollama, llamafile) + cloud providers |
| **Permission System** | Per-origin capability grants with user consent |
| **Chat Orchestration** | Agent loop with tool calling |
| **Bring Your Own Chatbot** | Websites can integrate with the user's AI via `agent.mcp.*` and `agent.chat.*` |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              WEB PAGE                                        │
│                                                                              │
│  window.ai                           window.agent                            │
│  ├── createTextSession()             ├── requestPermissions()                │
│  └── session.prompt()                ├── tools.list() / tools.call()        │
│                                      ├── browser.activeTab.readability()    │
│                                      ├── run({ task })                       │
│                                      ├── mcp.discover/register() [BYOC]     │
│                                      └── chat.open/close() [BYOC]           │
└───────────────────────────────────────┬─────────────────────────────────────┘
                                        │ postMessage
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FIREFOX EXTENSION                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────┐   │
│  │  Content Script   │  │   Background      │  │      Sidebar          │   │
│  │  (provider.ts)    │  │   (background.ts) │  │      (sidebar.ts)     │   │
│  │                   │  │                   │  │                       │   │
│  │  • Inject APIs    │  │  • Native msgs    │  │  • Server management  │   │
│  │  • Route messages │  │  • Permissions    │  │  • Chat UI            │   │
│  │  • Permission UI  │  │  • Orchestration  │  │  • Settings           │   │
│  └─────────┬─────────┘  └─────────┬─────────┘  └───────────┬───────────┘   │
│            │                      │                        │                │
│            └──────────────────────┼────────────────────────┘                │
│                                   │                                          │
└───────────────────────────────────┼──────────────────────────────────────────┘
                                    │ Native Messaging (stdin/stdout JSON)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            NODE.JS BRIDGE (Main Process)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                           MCP HOST                                     │  │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────────────┐   │  │
│  │  │ Permissions │  │  Tool Registry  │  │      Rate Limiter       │   │  │
│  │  │             │  │                 │  │                         │   │  │
│  │  │ Per-origin  │  │ Namespaced      │  │ • Max 5 calls/run       │   │  │
│  │  │ capability  │  │ serverId/tool   │  │ • 2 concurrent/origin   │   │  │
│  │  │ grants      │  │ registration    │  │ • 30s timeout           │   │  │
│  │  └─────────────┘  └─────────────────┘  └─────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐      │
│  │    Installer    │  │   LLM Manager   │  │   Chat Orchestrator     │      │
│  │                 │  │                 │  │                         │      │
│  │  • npx/uvx      │  │  • Ollama       │  │  • Agent loop           │      │
│  │  • Docker       │  │  • llamafile    │  │  • Tool routing         │      │
│  │  • Secrets      │  │  • Model select │  │  • Session management   │      │
│  └────────┬────────┘  └────────┬────────┘  └────────────┬────────────┘      │
│           │                    │                        │                    │
│           │ IPC (fork)         │                        │                    │
└───────────┼────────────────────┼────────────────────────┼────────────────────┘
            │                    │ HTTP (OpenAI)          │
            ▼                    ▼                        │
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ISOLATED PROCESSES (Forked)                               │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │ MCP Runner 1      │  │ MCP Runner 2      │  │ Catalog Worker    │       │
│  │ (server: github)  │  │ (server: memory)  │  │ (background sync) │       │
│  │                   │  │                   │  │                   │       │
│  │  Crash Isolated   │  │  Crash Isolated   │  │  DB Writes Only   │       │
│  └─────────┬─────────┘  └─────────┬─────────┘  └───────────────────┘       │
│            │ stdio                │ stdio                                    │
│            ▼                      ▼                                          │
│  ┌─────────────────┐    ┌─────────────────┐                                 │
│  │ MCP Server      │    │ MCP Server      │    ┌─────────────────────┐     │
│  │ (npx/uvx/bin)   │    │ (npx/uvx/bin)   │    │    LLM Provider     │     │
│  └─────────────────┘    └─────────────────┘    │  (Ollama, etc.)     │     │
│                                                 └─────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Web Page to AI Response

```
Web Page                    Extension                    Bridge                    LLM
   │                           │                           │                        │
   │ session.prompt("Hi")      │                           │                        │
   ├──────────────────────────►│                           │                        │
   │                           │ llm_chat                  │                        │
   │                           ├──────────────────────────►│                        │
   │                           │                           │ POST /v1/chat/...      │
   │                           │                           ├───────────────────────►│
   │                           │                           │◄───────────────────────┤
   │                           │◄──────────────────────────┤                        │
   │◄──────────────────────────┤                           │                        │
   │ "Hello! How can I help?"  │                           │                        │
```

### 2. Tool Call Flow

```
Web Page                    Extension                    Bridge                 MCP Server
   │                           │                           │                        │
   │ agent.tools.call(...)     │                           │                        │
   ├──────────────────────────►│                           │                        │
   │                           │ ① Check permission        │                        │
   │                           │ ② host_call_tool          │                        │
   │                           ├──────────────────────────►│                        │
   │                           │                           │ ③ Check rate limit     │
   │                           │                           │ ④ Resolve tool         │
   │                           │                           │ ⑤ MCP call             │
   │                           │                           ├───────────────────────►│
   │                           │                           │◄───────────────────────┤
   │                           │◄──────────────────────────┤                        │
   │◄──────────────────────────┤                           │                        │
   │ { result: ... }           │                           │                        │
```

### 3. Agent Run (Autonomous Task)

```
User: "Find my recent GitHub PRs and summarize them"
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Chat Orchestrator                           │
│                                                                  │
│  1. Tool Router analyzes task → selects "github" server         │
│  2. Collect tools from github server only                       │
│  3. Send to LLM with tool definitions                           │
│  4. LLM returns: call github/list_prs                           │
│  5. Execute tool → get results                                  │
│  6. Send results back to LLM                                    │
│  7. LLM returns: call github/get_pr_details                     │
│  8. Execute tool → get results                                  │
│  9. Send results back to LLM                                    │
│  10. LLM generates final summary                                │
└─────────────────────────────────────────────────────────────────┘
              │
              ▼
"You have 3 open PRs: #123 fixes auth bug, #124 adds dark mode..."
```

---

## Components

### Extension Layer

| File | Purpose |
|------|---------|
| `background.ts` | Native messaging, permission management, message routing |
| `sidebar.ts` | Main UI for server management, chat, settings |
| `provider/*.ts` | JS AI Provider injection (`window.ai`, `window.agent`) |
| `vscode-detector.ts` | Detects "Install in VS Code" buttons |

### Bridge Layer

| Directory | Purpose |
|-----------|---------|
| `host/` | MCP execution environment (permissions, rate limiting, tool registry) |
| `mcp/` | MCP protocol implementation (stdio client, connection management, process isolation) |
| `llm/` | LLM provider abstraction (Ollama, llamafile) |
| `chat/` | Chat orchestration (agent loop, session management, tool routing) |
| `installer/` | Server installation (npm, pypi, docker, secrets) |
| `catalog/` | Server directory (official registry, GitHub awesome list) |
| `auth/` | OAuth and credential management |

---

## Process Isolation Architecture

Harbor uses a multi-process architecture for crash isolation and security when running third-party MCP servers.

### Why Process Isolation?

MCP servers are third-party code downloaded from npm, PyPI, or GitHub. Without isolation:
- A buggy server could crash the entire bridge
- Memory leaks in one server affect all servers
- A malicious server could potentially access data from other servers

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     MAIN BRIDGE PROCESS                           │
│  - Native messaging (Firefox communication)                      │
│  - Permission enforcement                                        │
│  - Rate limiting                                                 │
│  - Tool registry                                                 │
│  - LLM communication                                             │
└──────────────────┬────────────────────────────────┬──────────────┘
                   │ IPC (fork)                     │ IPC (fork)
                   ▼                                ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│       MCP RUNNER PROCESS     │  │       MCP RUNNER PROCESS     │
│       (one per server)       │  │       (one per server)       │
│                              │  │                              │
│  - Manages single server     │  │  - Manages single server     │
│  - Crash isolated            │  │  - Crash isolated            │
│  - Communicates via IPC      │  │  - Communicates via IPC      │
│                              │  │                              │
│  ┌────────────────────────┐  │  │  ┌────────────────────────┐  │
│  │ stdio subprocess       │  │  │  │ stdio subprocess       │  │
│  │ (npx, uvx, binary)     │  │  │  │ (npx, uvx, binary)     │  │
│  └────────────────────────┘  │  │  └────────────────────────┘  │
└──────────────────────────────┘  └──────────────────────────────┘
```

### Enabling Process Isolation

Process isolation is opt-in. Enable it via environment variable:

```bash
export HARBOR_MCP_ISOLATION=1
```

### How It Works

1. **Fork Pattern**: When connecting to a server, the bridge forks itself with a special flag (`--mcp-runner <serverId>`)
2. **IPC Communication**: The main bridge sends commands to runners via Node.js IPC
3. **Crash Recovery**: If a runner crashes, only that server is affected; the bridge survives and can restart it
4. **PKG Compatibility**: The fork pattern works in pkg-compiled binaries (uses `process.execPath`)

### Runner Commands

The runner process handles these operations via IPC:

| Command | Description |
|---------|-------------|
| `connect` | Spawn the MCP server and establish connection |
| `disconnect` | Stop the server process |
| `list_tools` | Get tools from the server |
| `call_tool` | Execute a tool |
| `list_resources` | Get resources from the server |
| `read_resource` | Read a resource |
| `get_prompt` | Get a prompt |
| `shutdown` | Terminate the runner |

### Catalog Worker

A similar isolation pattern is used for the catalog system:

- **Main bridge**: Only reads from the catalog database
- **Catalog worker**: Separate process that handles network fetches and database writes
- **Enabled via**: `HARBOR_CATALOG_WORKER=1`

```bash
# Enable catalog worker isolation
export HARBOR_CATALOG_WORKER=1
```

---

## Permission System

Permissions are scoped per-origin with capability-based grants.

### Scopes

| Scope | Description | Grants Access To |
|-------|-------------|------------------|
| `model:prompt` | Basic text generation | `ai.createTextSession()` |
| `model:tools` | AI with tool calling | `agent.run()` |
| `mcp:tools.list` | List available tools | `agent.tools.list()` |
| `mcp:tools.call` | Execute tools | `agent.tools.call()` |
| `mcp:servers.register` | Register website MCP servers | `agent.mcp.register()` |
| `browser:activeTab.read` | Read active tab | `agent.browser.activeTab.readability()` |
| `chat:open` | Open browser chat UI | `agent.chat.open()` |

### Grant Types

| Type | Behavior | Storage |
|------|----------|---------|
| `ALLOW_ONCE` | Expires after 10 min or tab close | Memory |
| `ALLOW_ALWAYS` | Persists across sessions | `browser.storage.local` |
| `DENY` | Explicitly denied (no re-prompt) | `browser.storage.local` |

### Enforcement Flow

```
Request arrives with origin "https://example.com"
        │
        ▼
┌───────────────────────────┐
│ Check DENY grants         │─────► Denied? Return ERR_PERMISSION_DENIED
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Check ALLOW_ALWAYS grants │─────► Found? Proceed
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Check ALLOW_ONCE grants   │─────► Found & not expired? Proceed
│ (check expiry & tab)      │─────► Expired? Remove & continue
└───────────────────────────┘
        │
        ▼
Return ERR_SCOPE_REQUIRED
```

---

## Tool Registry

Tools from MCP servers are namespaced to prevent collisions.

**Format:** `{serverId}/{toolName}`

**Examples:**
- `filesystem/read_file`
- `github/search_issues`
- `memory-server/save_memory`

### Registration

```
MCP Server connects
        │
        ▼
┌───────────────────────────┐
│ Call tools/list           │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Register tools with       │
│ namespace prefix          │
│                           │
│ read_file → filesystem/   │
│             read_file     │
└───────────────────────────┘
        │
        ▼
Tools available for invocation
```

---

## Rate Limiting

| Limit | Default | Purpose |
|-------|---------|---------|
| `maxCallsPerRun` | 5 | Prevent runaway agent loops |
| `maxConcurrentPerOrigin` | 2 | Fair resource sharing |
| `defaultTimeoutMs` | 30,000 | Prevent hanging calls |

### Budget Tracking

```typescript
// Create a run with budget
const run = rateLimiter.createRun(origin, 5);

// Each tool call decrements budget
await rateLimiter.acquireCallSlot(origin, run.runId);
// → Budget: 5 → 4

// Exceeding budget returns error
await rateLimiter.acquireCallSlot(origin, run.runId);
// → ERR_BUDGET_EXCEEDED
```

---

## Server Lifecycle

```
         ┌──────────────────┐
         │    INSTALLING    │ Package download/build
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │     STOPPED      │ Installed but not running
         └────────┬─────────┘
                  │ start
                  ▼
         ┌──────────────────┐
         │    STARTING      │ Process spawning
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
    ┌───►│     RUNNING      │ Connected and operational
    │    └────────┬─────────┘
    │             │ crash
    │             ▼
    │    ┌──────────────────┐
    │    │     CRASHED      │ Unexpected exit
    │    └────────┬─────────┘
    │             │ auto-restart (up to 3 times)
    └─────────────┘
```

---

## Data Storage

All persistent data is stored in `~/.harbor/`:

| File | Format | Contents |
|------|--------|----------|
| `harbor.db` | SQLite | Server configurations |
| `catalog.db` | SQLite | Cached server catalog |
| `installed_servers.json` | JSON | Installed server metadata |
| `secrets/credentials.json` | JSON | API keys (file permissions: 600) |
| `sessions/*.json` | JSON | Chat session history |

---

## Error Codes

| Code | Description |
|------|-------------|
| `ERR_PERMISSION_DENIED` | Caller lacks required permission |
| `ERR_SCOPE_REQUIRED` | Permission scope not granted |
| `ERR_SERVER_UNAVAILABLE` | MCP server not connected |
| `ERR_TOOL_NOT_FOUND` | Tool does not exist |
| `ERR_TOOL_NOT_ALLOWED` | Tool not in allowlist |
| `ERR_TOOL_TIMEOUT` | Tool call timed out |
| `ERR_TOOL_FAILED` | Tool execution error |
| `ERR_RATE_LIMITED` | Concurrent limit exceeded |
| `ERR_BUDGET_EXCEEDED` | Run budget exhausted |

---

## Security Model

| Layer | Protection |
|-------|------------|
| **Origin Isolation** | Permissions scoped to origin |
| **User Consent** | Explicit grants required |
| **No Payload Logging** | Tool args/results not logged |
| **Rate Limiting** | Prevents abuse |
| **Tool Allowlisting** | Origins can be restricted to specific tools |
| **Tab-Scoped Grants** | ALLOW_ONCE can be tied to a tab |
| **Secret Storage** | Credentials stored with restricted file permissions |

---

## Message Protocol

The bridge uses native messaging with length-prefixed JSON frames.

### Frame Format

```
┌─────────────────┬────────────────────────────────────────┐
│ Length (4 bytes)│ JSON Payload (UTF-8)                   │
│ Little-endian   │ { "type": "...", "request_id": "..." } │
└─────────────────┴────────────────────────────────────────┘
```

### Message Categories

**Server Management:** `add_server`, `remove_server`, `list_servers`, `connect_server`, `disconnect_server`

**MCP Operations:** `mcp_connect`, `mcp_list_tools`, `mcp_call_tool`, `mcp_read_resource`

**BYOC:** `connect_remote_mcp`, `disconnect_remote_mcp`, `page_chat_message`

**LLM:** `llm_detect`, `llm_chat`, `llm_set_active`

**Chat:** `chat_create_session`, `chat_send_message`, `chat_list_sessions`

**Host:** `host_list_tools`, `host_call_tool`, `host_grant_permission`

See [Developer Guide](docs/DEVELOPER_GUIDE.md) for complete message reference.
