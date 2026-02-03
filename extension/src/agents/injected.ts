/**
 * Web Agent API - Injected Script
 *
 * This script is injected into web pages to expose:
 * - window.ai - Text generation API (Chrome Prompt API compatible)
 * - window.agent - Tools, browser access, and autonomous agent capabilities
 * - window.harbor - Guaranteed namespace with direct access to Harbor APIs
 * 
 * NOTE: Harbor exposes all features unconditionally. Feature flags are
 * managed by the Web Agents API extension, not Harbor.
 */

// Make this a module to avoid global scope conflicts with types
export {};

// =============================================================================
// Types (subset needed for injected context)
// =============================================================================

type PermissionScope =
  | 'model:prompt'
  | 'model:tools'
  | 'model:list'
  | 'mcp:tools.list'
  | 'mcp:tools.call'
  | 'mcp:servers.register'
  | 'browser:activeTab.read'
  | 'browser:activeTab.interact'
  | 'browser:activeTab.screenshot'
  | 'chat:open'
  | 'web:fetch';

type PermissionGrant = 'granted-once' | 'granted-always' | 'denied' | 'not-granted';

interface PermissionGrantResult {
  granted: boolean;
  scopes: Record<PermissionScope, PermissionGrant>;
  allowedTools?: string[];
}

interface PermissionStatus {
  origin: string;
  scopes: Record<PermissionScope, PermissionGrant>;
  allowedTools?: string[];
}

interface TextSessionOptions {
  model?: string;
  provider?: string;
  temperature?: number;
  top_p?: number;
  systemPrompt?: string;
}

interface AILanguageModelCreateOptions {
  systemPrompt?: string;
  initialPrompts?: Array<{ role: string; content: string }>;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

interface StreamToken {
  type: 'token' | 'done' | 'error';
  token?: string;
  error?: { code: string; message: string };
}

interface LLMProviderInfo {
  id: string;
  type: string;
  name: string;
  available: boolean;
  baseUrl?: string;
  models?: string[];
  isDefault: boolean;
  isTypeDefault?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  // Native provider fields
  isNative?: boolean;
  runtime?: 'firefox' | 'chrome' | 'bridge';
  downloadRequired?: boolean;
  downloadProgress?: number;
}

interface FirefoxCapabilities {
  available: boolean;
  hasWllama: boolean;
  hasTransformers: boolean;
  supportsTools: boolean;
  models: string[];
}

interface ChromeCapabilities {
  available: boolean;
  supportsTools: boolean;
}

interface HarborCapabilities {
  available: boolean;
  bridgeConnected: boolean;
  providers: string[];
}

interface RuntimeCapabilities {
  firefox: FirefoxCapabilities | null;
  chrome: ChromeCapabilities | null;
  harbor: HarborCapabilities;
}

interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  serverId?: string;
}

interface ActiveTabReadability {
  url: string;
  title: string;
  text: string;
}

interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  isVisible: boolean;
  isEnabled: boolean;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

type RunEvent =
  | { type: 'status'; message: string }
  | { type: 'tool_call'; tool: string; args: unknown }
  | { type: 'tool_result'; tool: string; result?: unknown; error?: { code: string; message: string } }
  | { type: 'token'; token: string }
  | { type: 'final'; output: string; citations?: Array<{ source: string; ref: string; excerpt: string }> }
  | { type: 'error'; error: { code: string; message: string } };

// =============================================================================
// Capabilities API Types
// =============================================================================

interface LLMCapabilities {
  available: boolean;
  streaming: boolean;
  toolCalling: boolean;
  providers: string[];
  bestRuntime: 'firefox' | 'chrome' | 'harbor' | null;
}

interface ToolCapabilities {
  available: boolean;
  count: number;
  servers: string[];
}

interface BrowserCapabilities {
  readActiveTab: boolean;
  interact: boolean;
  screenshot: boolean;
  navigate: boolean;
  readTabs: boolean;
  createTabs: boolean;
}

interface AgentCapabilities {
  register: boolean;
  discover: boolean;
  invoke: boolean;
  message: boolean;
  crossOrigin: boolean;
  remote: boolean;
}

interface CapabilityPermissions {
  llm: {
    prompt: PermissionGrant;
    tools: PermissionGrant;
    list: PermissionGrant;
  };
  mcp: {
    list: PermissionGrant;
    call: PermissionGrant;
    register: PermissionGrant;
  };
  browser: {
    read: PermissionGrant;
    interact: PermissionGrant;
    screenshot: PermissionGrant;
    navigate: PermissionGrant;
    tabsRead: PermissionGrant;
    tabsCreate: PermissionGrant;
  };
  agents: {
    register: PermissionGrant;
    discover: PermissionGrant;
    invoke: PermissionGrant;
    message: PermissionGrant;
    crossOrigin: PermissionGrant;
    remote: PermissionGrant;
  };
  web: {
    fetch: PermissionGrant;
  };
}

interface AgentCapabilitiesReport {
  version: string;
  llm: LLMCapabilities;
  tools: ToolCapabilities;
  browser: BrowserCapabilities;
  agents: AgentCapabilities;
  permissions: CapabilityPermissions;
  allowedTools: string[];
  features: {
    browserInteraction: boolean;
    screenshots: boolean;
    multiAgent: boolean;
    remoteTabs: boolean;
    webFetch: boolean;
  };
}

interface DeclaredMCPServer {
  url: string;
  title: string;
  description?: string;
  tools?: string[];
  transport?: 'sse' | 'websocket';
}

// =============================================================================
// Transport Layer
// =============================================================================

const CHANNEL = 'harbor_web_agent';

type MessageType = string;

interface TransportResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string };
}

interface TransportStreamEvent {
  id: string;
  event: RunEvent | StreamToken;
  done?: boolean;
}

const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }
>();

const streamListeners = new Map<string, (event: RunEvent | StreamToken, done: boolean) => void>();

