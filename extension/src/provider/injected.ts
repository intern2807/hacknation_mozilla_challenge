/**
 * Harbor JS AI Provider - Injected Script
 * 
 * This script runs in the page context and creates the window.ai and window.agent APIs.
 * It communicates with the content script via window.postMessage.
 */

import type {
  ApiError,
  PermissionScope,
  PermissionGrant,
  PermissionGrantResult,
  PermissionStatus,
  ToolDescriptor,
  ActiveTabReadability,
  TextSessionOptions,
  StreamToken,
  AgentRunOptions,
  RunEvent,
  Citation,
  ProviderMessage,
  PROVIDER_MESSAGE_NAMESPACE,
} from './types';

// Use a unique namespace for our messages
const NAMESPACE = 'harbor-provider';

// Request ID counter
let requestIdCounter = 0;

// Pending requests waiting for responses
const pendingRequests = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

// Stream listeners for streaming responses
const streamListeners = new Map<string, {
  onToken: (token: StreamToken) => void;
  onEvent: (event: RunEvent) => void;
}>();

// =============================================================================
// Message Handling
// =============================================================================

function generateRequestId(): string {
  return `${Date.now()}-${++requestIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function sendMessage(type: string, payload?: unknown): string {
  const requestId = generateRequestId();
  const message: ProviderMessage = {
    namespace: NAMESPACE as typeof PROVIDER_MESSAGE_NAMESPACE,
    type: type as ProviderMessage['type'],
    requestId,
    payload,
  };
  
  window.postMessage(message, '*');
  return requestId;
}

function sendRequest<T>(type: string, payload?: unknown, timeoutMs = 30000): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = sendMessage(type, payload);
    
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(createApiError('ERR_TIMEOUT', 'Request timed out'));
    }, timeoutMs);
    
    pendingRequests.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });
  });
}

// Listen for responses from content script
window.addEventListener('message', (event) => {
  // Only accept messages from same window
  if (event.source !== window) return;
  
  const data = event.data;
  if (!data || data.namespace !== NAMESPACE) return;
  
  // Only handle response types - ignore our own outgoing requests
  // Response types end with _result, or are error/stream types
  const isResponse = data.type.endsWith('_result') || 
                     data.type === 'error' ||
                     data.type === 'pong' ||
                     data.type.startsWith('text_session_stream_') ||
                     data.type === 'agent_run_event';
  
  if (!isResponse) {
    // This is an outgoing request we sent - ignore it
    return;
  }
  
  console.log('[Harbor Injected] Received response:', data.type, data.requestId, data.payload);
  
  // Check if this is a response to a pending request
  const pending = pendingRequests.get(data.requestId);
  if (pending) {
    // Ignore responses with undefined payload (likely from stale content scripts)
    // The real response should have a payload
    if (data.payload === undefined && data.type !== 'error') {
      console.log('[Harbor Injected] Ignoring response with undefined payload (likely stale):', data.requestId);
      return;
    }
    
    clearTimeout(pending.timeout);
    pendingRequests.delete(data.requestId);
    
    console.log('[Harbor Injected] Resolving pending request:', data.requestId, 'with payload:', data.payload);
    
    if (data.type === 'error') {
      pending.reject(createApiError(
        data.payload?.error?.code || 'ERR_INTERNAL',
        data.payload?.error?.message || 'Unknown error',
        data.payload?.error?.details
      ));
    } else {
      pending.resolve(data.payload);
    }
    return;
  } else {
    console.log('[Harbor Injected] No pending request found for:', data.requestId);
  }
  
  // Check for streaming events
  const streamRequestId = data.payload?.requestId;
  const listener = streamListeners.get(streamRequestId);
  if (listener) {
    if (data.type === 'text_session_stream_token') {
      listener.onToken(data.payload.token);
    } else if (data.type === 'text_session_stream_done') {
      listener.onToken({ type: 'done' });
      streamListeners.delete(streamRequestId);
    } else if (data.type === 'agent_run_event') {
      listener.onEvent(data.payload.event);
      if (data.payload.event.type === 'final' || data.payload.event.type === 'error') {
        streamListeners.delete(streamRequestId);
      }
    }
  }
});

// =============================================================================
// Error Helpers
// =============================================================================

function createApiError(code: ApiError['code'], message: string, details?: unknown): Error & { code: string; details?: unknown } {
  const error = new Error(message) as Error & { code: string; details?: unknown };
  error.code = code;
  error.details = details;
  return error;
}

// =============================================================================
// Chrome AI API Compatibility Types
// =============================================================================

type AICapabilityAvailability = 'readily' | 'after-download' | 'no';

interface AITextSession {
  sessionId: string;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<StreamToken>;
  destroy(): Promise<void>;
  clone(): Promise<AITextSession>;
}

interface AILanguageModelCapabilities {
  available: AICapabilityAvailability;
  defaultTopK?: number;
  maxTopK?: number;
  defaultTemperature?: number;
}

interface AILanguageModelCreateOptions {
  systemPrompt?: string;
  initialPrompts?: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

// =============================================================================
// window.ai API Implementation (with Chrome Compatibility)
// =============================================================================

interface TextSessionImpl {
  sessionId: string;
  destroyed: boolean;
  options?: TextSessionOptions;
}

/**
 * Automatically request model:prompt permission if not already granted.
 * This enables Chrome-like API usage without explicit permission calls.
 */
async function ensureModelPermission(): Promise<boolean> {
  // First check if we already have permission
  const status = await sendRequest<{ scopes: Record<string, string> }>('list_permissions');
  const promptGrant = status.scopes['model:prompt'];
  
  if (promptGrant === 'granted-once' || promptGrant === 'granted-always') {
    return true;
  }
  
  // Auto-request permission with a default reason
  const result = await sendRequest<PermissionGrantResult>('request_permissions', {
    scopes: ['model:prompt'] as PermissionScope[],
    reason: 'This page wants to use AI text generation',
  }, 120000); // 2 min for user interaction
  
  return result.granted;
}

/**
 * Create an AI text session object with the session implementation.
 */
function createSessionObject(session: TextSessionImpl): AITextSession {
  return {
    sessionId: session.sessionId,
    
    async prompt(input: string): Promise<string> {
      if (session.destroyed) {
        throw createApiError('ERR_SESSION_NOT_FOUND', 'Session has been destroyed');
      }
      
      const promptResult = await sendRequest<{ result: string }>('text_session_prompt', {
        sessionId: session.sessionId,
        input,
        streaming: false,
      }, 180000); // 3 minute timeout for LLM
      
      return promptResult.result;
    },
    
    promptStreaming(input: string): AsyncIterable<StreamToken> {
      if (session.destroyed) {
        throw createApiError('ERR_SESSION_NOT_FOUND', 'Session has been destroyed');
      }
      
      const requestId = sendMessage('text_session_prompt_streaming', {
        sessionId: session.sessionId,
        input,
        streaming: true,
      });
      
      return {
        [Symbol.asyncIterator](): AsyncIterator<StreamToken> {
          const queue: StreamToken[] = [];
          let resolveNext: ((value: IteratorResult<StreamToken>) => void) | null = null;
          let done = false;
          
          streamListeners.set(requestId, {
            onToken(token: StreamToken) {
              if (token.type === 'done' || token.type === 'error') {
                done = true;
              }
              
              if (resolveNext) {
                if (token.type === 'done') {
                  resolveNext({ done: true, value: undefined as unknown as StreamToken });
                } else {
                  resolveNext({ done: false, value: token });
                }
                resolveNext = null;
              } else {
                queue.push(token);
              }
            },
            onEvent() {}, // Not used for text sessions
          });
          
          return {
            async next(): Promise<IteratorResult<StreamToken>> {
              if (queue.length > 0) {
                const token = queue.shift()!;
                if (token.type === 'done') {
                  return { done: true, value: undefined as unknown as StreamToken };
                }
                return { done: false, value: token };
              }
              
              if (done) {
                return { done: true, value: undefined as unknown as StreamToken };
              }
              
              return new Promise((resolve) => {
                resolveNext = resolve;
              });
            },
          };
        },
      };
    },
    
    async destroy(): Promise<void> {
      if (session.destroyed) return;
      
      session.destroyed = true;
      await sendRequest('text_session_destroy', { sessionId: session.sessionId });
    },
    
    async clone(): Promise<AITextSession> {
      if (session.destroyed) {
        throw createApiError('ERR_SESSION_NOT_FOUND', 'Session has been destroyed');
      }
      
      // Create a new session with the same options
      const result = await sendRequest<{ sessionId: string }>('create_text_session', { 
        options: session.options 
      });
      
      const newSession: TextSessionImpl = {
        sessionId: result.sessionId,
        destroyed: false,
        options: session.options,
      };
      
      return createSessionObject(newSession);
    },
  };
}

const aiApi = {
  /**
   * Check if a text session can be created.
   * Chrome Compatibility: Returns 'readily' if available, 'no' otherwise.
   */
  async canCreateTextSession(): Promise<AICapabilityAvailability> {
    try {
      // Ping to check if bridge is connected
      await sendRequest('ping', undefined, 5000);
      return 'readily';
    } catch {
      return 'no';
    }
  },
  
  /**
   * Create a new text generation session.
   * Chrome Compatibility: Automatically requests permission if not granted.
   */
  async createTextSession(options?: TextSessionOptions): Promise<AITextSession> {
    // Auto-request permission if needed (Chrome compatibility)
    const hasPermission = await ensureModelPermission();
    if (!hasPermission) {
      throw createApiError('ERR_PERMISSION_DENIED', 'User denied AI permission');
    }
    
    const result = await sendRequest<{ sessionId: string }>('create_text_session', { options });
    
    const session: TextSessionImpl = {
      sessionId: result.sessionId,
      destroyed: false,
      options,
    };
    
    return createSessionObject(session);
  },
  
  /**
   * Chrome Prompt API compatible namespace: window.ai.languageModel
   * Provides the newer Chrome AI API surface.
   */
  languageModel: {
    /**
     * Check capabilities of the language model.
     * Chrome Compatibility: Returns capability info.
     */
    async capabilities(): Promise<AILanguageModelCapabilities> {
      try {
        await sendRequest('ping', undefined, 5000);
        return {
          available: 'readily',
          defaultTemperature: 1.0,
          defaultTopK: 40,
          maxTopK: 100,
        };
      } catch {
        return { available: 'no' };
      }
    },
    
    /**
     * Create a new language model session.
     * Chrome Compatibility: Maps to createTextSession with auto-permission.
     */
    async create(options?: AILanguageModelCreateOptions): Promise<AITextSession> {
      // Auto-request permission if needed
      const hasPermission = await ensureModelPermission();
      if (!hasPermission) {
        throw createApiError('ERR_PERMISSION_DENIED', 'User denied AI permission');
      }
      
      // Map Chrome options to Harbor options
      const harborOptions: TextSessionOptions = {
        systemPrompt: options?.systemPrompt,
        temperature: options?.temperature,
      };
      
      const result = await sendRequest<{ sessionId: string }>('create_text_session', { 
        options: harborOptions 
      });
      
      const session: TextSessionImpl = {
        sessionId: result.sessionId,
        destroyed: false,
        options: harborOptions,
      };
      
      const sessionObj = createSessionObject(session);
      
      // If initial prompts provided, replay them
      if (options?.initialPrompts && options.initialPrompts.length > 0) {
        for (const msg of options.initialPrompts) {
          if (msg.role === 'user') {
            await sessionObj.prompt(msg.content);
          }
        }
      }
      
      return sessionObj;
    },
  },
};

// =============================================================================
// window.agent API Implementation
// =============================================================================

const agentApi = {
  /**
   * Request permission scopes from the user.
   * @param options.scopes - Permission scopes to request
   * @param options.reason - Optional reason to show the user
   * @param options.tools - Optional specific tools needed (for mcp:tools.call)
   */
  async requestPermissions(options: {
    scopes: PermissionScope[];
    reason?: string;
    tools?: string[];
  }): Promise<PermissionGrantResult> {
    return sendRequest<PermissionGrantResult>('request_permissions', options, 120000); // 2 min for user interaction
  },
  
  /**
   * Permission management namespace.
   */
  permissions: {
    /**
     * List current permission status for this origin.
     */
    async list(): Promise<PermissionStatus> {
      return sendRequest<PermissionStatus>('list_permissions');
    },
  },
  
  /**
   * MCP tools namespace.
   */
  tools: {
    /**
     * List available tools from connected MCP servers.
     * Requires "mcp:tools.list" permission scope.
     */
    async list(): Promise<ToolDescriptor[]> {
      const result = await sendRequest<{ tools: ToolDescriptor[] }>('tools_list');
      return result.tools;
    },
    
    /**
     * Call a specific tool.
     * Requires "mcp:tools.call" permission scope.
     */
    async call(options: { tool: string; args: Record<string, unknown> }): Promise<unknown> {
      const result = await sendRequest<{ success: boolean; result?: unknown; error?: ApiError }>(
        'tools_call',
        options,
        60000 // 1 minute timeout for tool calls
      );
      
      if (!result.success && result.error) {
        throw createApiError(result.error.code, result.error.message, result.error.details);
      }
      
      return result.result;
    },
  },
  
  /**
   * Browser API namespace.
   */
  browser: {
    activeTab: {
      /**
       * Extract readable content from the active tab.
       * Requires "browser:activeTab.read" permission scope.
       * May require user gesture.
       */
      async readability(): Promise<ActiveTabReadability> {
        return sendRequest<ActiveTabReadability>('active_tab_read', undefined, 30000);
      },
    },
  },
  
  /**
   * Run an autonomous agent task.
   * Requires "model:tools" permission plus any tool/browser permissions needed.
   */
  run(options: AgentRunOptions): AsyncIterable<RunEvent> {
    const requestId = sendMessage('agent_run', {
      task: options.task,
      tools: options.tools,
      requireCitations: options.requireCitations,
      maxToolCalls: options.maxToolCalls,
    });
    
    // Handle abort signal
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        sendMessage('agent_run_abort', { requestId });
      });
    }
    
    return {
      [Symbol.asyncIterator](): AsyncIterator<RunEvent> {
        const queue: RunEvent[] = [];
        let resolveNext: ((value: IteratorResult<RunEvent>) => void) | null = null;
        let done = false;
        
        streamListeners.set(requestId, {
          onToken() {}, // Not used for agent run
          onEvent(event: RunEvent) {
            if (event.type === 'final' || event.type === 'error') {
              done = true;
            }
            
            if (resolveNext) {
              resolveNext({ done: false, value: event });
              resolveNext = null;
              
              // If this was the final event, next call will return done
            } else {
              queue.push(event);
            }
          },
        });
        
        return {
          async next(): Promise<IteratorResult<RunEvent>> {
            if (queue.length > 0) {
              const event = queue.shift()!;
              return { done: false, value: event };
            }
            
            if (done && queue.length === 0) {
              return { done: true, value: undefined as unknown as RunEvent };
            }
            
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
        };
      },
    };
  },
};

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

console.log('[Harbor] JS AI Provider v1 loaded (Chrome-compatible)');

