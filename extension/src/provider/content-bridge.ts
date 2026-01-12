/**
 * Harbor JS AI Provider - Content Bridge
 * 
 * This content script:
 * 1. Injects the provider script into the page context
 * 2. Relays messages between the page and the background script
 * 3. Enforces basic origin validation
 */

import browser from 'webextension-polyfill';
import type { ProviderMessage, DeclaredMCPServer } from './types';

const NAMESPACE = 'harbor-provider';
const DEBUG = true;

// BYOC: Cache discovered MCP servers from <link> elements
let discoveredMcpServers: DeclaredMCPServer[] | null = null;

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[Harbor Content Bridge]', ...args);
  }
}

// =============================================================================
// Script Injection
// =============================================================================

function injectProviderScript(): void {
  // Create and inject the provider script
  const script = document.createElement('script');
  script.src = browser.runtime.getURL('provider-injected.js');
  script.type = 'module';
  
  // Insert at document start for earliest possible availability
  const target = document.head || document.documentElement;
  target.insertBefore(script, target.firstChild);
  
  // Clean up after injection
  script.onload = () => {
    script.remove();
    log('Provider script injected and loaded');
  };
  
  script.onerror = (err) => {
    console.error('[Harbor] Failed to inject provider script:', err);
    script.remove();
  };
}

// =============================================================================
// BYOC: MCP Server Discovery (<link rel="mcp-server">)
// =============================================================================

/**
 * Scan the document for <link rel="mcp-server"> elements.
 * Like RSS discovery, this allows sites to declare MCP server availability.
 */
function discoverMcpServers(): DeclaredMCPServer[] {
  if (discoveredMcpServers !== null) {
    return discoveredMcpServers;
  }
  
  const links = document.querySelectorAll('link[rel="mcp-server"]');
  discoveredMcpServers = Array.from(links).map(link => {
    const href = link.getAttribute('href');
    if (!href) return null;
    
    // Resolve relative URLs
    let url: string;
    try {
      url = new URL(href, window.location.origin).toString();
    } catch {
      return null;
    }
    
    return {
      url,
      title: link.getAttribute('title') || 'Unnamed Server',
      description: (link as HTMLLinkElement).dataset.description,
      tools: (link as HTMLLinkElement).dataset.tools?.split(',').map(t => t.trim()).filter(Boolean),
      transport: ((link as HTMLLinkElement).dataset.transport as 'sse' | 'websocket') || 'sse',
      iconUrl: (link as HTMLLinkElement).dataset.icon,
    };
  }).filter((s): s is DeclaredMCPServer => s !== null);
  
  log('Discovered MCP servers:', discoveredMcpServers.length);
  return discoveredMcpServers;
}

/**
 * Report discovered MCP servers to background for potential URL bar indicator.
 */
function reportMcpServersToBackground(): void {
  const servers = discoverMcpServers();
  if (servers.length > 0) {
    try {
      browser.runtime.sendMessage({
        type: 'mcp_servers_detected',
        servers,
        origin: window.location.origin,
      });
    } catch {
      // Background might not be listening, ignore
    }
  }
}

// =============================================================================
// Message Relay: Page <-> Content Script
// =============================================================================

// Port to background script (lazy connection)
let backgroundPort: browser.Runtime.Port | null = null;
const pendingMessages = new Map<string, { origin: string }>();

function getBackgroundPort(): browser.Runtime.Port {
  if (backgroundPort) return backgroundPort;
  
  backgroundPort = browser.runtime.connect({ name: 'provider-bridge' });
  
  backgroundPort.onMessage.addListener((message: ProviderMessage & { targetOrigin?: string }) => {
    log('Received from background:', message.type, message.requestId);
    
    // Relay response back to page
    // Note: postMessage to window goes to page context
    window.postMessage({
      namespace: NAMESPACE,
      type: message.type,
      requestId: message.requestId,
      payload: message.payload,
    }, '*');
  });
  
  backgroundPort.onDisconnect.addListener(() => {
    log('Background port disconnected');
    backgroundPort = null;
  });
  
  return backgroundPort;
}

// =============================================================================
// BYOC: Website Tool Call Handling
// =============================================================================

