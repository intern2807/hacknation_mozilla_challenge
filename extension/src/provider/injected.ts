/**
 * Harbor JS AI Provider - Injected Script
 * 
 * This script runs in the page context and creates the window.ai and window.agent APIs.
 * It communicates with the content script via window.postMessage.
 * 
 * Chrome Compatibility:
 * - If Chrome's built-in Prompt API exists, we create a unified wrapper
 * - The wrapper allows choosing between Chrome's on-device AI and Harbor's backend
 * - window.agent (MCP tools) is always Harbor-powered
 * 
 * This file uses the shared API core with the injected transport.
 */

import { createInjectedTransport } from './injected-transport';
import { createAiApi, createAgentApi } from './api-core';

// =============================================================================
// Create Transport and APIs
// =============================================================================

const transport = createInjectedTransport();
const harborAiApi = createAiApi(transport);
const harborAgentApi = createAgentApi(transport);

// =============================================================================
// Detect Chrome's Built-in Prompt API
// =============================================================================

// Save reference to Chrome's API if it exists
const chromeAi = (window as { ai?: unknown }).ai as {
  languageModel?: {
    capabilities?: () => Promise<{ available: string }>;
    create?: (options?: unknown) => Promise<unknown>;
  };
  canCreateTextSession?: () => Promise<string>;
  createTextSession?: (options?: unknown) => Promise<unknown>;
} | undefined;

const chromeAiExists = typeof chromeAi !== 'undefined';
let chromeAiAvailable = false;

// Check if Chrome's AI is actually usable (not just defined)
async function checkChromeAiAvailability(): Promise<boolean> {
  if (!chromeAi) return false;
  try {
    // Try the newer languageModel API first
    if (chromeAi.languageModel?.capabilities) {
      const caps = await chromeAi.languageModel.capabilities();
      return caps.available === 'readily' || caps.available === 'after-download';
    }
    // Fall back to older API
    if (chromeAi.canCreateTextSession) {
      const status = await chromeAi.canCreateTextSession();
      return status === 'readily' || status === 'after-download';
    }
  } catch {
    // Chrome AI not available or errored
  }
  return false;
}

// =============================================================================
// Create Unified AI API (wraps both Chrome and Harbor)
// =============================================================================

type Provider = 'auto' | 'chrome' | 'harbor';

interface UnifiedSessionOptions {
  provider?: Provider;
  systemPrompt?: string;
  temperature?: number;
  topK?: number;
  // Harbor-specific: enable MCP tools
  tools?: boolean;
  [key: string]: unknown;
}

interface UnifiedSession {
  prompt(input: string): Promise<string>;
  promptStreaming?(input: string): AsyncIterable<string>;
  destroy?(): void;
  // Info about which provider is being used
  readonly provider: 'chrome' | 'harbor';
}

async function createUnifiedSession(options: UnifiedSessionOptions = {}): Promise<UnifiedSession> {
  const preferredProvider = options.provider || 'auto';
  
  // Determine which provider to use
  let useChrome = false;
  if (preferredProvider === 'chrome') {
    useChrome = chromeAiAvailable;
    if (!useChrome) {
      console.warn('[Harbor] Chrome AI requested but not available, falling back to Harbor');
    }
  } else if (preferredProvider === 'auto') {
    // Auto: use Harbor if tools are needed, otherwise prefer Chrome if available
    useChrome = chromeAiAvailable && !options.tools;
  }
  // 'harbor' or fallback = use Harbor
  
  if (useChrome && chromeAi) {
    // Use Chrome's built-in AI
    try {
      let chromeSession: { prompt: (input: string) => Promise<string>; destroy?: () => void };
      
      if (chromeAi.languageModel?.create) {
        chromeSession = await chromeAi.languageModel.create(options) as typeof chromeSession;
      } else if (chromeAi.createTextSession) {
        chromeSession = await chromeAi.createTextSession(options) as typeof chromeSession;
      } else {
        throw new Error('Chrome AI API not available');
      }
      
      return {
        provider: 'chrome',
        prompt: (input: string) => chromeSession.prompt(input),
        destroy: () => chromeSession.destroy?.(),
      };
    } catch (err) {
      console.warn('[Harbor] Chrome AI session failed, falling back to Harbor:', err);
    }
  }
  
  // Use Harbor's AI
  const harborSession = await harborAiApi.createTextSession({
    systemPrompt: options.systemPrompt,
    temperature: options.temperature,
    topK: options.topK,
  });
  
  return {
    provider: 'harbor',
    prompt: (input: string) => harborSession.prompt(input),
    promptStreaming: (input: string) => harborSession.promptStreaming(input),
    destroy: () => harborSession.destroy(),
  };
}