// Initialize transport
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;

  const data = event.data as {
    channel?: string;
    response?: TransportResponse;
    streamEvent?: TransportStreamEvent;
  };

  if (data?.channel !== CHANNEL) return;

  // Handle regular response
  if (data.response) {
    const pending = pendingRequests.get(data.response.id);
    if (pending) {
      pendingRequests.delete(data.response.id);
      if (data.response.ok) {
        pending.resolve(data.response.result);
      } else {
        const err = new Error(data.response.error?.message || 'Request failed');
        (err as Error & { code?: string }).code = data.response.error?.code;
        pending.reject(err);
      }
    }
  }

  // Handle stream event
  if (data.streamEvent) {
    const listener = streamListeners.get(data.streamEvent.id);
    if (listener) {
      listener(data.streamEvent.event, data.streamEvent.done || false);
      if (data.streamEvent.done) {
        streamListeners.delete(data.streamEvent.id);
      }
    }
  }
});

function sendRequest<T>(type: MessageType, payload?: unknown): Promise<T> {
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

    window.postMessage({ channel: CHANNEL, request: { id, type, payload } }, '*');

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        const err = new Error('Request timeout');
        (err as Error & { code?: string }).code = 'ERR_TIMEOUT';
        reject(err);
      }
    }, 30000);
  });
}

function createStreamIterable<T extends RunEvent | StreamToken>(
  type: MessageType,
  payload?: unknown,
): AsyncIterable<T> {
  const id = crypto.randomUUID();

  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const queue: T[] = [];
      let resolveNext: ((result: IteratorResult<T>) => void) | null = null;
      let done = false;
      let error: Error | null = null;

      // Register stream listener before sending request
      streamListeners.set(id, (event, isDone) => {
        if (isDone) {
          done = true;
          streamListeners.delete(id);
        }

        // Check for error event
        if ('type' in event && event.type === 'error') {
          error = new Error((event as { error?: { message: string } }).error?.message || 'Stream error');
          (error as Error & { code?: string }).code =
            (event as { error?: { code: string } }).error?.code || 'ERR_INTERNAL';
          done = true;
        }

        if (resolveNext && !error) {
          resolveNext({ done: false, value: event as T });
          resolveNext = null;
        } else if (!error) {
          queue.push(event as T);
        }
      });

      // Send the request
      window.postMessage({ channel: CHANNEL, request: { id, type, payload } }, '*');

      return {
        async next(): Promise<IteratorResult<T>> {
          if (error) {
            throw error;
          }

          if (queue.length > 0) {
            return { done: false, value: queue.shift()! };
          }

          if (done) {
            return { done: true, value: undefined };
          }

          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },

        async return(): Promise<IteratorResult<T>> {
          done = true;
          streamListeners.delete(id);
          // Send abort signal
          window.postMessage({ channel: CHANNEL, abort: { id } }, '*');
          return { done: true, value: undefined };
        },
      };
    },
  };
}

// =============================================================================
// TextSession Implementation
// =============================================================================

interface TextSession {
  readonly sessionId: string;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<StreamToken>;
  destroy(): Promise<void>;
  clone(): Promise<TextSession>;
}

function createTextSessionObject(sessionId: string, options: TextSessionOptions): TextSession {
  return Object.freeze({
    sessionId,

    async prompt(input: string): Promise<string> {
      return sendRequest<string>('session.prompt', { sessionId, input });
    },

    promptStreaming(input: string): AsyncIterable<StreamToken> {
      return createStreamIterable<StreamToken>('session.promptStreaming', { sessionId, input });
    },

    async destroy(): Promise<void> {
      await sendRequest('session.destroy', { sessionId });
    },

    async clone(): Promise<TextSession> {
      const newSessionId = await sendRequest<string>('session.clone', { sessionId });
      return createTextSessionObject(newSessionId, options);
    },
  });
}

// =============================================================================
// window.ai Implementation
// =============================================================================

// Define the AI API interface to avoid circular type references
interface AiApiInterface {
  canCreateTextSession(): Promise<'readily' | 'after-download' | 'no'>;
  createTextSession(options?: TextSessionOptions): Promise<TextSession>;
  languageModel: {
    capabilities(): Promise<{
      available: 'readily' | 'after-download' | 'no';
      defaultTopK?: number;
      maxTopK?: number;
      defaultTemperature?: number;
    }>;
    create(options?: AILanguageModelCreateOptions): Promise<TextSession>;
  };
  providers: {
    list(): Promise<LLMProviderInfo[]>;
    getActive(): Promise<{ provider: string | null; model: string | null }>;
  };
  runtime: {
    readonly harbor: AiApiInterface;
    readonly firefox: unknown;
    readonly chrome: unknown;
    getBest(): Promise<'firefox' | 'chrome' | 'harbor' | null>;
    getCapabilities(): Promise<RuntimeCapabilities>;
  };
}

// Create aiApi object (not frozen yet so we can add runtime)
const aiApiBase: AiApiInterface = {
  async canCreateTextSession(): Promise<'readily' | 'after-download' | 'no'> {
    return sendRequest<'readily' | 'after-download' | 'no'>('ai.canCreateTextSession');
  },

  async createTextSession(options: TextSessionOptions = {}) {
    const sessionId = await sendRequest<string>('ai.createTextSession', options);
    return createTextSessionObject(sessionId, options);
  },

  languageModel: Object.freeze({
    async capabilities(): Promise<{
      available: 'readily' | 'after-download' | 'no';
      defaultTopK?: number;
      maxTopK?: number;
      defaultTemperature?: number;
    }> {
      return sendRequest('ai.languageModel.capabilities');
    },

    async create(options: AILanguageModelCreateOptions = {}) {
      const sessionOptions: TextSessionOptions = {
        systemPrompt: options.systemPrompt,
        temperature: options.temperature,
      };
      const sessionId = await sendRequest<string>('ai.languageModel.create', {
        ...sessionOptions,
        initialPrompts: options.initialPrompts,
        topK: options.topK,
      });
      return createTextSessionObject(sessionId, sessionOptions);
    },
  }),

  providers: Object.freeze({
    async list(): Promise<LLMProviderInfo[]> {
      return sendRequest<LLMProviderInfo[]>('ai.providers.list');
    },

    async getActive(): Promise<{ provider: string | null; model: string | null }> {
      return sendRequest('ai.providers.getActive');
    },
  }),

  runtime: null as unknown as AiApiInterface['runtime'],
};

