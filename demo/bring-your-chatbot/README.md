# Bring Your Own Chatbot (BYOC) Demo

**Status**: Implementation Plan / Proof of Concept  
**Last Updated**: January 2026

---

## Overview

This demo showcases "Bring Your Own Chatbot" (BYOC) — a pattern where websites can leverage the user's own AI chatbot (provided by their browser/extension) while providing site-specific context and tools.

### The Vision

1. A user visits an e-commerce website (or any site)
2. The website asks the browser to bring up the user's chatbot
3. The website provides its own MCP servers for the chatbot to use (product catalog, cart, order history, etc.)
4. The browser asks the user for permission
5. The website can provide styling hints for the chatbot UI
6. The browser displays the chatbot, configured to talk to the website's MCP servers
7. If the user doesn't have a chatbot or declines, the website gracefully degrades

### Benefits

- **User Control**: Users use their own AI with their own preferences, history, and privacy settings
- **No API Keys for Developers**: Website doesn't need to manage AI API keys
- **Contextual Tools**: Website provides domain-specific tools (inventory lookup, cart management, etc.)
- **Consistent UX**: User gets a familiar chatbot interface across different websites

---

## Current API Gap Analysis

The current Web Agent API (as implemented by Harbor) provides:

| Feature | Available | API |
|---------|-----------|-----|
| Text generation | ✓ | `window.ai.createTextSession()` |
| Agent with tools | ✓ | `window.agent.run()` |
| Permission system | ✓ | `window.agent.requestPermissions()` |
| List user's MCP tools | ✓ | `window.agent.tools.list()` |
| Call user's MCP tools | ✓ | `window.agent.tools.call()` |
| Read active tab | ✓ | `window.agent.browser.activeTab.readability()` |

### What's Missing for BYOC

| Feature | Status | Proposed API |
|---------|--------|--------------|
| Declarative MCP server discovery | ❌ | `<link rel="mcp-server">` |
| Register website's MCP server (JS) | ❌ | `window.agent.mcp.register()` |
| Discover declared MCP servers | ❌ | `window.agent.mcp.discover()` |
| Open browser's chatbot UI | ❌ | `window.agent.chat.open()` |
| Styling hints for chatbot | ❌ | Part of `chat.open()` options |
| Unregister MCP server | ❌ | `window.agent.mcp.unregister()` |
| Check chatbot availability | ❌ | `window.agent.chat.canOpen()` |

---

## Proposed API Extensions

### 0. `<link rel="mcp-server">` — Declarative MCP Server Discovery

Allow websites to declare their MCP server availability via a standard HTML `<link>` element, similar to RSS feeds, favicons, or manifest files.

```html
<!-- In the <head> of your HTML document -->
<link 
  rel="mcp-server" 
  href="https://shop.example/mcp/v1"
  title="Acme Shop Assistant"
  data-description="Search products, manage cart, track orders"
  data-tools="search_products,get_cart,add_to_cart,get_order_status"
>

<!-- Multiple servers can be declared -->
<link 
  rel="mcp-server" 
  href="https://shop.example/mcp/support"
  title="Acme Support"
  data-description="Customer support and returns"
>
```

**Attributes:**

| Attribute | Required | Description |
|-----------|----------|-------------|
| `rel` | ✓ | Must be `"mcp-server"` |
| `href` | ✓ | URL of the MCP server endpoint (SSE or WebSocket) |
| `title` | ✓ | Human-readable name shown to user |
| `data-description` | | Description of what the server provides |
| `data-tools` | | Comma-separated list of tool names |
| `data-icon` | | URL to server icon |
| `data-transport` | | `"sse"` (default) or `"websocket"` |

**Benefits:**

1. **Passive Discovery**: Browsers/extensions can detect MCP-capable sites without JavaScript
2. **Browser UI Integration**: Browser could show an indicator (like the RSS icon) when a site has MCP servers
3. **Crawlable**: Search engines could index MCP-enabled sites
4. **No JS Required**: Works even before JavaScript loads
5. **User-Initiated**: User clicks the browser's MCP indicator to connect, rather than the site prompting

**Browser Behavior:**

When a browser detects `<link rel="mcp-server">`:
1. Show an indicator in the URL bar (e.g., 🤖 icon)
2. User can click to see available MCP servers for this site
3. User can choose to connect their chatbot to these servers
4. Connection triggers permission prompt (same as `agent.mcp.register()`)