// Create the unified AI API
const unifiedAi = {
  // Unified session creator with provider choice
  createTextSession: createUnifiedSession,
  
  // Check availability across both providers
  canCreateTextSession: async (): Promise<'readily' | 'after-download' | 'no'> => {
    // Check Harbor first (always available if bridge connected)
    try {
      const harborStatus = await harborAiApi.canCreateTextSession();
      if (harborStatus === 'readily') return 'readily';
    } catch { /* Harbor not ready */ }
    
    // Check Chrome
    if (chromeAiAvailable) return 'readily';
    
    return 'no';
  },
  
  // Chrome-compatible languageModel namespace
  languageModel: {
    create: (options?: UnifiedSessionOptions) => createUnifiedSession(options),
    capabilities: async () => {
      const harborReady = await harborAiApi.canCreateTextSession().catch(() => 'no');
      return {
        available: harborReady === 'readily' || chromeAiAvailable ? 'readily' : 'no',
        // Additional capability info
        providers: {
          harbor: harborReady === 'readily',
          chrome: chromeAiAvailable,
        },
      };
    },
  },
  
  // Direct access to specific providers (Chrome/Harbor runtime choice)
  runtime: {
    harbor: harborAiApi,
    chrome: chromeAi || null,
    
    // Helper to get the best available provider
    async getBest(): Promise<'harbor' | 'chrome' | null> {
      const harborReady = await harborAiApi.canCreateTextSession().catch(() => 'no');
      if (harborReady === 'readily') return 'harbor';
      if (chromeAiAvailable) return 'chrome';
      return null;
    },
  },
  
  // LLM backend providers (OpenAI, Anthropic, Ollama, etc.)
  // Requires 'model:list' permission
  providers: harborAiApi.providers,
};

// =============================================================================
// Export to Window
// =============================================================================

// Create frozen agent API
const frozenAgent = Object.freeze({
  ...harborAgentApi,
  permissions: Object.freeze(harborAgentApi.permissions),
  tools: Object.freeze(harborAgentApi.tools),
  // BYOC: MCP server management
  mcp: Object.freeze({
    discover: harborAgentApi.mcp.discover,
    register: harborAgentApi.mcp.register,
    unregister: harborAgentApi.mcp.unregister,
  }),
  // BYOC: Chat UI control
  chat: Object.freeze({
    canOpen: harborAgentApi.chat.canOpen,
    open: harborAgentApi.chat.open,
    close: harborAgentApi.chat.close,
  }),
  browser: Object.freeze({
    activeTab: Object.freeze(harborAgentApi.browser.activeTab),
  }),
});

// Freeze the unified AI API
const frozenUnifiedAi = Object.freeze({
  ...unifiedAi,
  languageModel: Object.freeze(unifiedAi.languageModel),
  runtime: Object.freeze({
    ...unifiedAi.runtime,
    harbor: Object.freeze(harborAiApi),
  }),
  // LLM backend providers API (OpenAI, Anthropic, Ollama, etc.)
  providers: Object.freeze(harborAiApi.providers),
});

// Define window.ai - unified API that works with both Chrome and Harbor
try {
  if (chromeAiExists) {
    // Chrome's AI exists - we need to be careful
    // Try to enhance it rather than replace it
    console.log('[Harbor] Chrome built-in AI detected - creating unified wrapper');
  }
  
  Object.defineProperty(window, 'ai', {
    value: frozenUnifiedAi,
    writable: false,
    configurable: true, // Allow Chrome to potentially override later
    enumerable: true,
  });
} catch (err) {
  console.warn('[Harbor] Could not define window.ai:', err);
}

// Always define window.agent (Harbor-specific, for MCP tools)
Object.defineProperty(window, 'agent', {
  value: frozenAgent,
  writable: false,
  configurable: false,
  enumerable: true,
});

// Always provide window.harbor namespace (guaranteed no conflict)
const harborNamespace = Object.freeze({
  ai: Object.freeze(harborAiApi),
  agent: frozenAgent,
  // Version info
  version: '1.0.0',
  // Provider info
  chromeAiDetected: chromeAiExists,
});

Object.defineProperty(window, 'harbor', {
  value: harborNamespace,
  writable: false,
  configurable: false,
  enumerable: true,
});

// =============================================================================
// Initialize
// =============================================================================

// Check Chrome AI availability asynchronously
checkChromeAiAvailability().then(available => {
  chromeAiAvailable = available;
  
  // Signal that the provider is ready
  window.dispatchEvent(new CustomEvent('harbor-provider-ready', {
    detail: {
      chromeAiDetected: chromeAiExists,
      chromeAiAvailable: available,
      providers: {
        harbor: true,
        chrome: available,
      },
    }
  }));
  
  if (chromeAiExists) {
    if (available) {
      console.log('[Harbor] Unified AI Provider loaded - both Chrome and Harbor available');
      console.log('[Harbor] Use window.ai.createTextSession({ provider: "chrome" | "harbor" | "auto" })');
    } else {
      console.log('[Harbor] Chrome AI detected but not ready - using Harbor backend');
    }
  } else {
    console.log('[Harbor] AI Provider loaded - window.ai, window.agent, window.harbor available');
  }
});