// Create runtime with getters that reference aiApiBase
const aiRuntime: AiApiInterface['runtime'] = Object.freeze({
  get harbor(): AiApiInterface {
    return aiApiBase;
  },
  get firefox(): unknown {
    // Return Firefox's browser.trial.ml API if available
    try {
      const browserGlobal = typeof browser !== 'undefined' ? browser : null;
      return (browserGlobal as { trial?: { ml?: unknown } } | null)?.trial?.ml ?? null;
    } catch {
      return null;
    }
  },
  get chrome(): unknown {
    // Return Chrome's built-in AI if available
    const windowAi = (window as { ai?: unknown }).ai;
    return windowAi && windowAi !== aiApiBase ? windowAi : null;
  },
  async getBest(): Promise<'firefox' | 'chrome' | 'harbor' | null> {
    // Check Firefox wllama first (privacy-first local inference)
    const firefoxMl = this.firefox;
    if (firefoxMl && typeof firefoxMl === 'object') {
      const wllama = (firefoxMl as { wllama?: { createEngine?: unknown } }).wllama;
      if (wllama && typeof wllama.createEngine === 'function') {
        return 'firefox';
      }
    }

    // Check Chrome AI
    const chromeAi = this.chrome;
    if (chromeAi && typeof chromeAi === 'object' && 'languageModel' in chromeAi) {
      try {
        const lm = (chromeAi as { languageModel?: { capabilities?: () => Promise<{ available: string }> } }).languageModel;
        if (lm?.capabilities) {
          const caps = await lm.capabilities();
          if (caps.available === 'readily') return 'chrome';
        }
      } catch {
        // Chrome AI not available
      }
    }

    // Check Harbor bridge
    const harborAvailable = await aiApiBase.canCreateTextSession();
    if (harborAvailable === 'readily') return 'harbor';

    return harborAvailable !== 'no' ? 'harbor' : null;
  },
  async getCapabilities(): Promise<RuntimeCapabilities> {
    return sendRequest<RuntimeCapabilities>('ai.runtime.getCapabilities');
  },
});

// Set the runtime and freeze
aiApiBase.runtime = aiRuntime;
const aiApi = Object.freeze(aiApiBase);

// =============================================================================
// window.agent Implementation
// =============================================================================

