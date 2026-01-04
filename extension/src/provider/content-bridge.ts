/**
 * Harbor JS AI Provider - Content Bridge
 * 
 * This content script:
 * 1. Injects the provider script into the page context
 * 2. Relays messages between the page and the background script
 * 3. Enforces basic origin validation
 */

import browser from 'webextension-polyfill';
import type { ProviderMessage } from './types';

const NAMESPACE = 'harbor-provider';
const DEBUG = true;

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
  
  log('Content bridge initialized for', window.location.origin);
}

