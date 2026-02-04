# Agentic Browser Roadmap

**Status**: Design Document  
**Author**: Raffi Krikorian  
**Last Updated**: January 2026

---

## Table of Contents

1. [Introduction](#introduction)
2. [Current State](#current-state)
3. [Gap Analysis: Browser Agency](#gap-analysis-browser-agency)
4. [Gap Analysis: Multi-Agent Support](#gap-analysis-multi-agent-support)
5. [Proposed Extensions](#proposed-extensions)
6. [Security Considerations](#security-considerations)
7. [Implementation Phases](#implementation-phases)

---

## Introduction

This document analyzes what additional capabilities the Web Agent API needs to support:

1. **Full Browser Agency** — Agents that can autonomously browse, interact with pages, and accomplish tasks across the web
2. **Multi-Agent Architectures** — Multiple specialized agents running in the browser, coordinating on complex tasks

The Web Agent API currently provides excellent primitives for AI-enhanced web applications. This document explores what's needed for the next level: browsers that can act autonomously on behalf of users.

---

## Current State

### What We Have

The Web Agent API (v1.4) provides:

| Capability | API | Status |
|------------|-----|--------|
| LLM Access | `window.ai.createTextSession()` | ✅ Complete |
| Multi-Provider | `ai.providers.list()`, native browser AI | ✅ Complete |
| Tool Execution | `agent.tools.list()`, `agent.tools.call()` | ✅ Complete |
| Autonomous Loop | `agent.run()` with tool calling | ✅ Complete |
| Page Content | `agent.browser.activeTab.readability()` | ✅ Complete |
| **Page Interaction** | `click()`, `fill()`, `scroll()` | ✅ **NEW** |
| **Screenshots** | `agent.browser.activeTab.screenshot()` | ✅ **NEW** |
| Permissions | Per-origin, capability-based | ✅ Complete |
| Address Bar | `agent.addressBar.*` | ✅ Complete |
| BYOC Platform | `agent.mcp.*`, `agent.chat.*` | ✅ Complete |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         WEB PAGE                                 │
│  window.ai (LLM)              window.agent (tools, browser)     │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│                    BROWSER EXTENSION                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Permissions │  │ Orchestrator│  │ MCP Host (WASM/JS/native)│  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────┐
│                    NATIVE BRIDGE (Rust)                          │
│  LLM Providers (Ollama, OpenAI, Anthropic, etc.)                │
└─────────────────────────────────────────────────────────────────┘
```

### Remaining Gaps

With same-tab page interaction now implemented, the remaining gaps are:

1. **Cross-Tab Control** — Agents cannot create/control other tabs (by design - see Security Model)
2. **Navigation** — No programmatic `navigate()` to other URLs
3. **Multi-Agent Coordination** — No discovery or communication between agents
4. **Web Fetch** — `web:fetch` permission reserved but not implemented

---

## Gap Analysis: Browser Agency

For "Operator/Computer Use" style automation, agents need to control the browser.

### 1. Page Interaction APIs (Critical)

**Missing:** Ability to interact with page elements.

```typescript
// Proposed API
interface ActiveTabInteraction {
  // Query elements
  querySelector(selector: string): Promise<ElementInfo | null>;
  querySelectorAll(selector: string): Promise<ElementInfo[]>;
  
  // Interactions
  click(selector: string, options?: ClickOptions): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  check(selector: string, checked?: boolean): Promise<void>;
  
  // Scrolling
  scroll(options: ScrollOptions): Promise<void>;
  scrollIntoView(selector: string): Promise<void>;
  
  // Waiting
  waitForSelector(selector: string, options?: WaitOptions): Promise<ElementInfo>;
  waitForNavigation(options?: WaitOptions): Promise<void>;
  
  // Visual
  screenshot(options?: ScreenshotOptions): Promise<string>;  // base64
  boundingBox(selector: string): Promise<BoundingBox | null>;
}

interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  isEnabled: boolean;
  boundingBox?: BoundingBox;
}

interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;  // Capture specific element
  format?: 'png' | 'jpeg';
  quality?: number;
}
```

**Permission Scope:** `browser:activeTab.interact`

**Risk Level:** High — enables automation of any visible page.

### 2. Navigation APIs (Critical)

**Missing:** Programmatic navigation and tab management.

```typescript
// Proposed API
interface BrowserNavigation {
  // Current tab
  navigate(url: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  
  // Tab management
  tabs: {
    create(options?: TabCreateOptions): Promise<TabInfo>;
    list(options?: TabQueryOptions): Promise<TabInfo[]>;
    get(tabId: number): Promise<TabInfo>;
    update(tabId: number, options: TabUpdateOptions): Promise<TabInfo>;
    close(tabId: number): Promise<void>;
    activate(tabId: number): Promise<void>;
  };
  
  // Window management (optional)
  windows?: {
    create(options?: WindowCreateOptions): Promise<WindowInfo>;
    list(): Promise<WindowInfo[]>;
    close(windowId: number): Promise<void>;
  };
}

interface TabInfo {
  id: number;
  url: string;
  title: string;
  active: boolean;
  windowId: number;
  status: 'loading' | 'complete';
}

interface TabCreateOptions {
  url?: string;
  active?: boolean;
  index?: number;
}
```

**Permission Scopes:**
- `browser:navigate` — Navigate current tab
- `browser:tabs.read` — List and query tabs
- `browser:tabs.manage` — Create, close, activate tabs

### 3. Web Fetch (High Priority)

**Status:** Reserved in v1, not implemented.

```typescript
// Proposed API
interface WebFetch {
  fetch(url: string, options?: FetchOptions): Promise<Response>;
}

interface FetchOptions extends RequestInit {
  // Additional options for proxied fetch
  followRedirects?: boolean;
  timeout?: number;
  // User-agent override (with restrictions)
  userAgent?: string;
}
```

**Permission Scope:** `web:fetch`

**Risk Level:** High — can access cross-origin resources, potential for data exfiltration.

**Mitigations:**
- URL allowlisting per origin
- Rate limiting
- No access to user cookies/sessions unless explicitly granted

### 4. Context APIs (Medium Priority)

**Missing:** Access to browser context beyond active tab.

```typescript
// Proposed API
interface BrowserContext {
  // History
  history: {
    search(query: string, options?: HistorySearchOptions): Promise<HistoryItem[]>;
    getVisits(url: string): Promise<VisitItem[]>;
  };
  
  // Bookmarks
  bookmarks: {
    search(query: string): Promise<BookmarkItem[]>;
    get(id: string): Promise<BookmarkItem>;
    create(bookmark: BookmarkCreateInfo): Promise<BookmarkItem>;
  };
  
  // Downloads
  downloads: {
    search(query: DownloadQuery): Promise<DownloadItem[]>;
    download(options: DownloadOptions): Promise<number>;  // downloadId
  };
}
```

**Permission Scopes:**
- `browser:history.read` — Search history
- `browser:bookmarks.read` — Search bookmarks
- `browser:bookmarks.write` — Create bookmarks
- `browser:downloads.read` — List downloads
- `browser:downloads.write` — Initiate downloads

### 5. Multi-Modal Input (Future)

**Missing:** Visual understanding of pages.

```typescript
// Proposed API
interface VisualContext {
  // Get visual representation for LLM
  captureForVision(options?: CaptureOptions): Promise<{
    screenshot: string;  // base64
    elements: AnnotatedElement[];  // Elements with bounding boxes
  }>;
  
  // Accessibility tree (structured page representation)
  getAccessibilityTree(): Promise<AccessibilityNode>;
}

interface AnnotatedElement {
  selector: string;
  role: string;
  name: string;
  boundingBox: BoundingBox;
  // For vision models to reference
  annotationId: string;
}
```

This enables "point and click" style visual agents.

---

## Gap Analysis: Multi-Agent Support

### The Discovery Problem

If Agent A (Research) wants to delegate to Agent B (Code), how does it find Agent B?

**Current state:** No discovery mechanism. Agents don't know about each other.

### Options Considered

#### Option 1: Orchestrator Pattern (No Protocol)

One master agent coordinates sub-agents internally.

```
User Request
     │
     ▼
┌─────────────────────────────────────┐
│         Orchestrator Agent          │
│  (decides which specialist to use)  │
└────┬────────────────────────┬───────┘
     │                        │
     ▼                        ▼
┌──────────┐            ┌──────────┐
│ Research │            │   Code   │
│  Agent   │            │  Agent   │
└──────────┘            └──────────┘
```

**Pros:** Simple, no new protocols
**Cons:** All agents must run in same process, no true multi-agent

#### Option 2: MCP-as-Agents (Recommended for Local)

Agents expose themselves as MCP servers with a `run_task` tool.

```typescript
// Agent as MCP Server
{
  name: "research-agent",
  tools: [{
    name: "run_task",
    description: "Delegate a research task to this agent",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        context: { type: "object" }
      }
    }
  }]
}
```

Agent A finds Agent B via `agent.tools.list()` and calls it via `agent.tools.call()`.

**Pros:** Works with existing infrastructure, tools compose naturally
**Cons:** No streaming progress, synchronous only, limited metadata

#### Option 3: A2A Protocol (For Distributed/Remote)

Full agent-to-agent protocol with discovery, task lifecycle, streaming.

**Pros:** Designed for the problem, rich semantics
**Cons:** Additional complexity, overkill for local-only

### Recommended Approach: Agent Registry

A middle ground that enables multi-agent without full A2A complexity.

```typescript
// New namespace: agent.agents
interface AgentRegistry {
  // Agent lifecycle
  register(config: AgentConfig): Promise<{ agentId: string }>;
  unregister(agentId: string): Promise<void>;
  
  // Discovery
  list(): Promise<AgentDescriptor[]>;
  get(agentId: string): Promise<AgentDescriptor | null>;
  
  // Invocation
  invoke(agentId: string, request: AgentRequest): AsyncIterable<AgentEvent>;
  
  // Messaging (for bidirectional communication)
  send(agentId: string, message: AgentMessage): Promise<void>;
  onMessage(callback: (from: string, message: AgentMessage) => void): void;
}

interface AgentConfig {
  id: string;
  name: string;
  description: string;
  
  // What backs this agent
  provider: string;           // LLM provider ID
  model?: string;             // Specific model
  systemPrompt?: string;      // Agent personality/role
  
  // What tools this agent has access to
  tools?: string[];           // MCP tool names
  mcpServers?: string[];      // Or entire MCP servers
  
  // Capabilities this agent provides
  capabilities?: string[];    // e.g., ['research', 'coding', 'analysis']
  
  // Constraints
  maxConcurrentTasks?: number;
}

interface AgentDescriptor extends AgentConfig {
  status: 'idle' | 'busy' | 'offline';
  currentTasks?: number;
  registeredAt: number;
  lastActiveAt: number;
}

interface AgentRequest {
  task: string;
  context?: Record<string, unknown>;
  parentTaskId?: string;      // For task hierarchies
  priority?: 'low' | 'normal' | 'high';
}

type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'progress'; percent: number; message?: string }
  | { type: 'artifact'; name: string; content: string; mimeType?: string }
  | { type: 'delegation'; toAgent: string; task: string }
  | { type: 'token'; token: string }
  | { type: 'final'; output: string; artifacts?: Artifact[] }
  | { type: 'error'; error: { code: string; message: string } };

interface AgentMessage {
  type: string;
  payload: unknown;
  replyTo?: string;  // For request/response patterns
}
```

### How Discovery Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER EXTENSION                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    AGENT REGISTRY                         │   │
│  │                                                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │ Research    │  │ Code        │  │ Memory      │      │   │
│  │  │ Agent       │  │ Agent       │  │ Agent       │      │   │
│  │  │             │  │             │  │             │      │   │
│  │  │ provider:   │  │ provider:   │  │ provider:   │      │   │
│  │  │  anthropic  │  │  openai     │  │  ollama     │      │   │
│  │  │             │  │             │  │             │      │   │
│  │  │ tools:      │  │ tools:      │  │ tools:      │      │   │
│  │  │  brave-     │  │  github/*   │  │  memory/*   │      │   │
│  │  │  search/*   │  │  fs/*       │  │             │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  │                                                          │   │
│  │  Registry provides:                                      │   │
│  │  • list() - enumerate all registered agents              │   │
│  │  • get(id) - get agent details                          │   │
│  │  • invoke(id, task) - run task on agent                 │   │
│  │  • send(id, msg) - direct messaging                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Example: Multi-Agent Task

```javascript
// User asks: "Research quantum computing and write a summary doc"

// 1. Orchestrator (or user) registers specialized agents
await agent.agents.register({
  id: 'researcher',
  name: 'Research Specialist',
  provider: 'anthropic',
  model: 'claude-3-5-sonnet',
  systemPrompt: 'You are a research specialist...',
  tools: ['brave-search/*', 'web-scraper/*'],
  capabilities: ['research', 'summarization'],
});

await agent.agents.register({
  id: 'writer',
  name: 'Technical Writer',
  provider: 'openai',
  model: 'gpt-4o',
  systemPrompt: 'You are a technical writer...',
  tools: ['memory/*', 'filesystem/*'],
  capabilities: ['writing', 'documentation'],
});

// 2. Discover available agents
const agents = await agent.agents.list();
console.log('Available agents:', agents.map(a => `${a.name} (${a.id})`));

// 3. Orchestrator delegates to research agent
const researchResults = [];
for await (const event of agent.agents.invoke('researcher', {
  task: 'Research recent developments in quantum computing',
})) {
  if (event.type === 'progress') {
    console.log(`Research: ${event.percent}% - ${event.message}`);
  }
  if (event.type === 'artifact') {
    researchResults.push(event);
  }
  if (event.type === 'final') {
    console.log('Research complete:', event.output);
  }
}

// 4. Orchestrator delegates to writer agent with research context
for await (const event of agent.agents.invoke('writer', {
  task: 'Write a technical summary document',
  context: {
    research: researchResults,
    format: 'markdown',
    audience: 'technical',
  },
})) {
  if (event.type === 'final') {
    console.log('Document:', event.output);
  }
}
```

### Agent-to-Agent Communication

For more complex scenarios where agents need to communicate directly:

```javascript
// Agent A sets up message handler
agent.agents.onMessage((fromAgentId, message) => {
  if (message.type === 'clarification_request') {
    // Another agent is asking for clarification
    agent.agents.send(fromAgentId, {
      type: 'clarification_response',
      payload: { answer: '...' },
      replyTo: message.replyTo,
    });
  }
});

// Agent B sends a message to Agent A
await agent.agents.send('researcher', {
  type: 'clarification_request',
  payload: { question: 'Should I include historical context?' },
  replyTo: crypto.randomUUID(),
});
```

---

## Proposed Extensions

### New Permission Scopes

| Scope | Risk | Description |
|-------|------|-------------|
| `browser:activeTab.interact` | High | Click, fill, scroll on active tab |
| `browser:activeTab.screenshot` | Medium | Capture tab screenshots |
| `browser:navigate` | Medium | Navigate current tab |
| `browser:tabs.read` | Low | List and query tabs |
| `browser:tabs.manage` | Medium | Create, close, activate tabs |
| `browser:history.read` | Medium | Search browsing history |
| `browser:bookmarks.read` | Low | Search bookmarks |
| `browser:bookmarks.write` | Medium | Create/modify bookmarks |
| `browser:downloads.read` | Low | List downloads |
| `browser:downloads.write` | Medium | Initiate downloads |
| `web:fetch` | High | Proxy HTTP requests |
| `agents:register` | Medium | Register agents |
| `agents:invoke` | Medium | Invoke other agents |
| `agents:message` | Low | Send messages to agents |

### API Surface Summary

```typescript
// Existing
window.ai.createTextSession()
window.ai.providers.*
window.ai.runtime.*
window.agent.requestPermissions()
window.agent.permissions.*
window.agent.tools.*
window.agent.browser.activeTab.readability()
window.agent.run()
window.agent.addressBar.*
window.agent.mcp.*
window.agent.chat.*

// Proposed: Browser Control
window.agent.browser.activeTab.click()
window.agent.browser.activeTab.fill()
window.agent.browser.activeTab.scroll()
window.agent.browser.activeTab.screenshot()
window.agent.browser.activeTab.waitForSelector()
window.agent.browser.navigate()
window.agent.browser.tabs.*
window.agent.browser.history.*
window.agent.browser.bookmarks.*
window.agent.browser.downloads.*
window.agent.web.fetch()

// Proposed: Multi-Agent
window.agent.agents.register()
window.agent.agents.unregister()
window.agent.agents.list()
window.agent.agents.get()
window.agent.agents.invoke()
window.agent.agents.send()
window.agent.agents.onMessage()
```

---

## Security Model: Browser Control

Browser control is powerful and dangerous. We implement a **Same-Tab Only** model for web pages.

### The Three Models

| Model | Who Can Use | What They Can Control | Status |
|-------|-------------|----------------------|--------|
| **Same-Tab Only** | Web pages | Their own tab only | ✅ Implemented |
| **Spawn and Control** | Trusted web pages | Tabs they create | 🔮 Future |
| **Extension-Only** | Extension sidebar | Any tab (user visible) | 🔮 Future |

### Model 1: Same-Tab Only (Implemented)

Web pages can only interact with **their own DOM**. The tab ID is derived from the message sender, not user selection.

```javascript
// On example.com - this can ONLY interact with example.com's tab
await agent.browser.activeTab.click('#submit');  // ✅ Works
await agent.browser.activeTab.fill('#email', 'user@example.com');  // ✅ Works

// Cannot control other tabs - there's no API for it
```

**How it works:**

```
┌─────────────────────────────────────────────────────────────────┐
│  TAB A: example.com (tabId: 123)                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ await agent.browser.activeTab.click('#btn');                ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Message includes tabId: 123 from sender
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKGROUND SCRIPT                                               │
│  • Extracts tabId from port.sender.tab.id (not from payload!)   │
│  • Executes click in tab 123 only                               │
│  • Cannot be tricked into controlling other tabs                │
└─────────────────────────────────────────────────────────────────┘
```

**Permissions:**
- `browser:activeTab.read` — Read text content (readability)
- `browser:activeTab.interact` — Click, fill, scroll, select
- `browser:activeTab.screenshot` — Capture screenshots

**Feature Flags (disabled by default):**
These APIs are gated behind feature flags that must be enabled in Harbor settings:
- `browserInteraction` — Required for click, fill, scroll, select
- `screenshots` — Required for screenshot()

This provides defense-in-depth: even if a page has the permission, the feature must be globally enabled.

### Model 2: Spawn and Control (Future)

For automation scenarios, web pages could create new tabs and control only tabs they created.

```javascript
// On automation-tool.com (future API)
const tabId = await agent.browser.tabs.create({ url: 'https://target.com' });
await agent.browser.tabs.click(tabId, '#search');  // Only works because we created it
```

**Safeguards:**
- Track which origin created which tabs
- Tabs "owned" by an origin can only be controlled by that origin
- User explicitly grants "spawn tabs" permission

### Model 3: Extension-Only (Future)

Full browser control from the extension's own UI (sidebar, popup). The user is watching.

```
┌─────────────────────────────────────────────────────────────────┐
│  EXTENSION SIDEBAR (trusted context)                             │
│                                                                  │
│  User: "Book me a flight to NYC"                                │
│  Agent: [Opens kayak.com, fills form, user watches]             │
│                                                                  │
│  • Full tab control                                             │
│  • User sees what's happening                                   │
│  • Code runs in extension context, not web page                 │
└─────────────────────────────────────────────────────────────────┘
```

### Developer Options

| Option | Complexity | Control Level | Example Use Case |
|--------|------------|---------------|------------------|
| MCP Servers | Low | No browser control | Search, databases, APIs |
| Same-Tab Interaction | Medium | Own page only | Form assistants, page analyzers |
| Request Automation | Medium | User-approved steps | Guided workflows |
| Fork Harbor | High | Full control | Specialized browser products |

### Security Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Page A controls Page B | Same-Tab Only: tabId from sender, not payload |
| Screenshot data exfiltration | Separate permission, rate limiting |
| Password field interaction | Could block password fields (not yet implemented) |
| Invisible automation | All interaction is on the calling page only |

---

## Implementation Status

### Phase 1: Same-Tab Browser Control ✅ COMPLETE

| API | Permission | Feature Flag | Status |
|-----|------------|--------------|--------|
| `activeTab.readability()` | `browser:activeTab.read` | None | ✅ Always available |
| `activeTab.click(selector)` | `browser:activeTab.interact` | `browserInteraction` | ✅ Behind flag |
| `activeTab.fill(selector, value)` | `browser:activeTab.interact` | `browserInteraction` | ✅ Behind flag |
| `activeTab.select(selector, value)` | `browser:activeTab.interact` | `browserInteraction` | ✅ Behind flag |
| `activeTab.scroll(options)` | `browser:activeTab.interact` | `browserInteraction` | ✅ Behind flag |
| `activeTab.getElement(selector)` | `browser:activeTab.read` | None | ✅ Always available |
| `activeTab.waitForSelector(selector)` | `browser:activeTab.read` | None | ✅ Always available |
| `activeTab.screenshot()` | `browser:activeTab.screenshot` | `screenshots` | ✅ Behind flag |

**To enable:** Open Harbor Directory → expand "Advanced Features" → toggle the flags.

### Phase 2: Navigation and Tabs (Planned)

| API | Permission | Status |
|-----|------------|--------|
| `browser.navigate(url)` | `browser:navigate` | 🔮 Planned |
| `browser.tabs.create()` | `browser:tabs.manage` | 🔮 Planned |
| `browser.tabs.list()` | `browser:tabs.read` | 🔮 Planned |
| `browser.tabs.close(tabId)` | `browser:tabs.manage` | 🔮 Planned |

### Phase 3: Multi-Agent Support (Planned)

| API | Permission | Status |
|-----|------------|--------|
| `agents.register(config)` | `agents:register` | 🔮 Planned |
| `agents.list()` | None | 🔮 Planned |
| `agents.invoke(id, task)` | `agents:invoke` | 🔮 Planned |
| `agents.send(id, message)` | `agents:message` | 🔮 Planned |

### Phase 4: Request Automation (Planned)

A system where web pages can **request** automations that the extension executes with user oversight.

```javascript
// Web page describes what it wants (future API)
await agent.requestAutomation({
  name: 'Submit expense report',
  steps: [
    { action: 'navigate', url: 'https://expenses.company.com' },
    { action: 'fill', selector: '#amount', value: '150.00' },
    { action: 'click', selector: '#submit' },
  ],
  reason: 'Submit your expense report'
});

// User sees a prompt reviewing the steps
// User approves
// Extension executes with user watching
```

### Phase 5: Advanced Features (Future)

1. Visual context for LLMs (`captureForVision()`)
2. Accessibility tree access
3. Remote agent discovery (A2A-style)
4. Agent marketplace/sharing

---

## Open Questions

1. **Should browser control be exposed to web pages?**
   - Option A: Only extension sidebar/popup can use these APIs
   - Option B: Web pages can request permission (higher risk)
   - Option C: Hybrid — basic ops for pages, full control for extension

2. **How should agent permissions work?**
   - Option A: Agents inherit invoker's permissions
   - Option B: Agents have their own permission sets
   - Option C: Intersection of invoker and agent permissions

3. **Should agents persist across browser sessions?**
   - Option A: Ephemeral only (recreate on each session)
   - Option B: Persistent registration (stored in extension storage)
   - Option C: User choice per agent

4. **How to handle agent costs/quotas?**
   - Different agents may use different (paid) LLM providers
   - Need usage tracking and limits per agent

---

## Conclusion

The Web Agent API provides a solid foundation for AI-enhanced web applications. To support full browser agency and multi-agent architectures, we need:

1. **Browser Control APIs** — Page interaction, navigation, tab management
2. **Agent Registry** — Discovery, lifecycle, invocation of multiple agents
3. **Agent Communication** — Messaging and coordination primitives
4. **Enhanced Permissions** — Fine-grained control over new capabilities

The recommended approach is incremental: start with browser control (highest immediate value), then add multi-agent support as use cases emerge.

---

*This document is a design proposal. Implementation details may change based on security review and user feedback.*