const agentApi = Object.freeze({
  /**
   * Get a comprehensive report of all available capabilities.
   * This is the recommended way to discover what the agent can do.
   * 
   * @example
   * const caps = await window.agent.capabilities();
   * if (caps.llm.available && caps.llm.toolCalling) {
   *   // Can use LLM with tools
   * }
   * if (caps.permissions.browser.read === 'granted-always') {
   *   // Already has permission to read pages
   * }
   */
  async capabilities(): Promise<AgentCapabilitiesReport> {
    return sendRequest<AgentCapabilitiesReport>('agent.capabilities');
  },

  async requestPermissions(options: {
    scopes: PermissionScope[];
    reason?: string;
    tools?: string[];
  }): Promise<PermissionGrantResult> {
    return sendRequest<PermissionGrantResult>('agent.requestPermissions', options);
  },

  permissions: Object.freeze({
    async list(): Promise<PermissionStatus> {
      return sendRequest<PermissionStatus>('agent.permissions.list');
    },
  }),

  tools: Object.freeze({
    async list(): Promise<ToolDescriptor[]> {
      return sendRequest<ToolDescriptor[]>('agent.tools.list');
    },

    async call(options: { tool: string; args: Record<string, unknown> }): Promise<unknown> {
      return sendRequest('agent.tools.call', options);
    },
  }),

  browser: Object.freeze({
    // =========================================================================
    // Extension 1: Active Tab APIs (same-tab only)
    // =========================================================================
    activeTab: Object.freeze({
      /**
       * Extract readable text content from this page.
       * Requires: browser:activeTab.read permission
       */
      async readability(): Promise<ActiveTabReadability> {
        return sendRequest<ActiveTabReadability>('agent.browser.activeTab.readability');
      },

      /**
       * Click an element on this page.
       * Requires: browser:activeTab.interact permission
       * NOTE: Can only click elements on the page that called this API (same-tab only)
       */
      async click(selector: string, options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void> {
        return sendRequest('agent.browser.activeTab.click', { selector, options });
      },

      /**
       * Fill an input element on this page.
       * Requires: browser:activeTab.interact permission
       * NOTE: Can only fill inputs on the page that called this API (same-tab only)
       */
      async fill(selector: string, value: string): Promise<void> {
        return sendRequest('agent.browser.activeTab.fill', { selector, value });
      },

      /**
       * Select an option in a select element on this page.
       * Requires: browser:activeTab.interact permission
       */
      async select(selector: string, value: string): Promise<void> {
        return sendRequest('agent.browser.activeTab.select', { selector, value });
      },

      /**
       * Scroll the page or scroll an element into view.
       * Requires: browser:activeTab.interact permission
       */
      async scroll(options: { x?: number; y?: number; selector?: string; behavior?: 'auto' | 'smooth' }): Promise<void> {
        return sendRequest('agent.browser.activeTab.scroll', options);
      },

      /**
       * Get information about an element on this page.
       * Requires: browser:activeTab.read permission
       */
      async getElement(selector: string): Promise<ElementInfo | null> {
        return sendRequest<ElementInfo | null>('agent.browser.activeTab.getElement', { selector });
      },

      /**
       * Wait for an element to appear on this page.
       * Requires: browser:activeTab.read permission
       */
      async waitForSelector(selector: string, options?: { timeout?: number; visible?: boolean }): Promise<ElementInfo> {
        return sendRequest<ElementInfo>('agent.browser.activeTab.waitForSelector', { selector, options });
      },

      /**
       * Take a screenshot of this page.
       * Requires: browser:activeTab.screenshot permission
       */
      async screenshot(options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<string> {
        return sendRequest<string>('agent.browser.activeTab.screenshot', options);
      },
    }),

    // =========================================================================
    // Extension 2: Navigation API (requires browserControl flag)
    // =========================================================================

    /**
     * Navigate the current tab to a new URL.
     * Requires: browser:navigate permission
     * 
     * @example
     * await window.agent.browser.navigate('https://example.com');
     */
    async navigate(url: string): Promise<void> {
      return sendRequest('agent.browser.navigate', { url });
    },

    /**
     * Wait for the current navigation to complete.
     * Requires: browser:navigate permission
     */
    async waitForNavigation(options?: { timeout?: number }): Promise<void> {
      return sendRequest('agent.browser.waitForNavigation', options);
    },

    // =========================================================================
    // Extension 2: Tabs API (multi-tab)
    // =========================================================================
    tabs: Object.freeze({
      /**
       * List all open tabs with their metadata.
       * Requires: browser:tabs.read permission
       */
      async list(): Promise<Array<{
        id: number;
        url: string;
        title: string;
        active: boolean;
        index: number;
        windowId: number;
        favIconUrl?: string;
        status?: 'loading' | 'complete';
        canControl: boolean;
      }>> {
        return sendRequest('agent.browser.tabs.list');
      },

      /**
       * Get metadata for a specific tab.
       * Requires: browser:tabs.read permission
       */
      async get(tabId: number): Promise<{
        id: number;
        url: string;
        title: string;
        active: boolean;
        index: number;
        windowId: number;
        favIconUrl?: string;
        status?: 'loading' | 'complete';
        canControl: boolean;
      } | null> {
        return sendRequest('agent.browser.tabs.get', { tabId });
      },

      /**
       * Create a new tab.
       * Requires: browser:tabs.create permission
       */
      async create(options: {
        url: string;
        active?: boolean;
        index?: number;
        windowId?: number;
      }): Promise<{
        id: number;
        url: string;
        title: string;
        active: boolean;
        index: number;
        windowId: number;
        canControl: boolean;
      }> {
        return sendRequest('agent.browser.tabs.create', options);
      },

      /**
       * Close a tab that this origin created.
       * Requires: browser:tabs.create permission
       */
      async close(tabId: number): Promise<boolean> {
        return sendRequest('agent.browser.tabs.close', { tabId });
      },
    }),

    // =========================================================================
    // Extension 2: Spawned Tab Operations
    // Operations on tabs that this origin created (full control)
    // =========================================================================
    tab: Object.freeze({
      /**
       * Extract readable text content from a tab this origin created.
       */
      async readability(tabId: number): Promise<ActiveTabReadability> {
        return sendRequest<ActiveTabReadability>('agent.browser.tab.readability', { tabId });
      },

      /**
       * Get HTML content from a tab this origin created.
       * @param tabId - The tab ID
       * @param selector - Optional CSS selector to scope the HTML extraction
       */
      async getHtml(tabId: number, selector?: string): Promise<{ html: string; url: string; title: string }> {
        return sendRequest('agent.browser.tab.getHtml', { tabId, selector });
      },

      /**
       * Click an element in a tab this origin created.
       */
      async click(tabId: number, selector: string, options?: { button?: 'left' | 'right' | 'middle'; clickCount?: number }): Promise<void> {
        return sendRequest('agent.browser.tab.click', { tabId, selector, options });
      },

      /**
       * Fill an input element in a tab this origin created.
       */
      async fill(tabId: number, selector: string, value: string): Promise<void> {
        return sendRequest('agent.browser.tab.fill', { tabId, selector, value });
      },

      /**
       * Scroll in a tab this origin created.
       */
      async scroll(tabId: number, options: { x?: number; y?: number; selector?: string; behavior?: 'auto' | 'smooth' }): Promise<void> {
        return sendRequest('agent.browser.tab.scroll', { tabId, ...options });
      },

      /**
       * Take a screenshot of a tab this origin created.
       */
      async screenshot(tabId: number, options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<string> {
        return sendRequest<string>('agent.browser.tab.screenshot', { tabId, ...options });
      },

      /**
       * Navigate a tab this origin created to a new URL.
       */
      async navigate(tabId: number, url: string): Promise<void> {
        return sendRequest('agent.browser.tab.navigate', { tabId, url });
      },

      /**
       * Wait for navigation to complete in a tab this origin created.
       */
      async waitForNavigation(tabId: number, options?: { timeout?: number }): Promise<void> {
        return sendRequest('agent.browser.tab.waitForNavigation', { tabId, ...options });
      },
    }),
  }),

  // =========================================================================
  // Extension 2: Web Fetch API (CORS bypass)
  // =========================================================================

  /**
   * Make an HTTP request through the extension (bypasses CORS).
   * Requires: web:fetch permission
   * 
   * Only allowed for domains in the user's allowlist.
   */
  async fetch(url: string, options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text: string;
  }> {
    return sendRequest('agent.fetch', { url, ...options });
  },

  // =========================================================================
  // Extension 3: Multi-Agent API
  // =========================================================================
  agents: Object.freeze({
        /**
         * Register this page as an agent.
         * Requires: agents:register permission
         */
        async register(options: {
      name: string;
      description?: string;
      capabilities?: string[];
      tags?: string[];
      acceptsInvocations?: boolean;
      acceptsMessages?: boolean;
    }): Promise<{
      id: string;
      name: string;
      capabilities: string[];
      tags: string[];
    }> {
      return sendRequest('agents.register', options);
    },

    /**
     * Unregister this agent.
     * Requires: agents:register permission (must be the same agent that registered)
     */
    async unregister(agentId: string): Promise<boolean> {
      return sendRequest('agents.unregister', { agentId });
    },

    /**
     * Get information about the current agent.
     */
    async getInfo(agentId?: string): Promise<{
      id: string;
      name: string;
      description?: string;
      origin: string;
      capabilities: string[];
      tags: string[];
      status: 'active' | 'suspended' | 'terminated';
      usage: {
        promptCount: number;
        tokensUsed: number;
        toolCallCount: number;
        messagesSent: number;
        invocationsMade: number;
        invocationsReceived: number;
      };
    } | null> {
      return sendRequest('agents.getInfo', { agentId });
    },

    /**
     * Discover other agents.
     * Requires: agents:discover permission
     * Cross-origin discovery requires: agents:crossOrigin permission
     * 
     * @example
     * const agents = await window.agent.agents.discover({
     *   capabilities: ['summarize'],
     *   includeCrossOrigin: true
     * });
     */
    async discover(options?: {
      name?: string;
      capabilities?: string[];
      tags?: string[];
      includeSameOrigin?: boolean;
      includeCrossOrigin?: boolean;
      includeRemote?: boolean;
    }): Promise<Array<{
      id: string;
      name: string;
      description?: string;
      origin: string;
      capabilities: string[];
      tags: string[];
      acceptsInvocations: boolean;
      acceptsMessages: boolean;
      sameOrigin: boolean;
      isRemote: boolean;
    }>> {
      return sendRequest('agents.discover', options);
    },

    /**
     * List agents registered by this origin.
     */
    async list(): Promise<Array<{
      id: string;
      name: string;
      status: 'active' | 'suspended' | 'terminated';
    }>> {
      return sendRequest('agents.list');
    },

    /**
     * Invoke another agent to perform a task.
     * Requires: agents:invoke permission
     * Cross-origin invocation requires: agents:crossOrigin permission
     * 
     * Permission inheritance: The invoked agent's effective permissions are
     * bounded by your permissions (cannot exceed what you have).
     * 
     * @example
     * const result = await window.agent.agents.invoke({
     *   agentId: 'agent-123',
     *   task: 'Summarize this article',
     *   input: { text: articleText },
     *   timeout: 30000
     * });
     */
    async invoke(options: {
      agentId: string;
      task: string;
      input?: unknown;
      timeout?: number;
    }): Promise<{
      success: boolean;
      result?: unknown;
      error?: { code: string; message: string };
      executionTime: number;
    }> {
      return sendRequest('agents.invoke', options);
    },

    /**
     * Send a message to another agent.
     * Requires: agents:message permission
     * Cross-origin messaging requires: agents:crossOrigin permission
     * 
     * @example
     * await window.agent.agents.send({
     *   to: 'agent-123',
     *   payload: { type: 'update', data: someData }
     * });
     */
    async send(options: {
      to: string;
      payload: unknown;
    }): Promise<{ delivered: boolean; error?: string }> {
      return sendRequest('agents.send', options);
    },

    /**
     * Subscribe to events from other agents.
     * Requires: agents:message permission
     */
    async subscribe(eventType: string): Promise<void> {
      return sendRequest('agents.subscribe', { eventType });
    },

    /**
     * Unsubscribe from events.
     */
    async unsubscribe(eventType: string): Promise<void> {
      return sendRequest('agents.unsubscribe', { eventType });
    },

    /**
     * Set up a handler for incoming messages.
     * Returns an unsubscribe function.
     */
    onMessage(handler: (message: {
      id: string;
      from: string;
      type: string;
      payload: unknown;
      timestamp: number;
    }) => void): () => void {
      // Register handler via postMessage
      const handlerId = crypto.randomUUID();
      
      const listener = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data as { channel?: string; agentMessage?: unknown };
        if (data?.channel !== 'harbor_web_agent' || !data.agentMessage) return;
        handler(data.agentMessage as Parameters<typeof handler>[0]);
      };
      
      window.addEventListener('message', listener);
      sendRequest('agents.registerMessageHandler', { handlerId }).catch(() => {});
      
      return () => {
        window.removeEventListener('message', listener);
        sendRequest('agents.unregisterMessageHandler', { handlerId }).catch(() => {});
      };
    },

    /**
     * Set up a handler for incoming invocations.
     * Returns an unsubscribe function.
     * 
     * @example
     * const unsubscribe = window.agent.agents.onInvoke(async (request) => {
     *   // Process the task
     *   const result = await processTask(request.task, request.input);
     *   return { success: true, result };
     * });
     */
    onInvoke(handler: (request: {
      from: string;
      task: string;
      input?: unknown;
    }) => Promise<{
      success: boolean;
      result?: unknown;
      error?: { code: string; message: string };
    }>): () => void {
      const handlerId = crypto.randomUUID();
      
      const listener = async (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data as { 
          channel?: string; 
          agentInvocation?: { 
            requestId: string; 
            from: string; 
            task: string; 
            input?: unknown;
          };
        };
        if (data?.channel !== 'harbor_web_agent' || !data.agentInvocation) return;
        
        const request = data.agentInvocation;
        try {
          const response = await handler({
            from: request.from,
            task: request.task,
            input: request.input,
          });
          
          window.postMessage({
            channel: 'harbor_web_agent',
            agentInvocationResponse: {
              requestId: request.requestId,
              ...response,
            },
          }, '*');
        } catch (error) {
          window.postMessage({
            channel: 'harbor_web_agent',
            agentInvocationResponse: {
              requestId: request.requestId,
              success: false,
              error: {
                code: 'ERR_HANDLER_FAILED',
                message: error instanceof Error ? error.message : 'Handler failed',
              },
            },
          }, '*');
        }
      };
      
      window.addEventListener('message', listener);
      sendRequest('agents.registerInvocationHandler', { handlerId }).catch(() => {});
      
      return () => {
        window.removeEventListener('message', listener);
        sendRequest('agents.unregisterInvocationHandler', { handlerId }).catch(() => {});
      };
    },

    // =========================================================================
    // Remote Agents (A2A Protocol)
    // =========================================================================
    remote: Object.freeze({
      /**
       * Connect to a remote agent endpoint.
       * Requires: agents:remote permission
       * 
       * @example
       * const agent = await window.agent.agents.remote.connect({
       *   url: 'https://agent.example.com',
       *   version: '1.0'
       * });
       */
      async connect(endpoint: {
        url: string;
        version?: string;
        auth?: 'none' | 'bearer' | 'api-key';
      }): Promise<{
        id: string;
        name: string;
        description?: string;
        capabilities: string[];
        reachable: boolean;
      } | null> {
        return sendRequest('agents.remote.connect', endpoint);
      },

      /**
       * Disconnect from a remote agent.
       */
      async disconnect(agentId: string): Promise<boolean> {
        return sendRequest('agents.remote.disconnect', { agentId });
      },

      /**
       * List connected remote agents.
       */
      async list(): Promise<Array<{
        id: string;
        name: string;
        description?: string;
        capabilities: string[];
        url: string;
        reachable: boolean;
        lastPing?: number;
      }>> {
        return sendRequest('agents.remote.list');
      },

      /**
       * Check if a remote agent is reachable.
       */
      async ping(agentId: string): Promise<boolean> {
        return sendRequest('agents.remote.ping', { agentId });
      },

      /**
       * Discover remote agents from a server.
       * Looks for /.well-known/agents endpoint.
       */
      async discover(baseUrl: string): Promise<Array<{
        name: string;
        url: string;
        description?: string;
      }>> {
        return sendRequest('agents.remote.discover', { baseUrl });
      },
    }),

    // =========================================================================
    // Orchestration
    // =========================================================================
    orchestrate: Object.freeze({
      /**
       * Execute a pipeline of agent invocations.
       * Each step's output becomes the next step's input.
       * 
       * @example
       * const result = await window.agent.agents.orchestrate.pipeline({
       *   id: 'my-pipeline',
       *   name: 'Research Pipeline',
       *   steps: [
       *     { id: 'search', agentId: 'search-agent', taskTemplate: 'Search for: {{input}}' },
       *     { id: 'summarize', agentId: 'summarize-agent', taskTemplate: 'Summarize: {{input}}' }
       *   ]
       * }, 'quantum computing');
       */
      async pipeline(pipeline: {
        id: string;
        name: string;
        steps: Array<{
          id: string;
          agentId: string;
          taskTemplate: string;
          outputTransform?: string;
        }>;
      }, initialInput: unknown): Promise<{
        pipelineId: string;
        success: boolean;
        stepResults: Array<{
          stepId: string;
          agentId: string;
          success: boolean;
          result?: unknown;
          error?: string;
          executionTime: number;
        }>;
        finalOutput?: unknown;
        totalExecutionTime: number;
        error?: string;
      }> {
        return sendRequest('agents.orchestrate.pipeline', { pipeline, initialInput });
      },

      /**
       * Execute multiple agent invocations in parallel.
       * 
       * @example
       * const result = await window.agent.agents.orchestrate.parallel({
       *   id: 'my-parallel',
       *   tasks: [
       *     { agentId: 'agent-1', task: 'Analyze A', input: dataA },
       *     { agentId: 'agent-2', task: 'Analyze B', input: dataB }
       *   ],
       *   combineStrategy: 'array'
       * });
       */
      async parallel(execution: {
        id: string;
        tasks: Array<{
          agentId: string;
          task: string;
          input?: unknown;
        }>;
        combineStrategy: 'array' | 'merge' | 'first' | 'custom';
      }): Promise<{
        executionId: string;
        success: boolean;
        taskResults: Array<{
          agentId: string;
          success: boolean;
          result?: unknown;
          error?: string;
          executionTime: number;
        }>;
        combinedOutput?: unknown;
        totalExecutionTime: number;
      }> {
        return sendRequest('agents.orchestrate.parallel', execution);
      },

      /**
       * Route to an agent based on input conditions.
       * 
       * @example
       * const result = await window.agent.agents.orchestrate.route({
       *   id: 'my-router',
       *   name: 'Task Router',
       *   routes: [
       *     { condition: 'type:research', agentId: 'research-agent' },
       *     { condition: 'type:summary', agentId: 'summarize-agent' }
       *   ],
       *   defaultAgentId: 'general-agent'
       * }, { type: 'research', query: 'quantum computing' }, 'Process this request');
       */
      async route(router: {
        id: string;
        name: string;
        routes: Array<{
          condition: string;
          agentId: string;
        }>;
        defaultAgentId?: string;
      }, input: unknown, task: string): Promise<{
        routerId: string;
        selectedAgentId: string;
        matchedCondition: string | null;
        invocationResult: {
          success: boolean;
          result?: unknown;
          error?: { code: string; message: string };
          executionTime: number;
        };
      }> {
        return sendRequest('agents.orchestrate.route', { router, input, task });
      },

      /**
       * Execute tasks using a supervisor pattern with worker pool.
       * 
       * The supervisor distributes tasks to workers based on the assignment strategy,
       * handles retries on failure, and aggregates results.
       * 
       * @example
       * const result = await window.agent.agents.orchestrate.supervisor({
       *   id: 'my-supervisor',
       *   name: 'Research Supervisor',
       *   workers: ['worker-1', 'worker-2', 'worker-3'],
       *   assignmentStrategy: 'round-robin',
       *   retry: { maxAttempts: 2, delayMs: 1000, reassignOnFailure: true },
       *   aggregation: 'array'
       * }, [
       *   { id: 'task-1', task: 'Research topic A', priority: 1 },
       *   { id: 'task-2', task: 'Research topic B', priority: 2 }
       * ]);
       */
      async supervisor(supervisor: {
        /** Unique identifier */
        id: string;
        /** Human-readable name */
        name: string;
        /** Worker agent IDs */
        workers: string[];
        /** Assignment strategy: 'round-robin' | 'random' | 'least-busy' | 'capability-match' */
        assignmentStrategy: 'round-robin' | 'random' | 'least-busy' | 'capability-match';
        /** Max concurrent tasks per worker */
        maxConcurrentPerWorker?: number;
        /** Retry configuration */
        retry?: {
          maxAttempts: number;
          delayMs: number;
          reassignOnFailure: boolean;
        };
        /** Result aggregation: 'array' | 'merge' | 'custom' */
        aggregation: 'array' | 'merge' | 'custom';
      }, tasks: Array<{
        /** Task ID */
        id: string;
        /** Task description */
        task: string;
        /** Input data */
        input?: unknown;
        /** Required capabilities for capability-match strategy */
        requiredCapabilities?: string[];
        /** Priority (higher = more urgent) */
        priority?: number;
      }>): Promise<{
        success: boolean;
        results: Array<{
          taskId: string;
          workerId: string;
          result?: unknown;
          error?: string;
          attempts: number;
          executionTime: number;
        }>;
        stats: {
          totalTasks: number;
          succeeded: number;
          failed: number;
          totalTime: number;
        };
      }> {
        return sendRequest('agents.orchestrate.supervisor', { supervisor, tasks });
      },
    }),
  }),

  run(options: {
    task: string;
    tools?: string[];
    provider?: string;
    useAllTools?: boolean;
    requireCitations?: boolean;
    maxToolCalls?: number;
    signal?: AbortSignal;
  }): AsyncIterable<RunEvent> {
    // Handle AbortSignal
    const { signal, ...rest } = options;
    const iterable = createStreamIterable<RunEvent>('agent.run', rest);

    if (signal) {
      // Wrap the iterable to handle abort
      return {
        [Symbol.asyncIterator]() {
          const iterator = iterable[Symbol.asyncIterator]();

          signal.addEventListener('abort', () => {
            iterator.return?.();
          });

          return {
            next: () => {
              if (signal.aborted) {
                return Promise.resolve({ done: true, value: undefined } as IteratorResult<RunEvent>);
              }
              return iterator.next();
            },
            return: () => iterator.return?.() ?? Promise.resolve({ done: true, value: undefined }),
          };
        },
      };
    }

    return iterable;
  },

  // BYOC (Bring Your Own Chatbot) APIs
  mcp: Object.freeze({
    async discover(): Promise<DeclaredMCPServer[]> {
      // Discover <link rel="mcp-server"> elements in the current page
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel="mcp-server"]');
      const servers: DeclaredMCPServer[] = [];

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.getAttribute('title');
        if (href && title) {
          servers.push({
            url: new URL(href, window.location.href).toString(),
            title,
            description: link.dataset.description,
            tools: link.dataset.tools?.split(',').map((t) => t.trim()),
            transport: (link.dataset.transport as 'sse' | 'websocket') || 'sse',
          });
        }
      }

      return servers;
    },

    async register(options: {
      url: string;
      name: string;
      description?: string;
      tools?: string[];
      transport?: 'sse' | 'websocket';
    }): Promise<{ success: boolean; serverId?: string; error?: { code: string; message: string } }> {
      return sendRequest('agent.mcp.register', options);
    },

    async unregister(serverId: string): Promise<{ success: boolean }> {
      return sendRequest('agent.mcp.unregister', { serverId });
    },
  }),

  chat: Object.freeze({
    async canOpen(): Promise<'readily' | 'no'> {
      return sendRequest<'readily' | 'no'>('agent.chat.canOpen');
    },

    async open(options?: {
      initialMessage?: string;
      systemPrompt?: string;
      tools?: string[];
      sessionId?: string;
      style?: {
        theme?: 'light' | 'dark' | 'auto';
        accentColor?: string;
        position?: 'right' | 'left' | 'center';
      };
    }): Promise<{ success: boolean; chatId?: string; error?: { code: string; message: string } }> {
      return sendRequest('agent.chat.open', options);
    },

    async close(chatId?: string): Promise<{ success: boolean }> {
      return sendRequest('agent.chat.close', { chatId });
    },
  }),

  // Address Bar API
  addressBar: createAddressBarAPI(),
  
  // Command Bar is an alias for Address Bar
  get commandBar() {
    return this.addressBar;
  },
});