**JavaScript API for Discovery:**

```javascript
// Website can also query discovered MCP servers
const servers = await window.agent.mcp.discover();
// Returns: [{ url, title, description, tools }]

// Check if browser found any link-declared servers
if (servers.length > 0) {
  console.log('This page declares MCP servers:', servers);
}
```

**Relationship to `agent.mcp.register()`:**

| Approach | Initiated By | Use Case |
|----------|-------------|----------|
| `<link rel="mcp-server">` | User (clicks browser UI) | Passive discovery, user-driven |
| `agent.mcp.register()` | Website (JavaScript) | Active integration, website-driven |

**Note:** Like RSS feeds, the `<link>` element is a declaration that JavaScript cannot override. The JS API (`agent.mcp.register()`) can register *additional* servers dynamically, but cannot modify or remove link-declared servers. This is consistent with how `<link rel="alternate">` works for RSS—the link is the source of truth for what the page offers.

Both approaches use the same permission flow once activated.

---

### 1. `agent.mcp.register(options)` — Register Website's MCP Server

Allow a website to temporarily register an MCP server that the user's chatbot can access.

```typescript
interface MCPServerRegistration {
  // Server endpoint - must be HTTPS in production
  url: string;  // e.g., 'https://shop.example/mcp' (SSE) or 'wss://shop.example/mcp' (WebSocket)
  
  // Human-readable name shown to user
  name: string;  // e.g., 'Acme Shop Assistant'
  
  // Description of what the server provides
  description?: string;
  
  // Optional: list of tools this server provides (for transparency)
  tools?: string[];
  
  // Optional: server icon URL
  iconUrl?: string;
}

interface MCPRegistrationResult {
  success: boolean;
  serverId: string;  // ID to use for unregistration
  error?: {
    code: 'USER_DENIED' | 'INVALID_URL' | 'CONNECTION_FAILED' | 'NOT_SUPPORTED';
    message: string;
  };
}

// Register a website's MCP server
const result = await window.agent.mcp.register({
  url: 'https://shop.example/mcp/v1',
  name: 'Acme Shop',
  description: 'Search products, check inventory, manage cart',
  tools: ['search_products', 'get_cart', 'add_to_cart'],
  iconUrl: 'https://shop.example/favicon.ico'
});
```

**Permission Scope**: `mcp:servers.register` (new scope)

**Security Considerations**:
- Server URL must be same-origin OR explicitly allowed by user
- User sees a permission prompt showing server name, description, and tools
- Registration is temporary (cleared on page navigation or explicit unregister)
- Rate limiting on registration attempts

### 2. `agent.chat.canOpen()` — Check Chatbot Availability

```typescript
type ChatAvailability = 'readily' | 'no';

const availability = await window.agent.chat.canOpen();
// 'readily' - Chatbot is available and can be opened
// 'no' - No chatbot available (extension not installed, etc.)
```

### 3. `agent.chat.open(options)` — Open the Browser's Chatbot

Request the browser to display its chatbot UI, optionally configured with website-specific settings.

```typescript
interface ChatOpenOptions {
  // Initial message or context
  initialMessage?: string;
  
  // System prompt to configure the AI for this context
  systemPrompt?: string;
  
  // Which tools to make available (from registered MCP servers)
  tools?: string[];  // e.g., ['acme-shop/search_products', 'acme-shop/get_cart']
  
  // Styling hints (browser may ignore these)
  style?: {
    theme?: 'light' | 'dark' | 'auto';
    accentColor?: string;  // CSS color
    position?: 'right' | 'left' | 'center';
  };
  
  // Optional: callback when chat is closed
  onClose?: () => void;
}

interface ChatOpenResult {
  success: boolean;
  chatId?: string;  // ID to reference this chat session
  error?: {
    code: 'USER_DENIED' | 'NOT_AVAILABLE' | 'ALREADY_OPEN';
    message: string;
  };
}

const result = await window.agent.chat.open({
  systemPrompt: 'You are a helpful shopping assistant for Acme Shop. Be friendly and help customers find products.',
  tools: ['acme-shop/search_products', 'acme-shop/get_cart', 'acme-shop/add_to_cart'],
  style: {
    theme: 'light',
    accentColor: '#ff6600'
  }
});
```

