/**
 * Web Agent API - Injected Script
 *
 * This script is injected into web pages to expose:
 * - window.ai - Text generation API (Chrome Prompt API compatible)
 * - window.agent - Tools, browser access, and autonomous agent capabilities
 * - window.harbor - Guaranteed namespace with direct access to Harbor APIs
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

const harborApi = Object.freeze({
  ai: aiApi,
  agent: agentApi,
  version: '1.0.0',
  chromeAiDetected: false, // Will be set after detection
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
  // Check if Chrome AI is already present
  const existingAi = (window as { ai?: unknown }).ai;
  const chromeAiDetected = existingAi !== undefined && existingAi !== null;

  // Update harbor with detection result
  Object.defineProperty(harborApi, 'chromeAiDetected', {
    value: chromeAiDetected,
    writable: false,
  });

  // Register window.harbor first (guaranteed namespace that's unlikely to conflict)
  safeDefineProperty('harbor', harborApi);

  // Register window.ai (may coexist with or override Chrome AI)
  // Skip if Chrome AI is present to avoid breaking Chrome's built-in functionality
  if (!chromeAiDetected) {
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
          chrome: chromeAiDetected,
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
          chrome: chromeAiDetected,
        },
      },
    }),
  );
} catch (error) {
  console.warn('[Harbor] Failed to register Web Agent API', error);
}