// =============================================================================
// Address Bar API Implementation
// =============================================================================

interface AddressBarTrigger {
  type: 'prefix' | 'keyword' | 'regex' | 'always';
  value: string;
  hint?: string;
}

interface AddressBarSuggestion {
  id: string;
  type: 'url' | 'search' | 'tool' | 'action' | 'answer';
  title: string;
  description?: string;
  icon?: string;
  url?: string;
  searchQuery?: string;
  searchEngine?: string;
  tool?: { name: string; args: Record<string, unknown> };
  action?: unknown;
  answer?: { text: string; source?: string; copyable?: boolean };
  confidence?: number;
  provider: string;
}

interface AddressBarQueryContext {
  query: string;
  trigger: AddressBarTrigger;
  currentTab?: { url: string; title: string; domain: string };
  recentHistory?: { url: string; title: string; visitCount: number; lastVisit: number }[];
  isTyping: boolean;
  timeSinceLastKeystroke: number;
}

interface AddressBarProviderOptions {
  id: string;
  name: string;
  description: string;
  triggers: AddressBarTrigger[];
  onQuery: (context: AddressBarQueryContext) => Promise<AddressBarSuggestion[]>;
  onSelect?: (suggestion: AddressBarSuggestion) => Promise<unknown>;
}

interface ToolShortcut {
  trigger: string;
  tool: string;
  description: string;
  examples?: string[];
  argParser?: (query: string) => Record<string, unknown>;
  useLLMParser?: boolean;
  llmParserPrompt?: string;
}