// Track pending tool calls waiting for page response
const pendingToolCalls = new Map<string, {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

/**
 * Call a website-defined tool via postMessage to the page.
 * Returns a promise that resolves with the tool result.
 */
function callWebsiteTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const callId = `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Set timeout for tool call
    const timeout = setTimeout(() => {
      pendingToolCalls.delete(callId);
      reject(new Error(`Tool call "${toolName}" timed out after 30 seconds`));
    }, 30000);
    
    pendingToolCalls.set(callId, { resolve, reject, timeout });
    
    // Send tool call request to page
    window.postMessage({
      namespace: 'harbor-website-tools',
      type: 'tool_call',
      callId,
      toolName,
      args,
    }, '*');
    
    log('Sent tool call to page:', toolName, callId);
  });
}

// Listen for tool call results from the page
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  const data = event.data;
  if (!data || data.namespace !== 'harbor-website-tools') return;
  
  if (data.type === 'tool_result') {
    const pending = pendingToolCalls.get(data.callId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingToolCalls.delete(data.callId);
      
      if (data.error) {
        pending.reject(new Error(data.error));
      } else {
        pending.resolve(data.result);
      }
      log('Received tool result:', data.callId, data.error ? 'error' : 'success');
    }
  }
});

// Listen for tool call requests from background (via runtime messages)
browser.runtime.onMessage.addListener((message: { 
  type: string; 
  toolName?: string; 
  args?: Record<string, unknown>;
  callId?: string;
}) => {
  if (message.type === 'website_tool_call' && message.toolName && message.callId) {
    log('Background requesting tool call:', message.toolName);
    
    callWebsiteTool(message.toolName, message.args || {})
      .then(result => {
        return browser.runtime.sendMessage({
          type: 'website_tool_result',
          callId: message.callId,
          result,
        });
      })
      .catch(err => {
        return browser.runtime.sendMessage({
          type: 'website_tool_result',
          callId: message.callId,
          error: err.message,
        });
      });
    
    return true; // Keep message channel open for async response
  }
  return false;
});

// =============================================================================
// Message Relay: Page <-> Content Script
// =============================================================================

// Listen for messages from page context
window.addEventListener('message', (event) => {
  // Only accept messages from same window (page context)
  if (event.source !== window) return;
  
  const data = event.data;
  if (!data || data.namespace !== NAMESPACE) return;
  
  // Skip responses (they come from background, not page)
  if (data.type.endsWith('_result') || 
      data.type === 'error' || 
      data.type === 'pong' ||
      data.type.includes('stream_') ||
      data.type === 'agent_run_event' ||
      data.type === 'response') {
    return;
  }
  
  log('Received from page:', data.type, data.requestId);
  
  // BYOC: Handle mcp_discover locally (no round-trip to background needed)
  if (data.type === 'mcp_discover') {
    const servers = discoverMcpServers();
    window.postMessage({
      namespace: NAMESPACE,
      type: 'mcp_discover_result',
      requestId: data.requestId,
      payload: { servers },
    }, '*');
    return;
  }
  
  // Track the origin for this request
  pendingMessages.set(data.requestId, { origin: window.location.origin });
  
  // Forward to background with origin information
  try {
    const port = getBackgroundPort();
    port.postMessage({
      namespace: NAMESPACE,
      type: data.type,
      requestId: data.requestId,
      payload: data.payload,
      origin: window.location.origin,
      href: window.location.href,
    });
  } catch (err) {
    // Port might be disconnected, try to send error response
    console.error('[Harbor Content Bridge] Failed to send to background:', err);
    window.postMessage({
      namespace: NAMESPACE,
      type: 'error',
      requestId: data.requestId,
      payload: {
        error: {
          code: 'ERR_INTERNAL',
          message: 'Failed to communicate with extension background',
        },
      },
    }, '*');
  }
});

// =============================================================================
// Initialization
// =============================================================================

// Only inject on http/https pages (not extension pages, about:, etc.)
const protocol = window.location.protocol;
if (protocol === 'http:' || protocol === 'https:') {
  // Inject as early as possible
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectProviderScript, { once: true });
  } else {
    injectProviderScript();
  }
  
  // BYOC: Scan for MCP servers after page loads and report to background
  if (document.readyState === 'complete') {
    reportMcpServersToBackground();
  } else {
    window.addEventListener('load', reportMcpServersToBackground, { once: true });
  }
  
  log('Content bridge initialized for', window.location.origin);
}