**Permission Scope**: `chat:open` (new scope)

### 4. `agent.chat.close(chatId?)` — Close the Chatbot

```typescript
await window.agent.chat.close();
// or
await window.agent.chat.close(chatId);
```

### 5. `agent.mcp.unregister(serverId)` — Unregister MCP Server

```typescript
await window.agent.mcp.unregister(result.serverId);
```

---

## Permission Model Updates

### New Permission Scopes

| Scope | Description | Risk Level |
|-------|-------------|------------|
| `mcp:servers.register` | Allow website to register temporary MCP servers | Medium |
| `chat:open` | Allow website to request opening the chatbot | Low |

### Permission Prompt Flow

When a website calls `agent.mcp.register()`, the user sees:

```
┌─────────────────────────────────────────────────────────┐
│  🔌 shop.example wants to add an AI assistant          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  "Acme Shop"                                            │
│  Search products, check inventory, manage cart          │
│                                                         │
│  This will let your AI chatbot use these tools:         │
│  ☑ search_products - Search the product catalog        │
│  ☑ get_cart - View items in your cart                  │
│  ☑ add_to_cart - Add items to your cart               │
│                                                         │
│  The website will be able to:                           │
│  • Provide context to your AI assistant                 │
│  • See which tools your AI uses                         │
│                                                         │
│  [Allow Once]  [Always Allow]  [Deny]                   │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Demo with Current APIs (This Demo)

Create a demo that shows the *concept* using existing APIs:
- Embed a chat UI in the page
- Use `window.agent.run()` with a system prompt that describes the "website's context"
- Show graceful degradation when the API isn't available

**What this demonstrates**:
- The UX flow
- Permission handling
- Graceful degradation
- How the website would provide context

**Limitations**:
- Chat UI is embedded in the page, not the browser's own UI
- No actual MCP server registration (just simulated)
- Can only use the user's existing MCP tools

### Phase 2: MCP Server Registration (Requires API Extension)

Extend the Web Agent API to support `agent.mcp.register()`:
- Add new permission scope
- Implement server registration in the bridge
- Handle temporary server lifecycle

### Phase 3: Browser Chatbot UI (Requires API Extension)

Extend the API to support `agent.chat.open()`:
- Implement sidebar or popup chatbot UI in the browser/extension
- Support styling hints
- Implement lifecycle management

---

## Demo Implementation (Phase 1)

Since the full API doesn't exist yet, this demo will:

1. **Simulate the BYOC flow** with an embedded chat UI
2. **Use existing APIs** (`window.agent.run()`) under the hood
3. **Show the UX** of what a BYOC integration would look like
4. **Demonstrate graceful degradation** when the API isn't available

### Demo Structure

```
bring-your-chatbot/
├── index.html          # Main demo page (e-commerce mockup)
├── chatbot-widget.js   # Simulated BYOC chatbot widget
├── mcp-mock.js         # Mock MCP server responses (simulated)
└── README.md           # This file
```

### Key Demo Features

1. **"Open Chat" button** - Simulates website requesting chatbot
2. **Permission prompt mockup** - Shows what the permission flow would look like
3. **Chat UI** - Embedded chat that uses `window.agent.run()`
4. **Tool calls** - Demonstrates how website tools would work
5. **Graceful degradation** - What happens without the API

---

## Example: E-Commerce Integration

```javascript
// Example: E-commerce site integrating BYOC

async function initShopAssistant() {
  // Step 1: Check if chatbot is available
  if (typeof window.agent === 'undefined') {
    // Graceful degradation: show traditional help
    showTraditionalHelpButton();
    return;
  }

  // Step 2: Register our MCP server
  const regResult = await window.agent.mcp.register({
    url: 'https://shop.example/mcp/v1',
    name: 'Acme Shop Assistant',
    description: 'Search products, manage cart, track orders',
  });

  if (!regResult.success) {
    if (regResult.error.code === 'USER_DENIED') {
      showTraditionalHelpButton();
      return;
    }
    console.error('Failed to register MCP server:', regResult.error);
    return;
  }

  // Step 3: Show "Chat with AI" button
  showChatButton(() => {
    // Step 4: Open the chatbot when clicked
    window.agent.chat.open({
      systemPrompt: `You are a helpful shopping assistant for Acme Shop.
        The user is currently on the ${document.title} page.
        Help them find products, manage their cart, and answer questions.`,
      tools: [
        'acme-shop/search_products',
        'acme-shop/get_cart',
        'acme-shop/add_to_cart',
        'acme-shop/get_order_status'
      ],
      style: {
        theme: 'auto',
        accentColor: '#ff6600'
      }
    });
  });
}