interface ToolShortcutsOptions {
  shortcuts: ToolShortcut[];
  resultHandler: 'inline' | 'popup' | 'navigate' | 'clipboard';
}

interface SiteProviderOptions {
  origin: string;
  name: string;
  description: string;
  patterns: string[];
  icon?: string;
  endpoint?: string;
  onQuery?: (query: string) => Promise<AddressBarSuggestion[]>;
}

// Store registered callbacks for AI providers
const providerCallbacks = new Map<string, {
  onQuery: (context: AddressBarQueryContext) => Promise<AddressBarSuggestion[]>;
  onSelect?: (suggestion: AddressBarSuggestion) => Promise<unknown>;
}>();

function createAddressBarAPI() {
  // Listen for query requests from background
  window.addEventListener('message', async (event: MessageEvent) => {
    if (event.source !== window) return;
    
    const data = event.data as {
      channel?: string;
      addressBarQuery?: {
        id: string;
        providerId: string;
        context: AddressBarQueryContext;
      };
    };
    
    if (data?.channel !== 'harbor_web_agent' || !data.addressBarQuery) return;
    
    const { id, providerId, context } = data.addressBarQuery;
    const callbacks = providerCallbacks.get(providerId);
    
    if (callbacks) {
      try {
        const suggestions = await callbacks.onQuery(context);
        window.postMessage({
          channel: 'harbor_web_agent',
          addressBarResponse: { id, suggestions },
        }, '*');
      } catch (error) {
        window.postMessage({
          channel: 'harbor_web_agent',
          addressBarResponse: {
            id,
            error: error instanceof Error ? error.message : 'Query failed',
          },
        }, '*');
      }
    }
  });

  return Object.freeze({
    async canProvide(): Promise<'readily' | 'no'> {
      return sendRequest<'readily' | 'no'>('agent.addressBar.canProvide');
    },

    async registerProvider(options: AddressBarProviderOptions): Promise<{ providerId: string }> {
      // Store callbacks locally
      providerCallbacks.set(options.id, {
        onQuery: options.onQuery,
        onSelect: options.onSelect,
      });

      // Register with background (without the function callbacks)
      return sendRequest<{ providerId: string }>('agent.addressBar.registerProvider', {
        id: options.id,
        name: options.name,
        description: options.description,
        triggers: options.triggers,
      });
    },

    async registerToolShortcuts(options: ToolShortcutsOptions): Promise<{ registered: string[] }> {
      // Convert argParser functions to string identifiers for serialization
      const serializedShortcuts = options.shortcuts.map((s) => ({
        trigger: s.trigger,
        tool: s.tool,
        description: s.description,
        examples: s.examples,
        // Store the parser type, not the function
        argParser: s.argParser ? 'custom' : undefined,
        useLLMParser: s.useLLMParser,
        llmParserPrompt: s.llmParserPrompt,
      }));

      // Store custom parsers locally if needed
      for (const shortcut of options.shortcuts) {
        if (shortcut.argParser) {
          const key = `argParser-${shortcut.trigger}`;
          (window as unknown as Record<string, unknown>)[key] = shortcut.argParser;
        }
      }

      return sendRequest<{ registered: string[] }>('agent.addressBar.registerToolShortcuts', {
        shortcuts: serializedShortcuts,
        resultHandler: options.resultHandler,
      });
    },

    async registerSiteProvider(options: SiteProviderOptions): Promise<{ providerId: string }> {
      // Verify origin matches
      if (options.origin !== window.location.origin) {
        throw new Error('Origin must match current page origin');
      }

      // Store onQuery callback if provided
      if (options.onQuery) {
        const providerId = `site-${new URL(options.origin).hostname}`;
        providerCallbacks.set(providerId, {
          onQuery: async (ctx) => options.onQuery!(ctx.query),
        });
      }

      return sendRequest<{ providerId: string }>('agent.addressBar.registerSiteProvider', {
        origin: options.origin,
        name: options.name,
        description: options.description,
        patterns: options.patterns,
        icon: options.icon,
        endpoint: options.endpoint,
      });
    },

    async discover(): Promise<Array<{
      origin: string;
      name: string;
      description?: string;
      endpoint: string;
      patterns: string[];
      icon?: string;
    }>> {
      // Discover <link rel="addressbar-provider"> elements
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel="addressbar-provider"]');
      const providers: Array<{
        origin: string;
        name: string;
        description?: string;
        endpoint: string;
        patterns: string[];
        icon?: string;
      }> = [];

      for (const link of links) {
        const href = link.getAttribute('href');
        const title = link.getAttribute('title');
        if (href && title) {
          providers.push({
            origin: window.location.origin,
            name: title,
            description: link.dataset.description,
            endpoint: new URL(href, window.location.href).toString(),
            patterns: link.dataset.patterns?.split(',').map((p) => p.trim()) || [],
            icon: link.dataset.icon,
          });
        }
      }

      return providers;
    },

    async listProviders(): Promise<Array<{
      id: string;
      name: string;
      description: string;
      triggers: AddressBarTrigger[];
      isDefault: boolean;
      origin?: string;
      type: 'ai' | 'tool' | 'site';
    }>> {
      return sendRequest('agent.addressBar.listProviders');
    },

    async unregisterProvider(providerId: string): Promise<void> {
      providerCallbacks.delete(providerId);
      return sendRequest('agent.addressBar.unregisterProvider', { providerId });
    },

    async setDefaultProvider(providerId: string): Promise<void> {
      return sendRequest('agent.addressBar.setDefaultProvider', { providerId });
    },

    async getDefaultProvider(): Promise<string | null> {
      return sendRequest<string | null>('agent.addressBar.getDefaultProvider');
    },
  });
}

