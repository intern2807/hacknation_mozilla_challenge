/**
 * Harbor JS AI Provider - Injected Script
 * 
 * This script runs in the page context and creates the window.ai and window.agent APIs.
 * It communicates with the content script via window.postMessage.
 * 
 * This file uses the shared API core with the injected transport.
 */

import { createInjectedTransport } from './injected-transport';
import { createAiApi, createAgentApi } from './api-core';

// =============================================================================
// Create Transport and APIs
// =============================================================================

const transport = createInjectedTransport();
const aiApi = createAiApi(transport);
const agentApi = createAgentApi(transport);

// =============================================================================
// Export to Window
// =============================================================================

// Create frozen, non-configurable APIs
const frozenAi = Object.freeze({
  ...aiApi,
  languageModel: Object.freeze(aiApi.languageModel),
});

const frozenAgent = Object.freeze({
  ...agentApi,
  permissions: Object.freeze(agentApi.permissions),
  tools: Object.freeze(agentApi.tools),
  browser: Object.freeze({
    activeTab: Object.freeze(agentApi.browser.activeTab),
  }),
});

// Define on window
Object.defineProperty(window, 'ai', {
  value: frozenAi,
  writable: false,
  configurable: false,
  enumerable: true,
});

Object.defineProperty(window, 'agent', {
  value: frozenAgent,
  writable: false,
  configurable: false,
  enumerable: true,
});

// Signal that the provider is ready
window.dispatchEvent(new CustomEvent('harbor-provider-ready'));

console.log('[Harbor] JS AI Provider v1 loaded (Chrome-compatible, shared core)');