// Initialize when page loads
initShopAssistant();
```

---

## Graceful Degradation Strategies

### When Web Agent API is not available

```javascript
if (typeof window.agent === 'undefined') {
  // Option 1: Traditional live chat
  showLiveChatWidget();
  
  // Option 2: FAQ/Help center
  showHelpCenterLink();
  
  // Option 3: Contact form
  showContactForm();
  
  // Option 4: Politely inform user
  showAIUnavailableMessage();
}
```

### When user denies permission

```javascript
const result = await window.agent.mcp.register({ ... });

if (!result.success && result.error.code === 'USER_DENIED') {
  // Don't be aggressive - just fall back gracefully
  console.log('User declined AI assistant');
  showAlternativeHelp();
}
```

### When LLM is not configured

```javascript
try {
  await window.ai.createTextSession();
} catch (err) {
  if (err.code === 'ERR_MODEL_FAILED') {
    showMessage('AI assistant needs to be configured. Check your browser settings.');
  }
}
```

---

## Security Considerations

### For the MCP Server Registration

1. **Same-Origin by Default**: MCP server URLs should be same-origin unless explicitly allowed
2. **HTTPS Required**: MCP server endpoints must use HTTPS in production
3. **Temporary Registration**: Registrations should be cleared on navigation
4. **Rate Limiting**: Prevent registration spam
5. **Tool Transparency**: Show users exactly what tools are being registered

### For the Chat API

1. **User Consent**: Always require explicit user action to open chat
2. **No Silent Operations**: Website cannot silently make the AI do things
3. **Visible UI**: Chatbot UI should be clearly distinguishable
4. **Easy Dismissal**: User must be able to easily close the chatbot

---

## Design Decisions

### Transport Protocol

Website MCP servers should support **both SSE and WebSocket**, with SSE as the recommended default:
- **SSE (Server-Sent Events)**: Simpler, works reliably through proxies and firewalls, sufficient for most use cases
- **WebSocket**: Available for bidirectional communication when needed

The `<link>` element can specify transport via `data-transport="sse"` (default) or `data-transport="websocket"`.

### Tool Namespacing

Tools from website MCP servers are automatically namespaced by origin to prevent collisions:
- Website registers: `search_products`
- User sees: `shop.example/search_products`

This ensures no collision with user's existing tools (e.g., if they have a `search_products` from another server).

### Session Persistence

Chat sessions can persist across page navigations if the website provides a session ID:

```javascript
await window.agent.chat.open({
  sessionId: 'user-session-abc123',  // Website-provided session ID
  // ... other options
});
```

If the same `sessionId` is provided on subsequent pages, the chat history continues. Without a session ID, each page gets a fresh conversation.

### Authentication

Authentication to website MCP servers is left open to use familiar web patterns:
- **Cookies**: Work automatically for same-origin servers
- **Bearer tokens**: Can be passed via query params or headers
- **OAuth**: Website handles OAuth flow, passes token to MCP server
- **Session cookies**: User's existing session with the website

The specific mechanism depends on the website's existing auth infrastructure.

### Mobile UX

Mobile support should be possible. Specific UX patterns (bottom sheet, full-screen, etc.) are left to implementation.

### Browser UI Opportunity

When a page declares MCP servers via `<link rel="mcp-server">`, browsers have an opportunity to surface this to users — similar to how browsers once showed RSS feed availability. The specific UI treatment (URL bar icon, toolbar indicator, page info panel, etc.) is left to browser implementations.

---

## Next Steps

1. ✅ Create this implementation plan
2. 🔄 Build Phase 1 demo with embedded chat
3. 📝 Propose API extensions to the Web Agent API spec
4. 🔨 Implement `agent.mcp.register()` in Harbor
5. 🔨 Implement `agent.chat.open()` in Harbor