// =============================================================================
// window.harbor Implementation (Guaranteed namespace)
// =============================================================================

// Detect Chrome AI before creating harborApi so we can freeze with correct value
const _existingAi = (window as { ai?: unknown }).ai;
const _chromeAiDetected = _existingAi !== undefined && _existingAi !== null;

const harborApi = Object.freeze({
  ai: aiApi,
  agent: agentApi,
  version: '1.0.0',
  chromeAiDetected: _chromeAiDetected,
});

// =============================================================================
// Register Global APIs
// =============================================================================

/**
 * Safely define a property on window, avoiding conflicts with existing properties.
 * Uses configurable: true to allow other scripts to work with these properties.
 */
function safeDefineProperty(
  name: string,
  value: unknown,
  options: { enumerable?: boolean } = {},
): boolean {
  try {
    // Check if property already exists and is non-configurable
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (descriptor && !descriptor.configurable) {
      // Property exists and cannot be redefined - skip to avoid errors
      console.debug(`[Harbor] Skipping ${name} - already defined and non-configurable`);
      return false;
    }

    Object.defineProperty(window, name, {
      value,
      writable: false,
      configurable: true, // Allow other scripts to reconfigure if needed
      enumerable: options.enumerable ?? true,
    });
    return true;
  } catch (error) {
    console.debug(`[Harbor] Could not define window.${name}:`, error);
    return false;
  }
}

