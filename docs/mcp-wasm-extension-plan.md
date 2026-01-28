# MCP WASM Extension + Rust Bridge Implementation Plan

## Goals
- Replace Docker-based MCP installs with WASM-only MCP servers.
- Keep the Web Agents API available in the extension.
- Minimize local bridge usage; use it only for local LLMs and filesystem access.
- Port `any-llm-ts` to `any-llm-rust` for local LLM support.
- Preserve the existing examples and UI styling (design tokens).

## Non-Goals (Initial)
- OAuth flows and credential exchange.
- Full parity with every existing MCP server (WASM-only is the rule).
- Multi-runtime support (Node/Python/Docker).

## System Overview

### Browser Extension (TypeScript)
**Responsibilities**
- Web Agents API implementation.
- WASM MCP runtime (WASI + wasmtime).
- MCP server lifecycle (install, start, stop).
- Capability policy enforcement (network, env, filesystem, LLM).
- LLM routing (local via bridge, remote via network).

**Core modules**
- `agents/`: Web Agents API entry points.
- `mcp/`: MCP host + tool router + server registry.
- `wasm/`: WASI runtime, module loader, sandbox enforcement.
- `policy/`: capability storage and permission prompts.
- `llm/`: provider routing and responses.
- `storage/`: persisted state (installed servers, permissions).

### WASM MCP Servers
**Packaging**
- WASM artifact + manifest.
- Manifest includes tool schema, permissions, env vars, version.
- Signed package recommended for integrity.

**Constraints**
- No direct filesystem or network unless granted via host APIs.
- No process spawning or shell access.

### Rust Local Bridge
**Responsibilities**
- Provide local filesystem operations (scoped, audited).
- Provide local LLM access via `any-llm-rust`.
- Provide stable RPC for extension.

**Bridge APIs**
- `llm.chat`, `llm.list_models`, `llm.health`
- `fs.read`, `fs.write`, `fs.list`, `fs.watch` (optional)
- `system.info` (diagnostics, versioning)

### any-llm-rust
**Responsibilities**
- Port `any-llm-ts` API surface.
- Support same backends (Ollama, llamafile, etc).
- Provide a single adapter layer for the bridge.

## Communication & Protocols

### Extension ↔ Bridge (Local)
- Protocol: HTTP JSON-RPC on localhost.
- Auth: shared token header stored in extension storage.
- Versioning: `bridge_version` in handshake response.

### Extension ↔ WASM MCP Servers
- In-process MCP over an in-memory stdio-like channel.
- MCP schema strictly validated by the host.

## Capability Model
- `network`: allow outbound fetch from server runtime.
- `env`: allow specific env vars to be read.
- `filesystem`: allow bridge operations for whitelisted paths.
- `llm`: allow LLM access (local or remote).

All capabilities are **opt-in** and enforced by the extension host.

## File/Directory Layout (Proposed)
- `extension/`
  - `src/agents/`
  - `src/mcp/`
  - `src/wasm/`
  - `src/policy/`
  - `src/llm/`
  - `src/storage/`
  - `src/ui/` (uses `design-tokens.css`)
- `bridge-rs/`
  - `src/main.rs`
  - `src/llm/`
  - `src/fs/`
  - `src/rpc/`
- `docs/mcp-wasm-extension-plan.md`
- `demo/` (keep examples)

## Phased Implementation

### Phase 1 — Extension Skeleton
- New extension manifest + background/service worker.
- Minimal Web Agents API surface.
- Storage layer for permissions and installed servers.
- Keep existing design tokens.

### Phase 2 — WASM MCP Runtime
- WASI + wasmtime integration.
- Module loader with manifest parsing.
- In-memory MCP transport.
- Tool routing with policy enforcement.

### Phase 3 — Rust Bridge MVP
- HTTP JSON-RPC server (localhost).
- LLM service stub (no real backend yet).
- Filesystem service with allowlist enforcement.

### Phase 4 — any-llm-rust
- Implement adapter interfaces matching `any-llm-ts`.
- Port highest-priority backends first (Ollama, llamafile).
- Bridge integrates local LLM calls.

### Phase 5 — UI & UX
- Server registry UI (install/remove).
- Capability prompts.
- Debug logs and status panel.

## Migration Strategy
- The `bridge-rs/` Rust bridge is now the primary native messaging bridge.
- Keep `demo/` and any Web Agents API examples.
- In-browser MCP execution (WASM + JS) runs in the extension itself.

## Testing Strategy
- Unit tests for WASM runtime and capability gating.
- Integration tests for MCP tool calls.
- Example apps in `demo/` used for Web Agents API verification.

## Immediate Tasks
- Create new extension skeleton with `design-tokens.css`.
- Add Rust bridge skeleton with JSON-RPC.
- Define shared RPC types and minimal wire format.
- Stub any-llm-rust interfaces.