try {
  // Register window.harbor first (guaranteed namespace that's unlikely to conflict)
  safeDefineProperty('harbor', harborApi);

  // Register window.ai (may coexist with or override Chrome AI)
  // Skip if Chrome AI is present to avoid breaking Chrome's built-in functionality
  if (!_chromeAiDetected) {
    safeDefineProperty('ai', aiApi);
  } else {
    console.debug('[Harbor] Chrome AI detected, window.ai not overridden. Use window.harbor.ai instead.');
  }

  // Register window.agent (skip if already defined to avoid conflicts)
  const existingAgent = (window as { agent?: unknown }).agent;
  if (existingAgent === undefined) {
    safeDefineProperty('agent', agentApi);
  } else {
    console.debug('[Harbor] window.agent already defined, skipping. Use window.harbor.agent instead.');
  }

  // Dispatch ready event
  window.dispatchEvent(
    new CustomEvent('harbor-provider-ready', {
      detail: {
        providers: {
          harbor: true,
          chrome: _chromeAiDetected,
        },
      },
    }),
  );

  // Also dispatch agent-ready for spec compliance
  window.dispatchEvent(
    new CustomEvent('agent-ready', {
      detail: {
        providers: {
          harbor: true,
          chrome: _chromeAiDetected,
        },
      },
    }),
  );
} catch (error) {
  console.warn('[Harbor] Failed to register Web Agent API', error);
}
