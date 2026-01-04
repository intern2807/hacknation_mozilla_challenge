/**
 * Harbor Provider - Shared API Core
 * 
 * This module contains the shared implementation of window.ai and window.agent APIs.
 * It uses a Transport interface for communication, allowing the same logic to work
 * in both extension pages and injected web page contexts.
 */

import type { Transport } from './transport';
import { generateRequestId } from './transport';
import type {
  ApiError,
  PermissionScope,
  PermissionGrantResult,
  PermissionStatus,
  ToolDescriptor,
  ActiveTabReadability,
  TextSessionOptions,
  StreamToken,
  AgentRunOptions,
  RunEvent,
} from './types';

// =============================================================================
// Error Helpers
// =============================================================================

export function createApiError(
  code: ApiError['code'], 
  message: string, 
  details?: unknown
): Error & { code: string; details?: unknown } {
  const error = new Error(message) as Error & { code: string; details?: unknown };
  error.code = code;
  error.details = details;
  return error;
}

// =============================================================================
// Chrome AI API Compatibility Types
// =============================================================================

export type AICapabilityAvailability = 'readily' | 'after-download' | 'no';

export interface AILanguageModelCapabilities {
  available: AICapabilityAvailability;
  defaultTopK?: number;
  maxTopK?: number;
  defaultTemperature?: number;
}

export interface AILanguageModelCreateOptions {
  systemPrompt?: string;
  initialPrompts?: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

// =============================================================================
// Session Types
// =============================================================================

export interface AITextSession {
  sessionId: string;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<StreamToken>;
  destroy(): Promise<void>;
  clone(): Promise<AITextSession>;
}

interface TextSessionImpl {
  sessionId: string;
  destroyed: boolean;
  options?: TextSessionOptions;
}

// =============================================================================
// AI API Factory
// =============================================================================

export interface AIApi {
  canCreateTextSession(): Promise<AICapabilityAvailability>;
  createTextSession(options?: TextSessionOptions): Promise<AITextSession>;
  languageModel: {
    capabilities(): Promise<AILanguageModelCapabilities>;
    create(options?: AILanguageModelCreateOptions): Promise<AITextSession>;
  };
}

/**
 * Create the window.ai API implementation using the provided transport.
 */
export function createAiApi(transport: Transport): AIApi {
  
  /**
   * Automatically request model:prompt permission if not already granted.
   * This enables Chrome-like API usage without explicit permission calls.
   */
  async function ensureModelPermission(): Promise<boolean> {
    // First check if we already have permission
    const status = await transport.sendRequest<{ scopes: Record<string, string> }>('list_permissions');
    const promptGrant = status.scopes['model:prompt'];
    
    if (promptGrant === 'granted-once' || promptGrant === 'granted-always') {
      return true;
    }
    
    // Auto-request permission with a default reason
    const result = await transport.sendRequest<PermissionGrantResult>('request_permissions', {
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
        
        const promptResult = await transport.sendRequest<{ result: string }>('text_session_prompt', {
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
        
        const requestId = transport.sendMessage('text_session_prompt_streaming', {
          sessionId: session.sessionId,
          input,
          streaming: true,
        });
        
        return {
          [Symbol.asyncIterator](): AsyncIterator<StreamToken> {
            const queue: StreamToken[] = [];
            let resolveNext: ((value: IteratorResult<StreamToken>) => void) | null = null;
            let done = false;
            
            transport.addStreamListener(requestId, {
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
        await transport.sendRequest('text_session_destroy', { sessionId: session.sessionId });
      },
      
      async clone(): Promise<AITextSession> {
        if (session.destroyed) {
          throw createApiError('ERR_SESSION_NOT_FOUND', 'Session has been destroyed');
        }
        
        // Create a new session with the same options
        const result = await transport.sendRequest<{ sessionId: string }>('create_text_session', { 
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

  return {
    /**
     * Check if a text session can be created.
     * Chrome Compatibility: Returns 'readily' if available, 'no' otherwise.
     */
    async canCreateTextSession(): Promise<AICapabilityAvailability> {
      const connected = await transport.isConnected();
      return connected ? 'readily' : 'no';
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
      
      const result = await transport.sendRequest<{ sessionId: string }>('create_text_session', { options });
      
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
        const connected = await transport.isConnected();
        if (connected) {
          return {
            available: 'readily',
            defaultTemperature: 1.0,
            defaultTopK: 40,
            maxTopK: 100,
          };
        }
        return { available: 'no' };
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
        
        const result = await transport.sendRequest<{ sessionId: string }>('create_text_session', { 
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
}

// =============================================================================
// Agent API Factory
// =============================================================================

export interface AgentApi {
  requestPermissions(options: {
    scopes: PermissionScope[];
    reason?: string;
    tools?: string[];
  }): Promise<PermissionGrantResult>;
  
  permissions: {
    list(): Promise<PermissionStatus>;
  };
  
  tools: {
    list(): Promise<ToolDescriptor[]>;
    call(options: { tool: string; args: Record<string, unknown> }): Promise<unknown>;
  };
  
  browser: {
    activeTab: {
      readability(): Promise<ActiveTabReadability>;
    };
  };
  
  run(options: AgentRunOptions): AsyncIterable<RunEvent>;
}

/**
 * Create the window.agent API implementation using the provided transport.
 */
export function createAgentApi(transport: Transport): AgentApi {
  return {
    /**
     * Request permission scopes from the user.
     */
    async requestPermissions(options: {
      scopes: PermissionScope[];
      reason?: string;
      tools?: string[];
    }): Promise<PermissionGrantResult> {
      return transport.sendRequest<PermissionGrantResult>('request_permissions', options, 120000);
    },
    
    /**
     * Permission management namespace.
     */
    permissions: {
      /**
       * List current permission status for this origin.
       */
      async list(): Promise<PermissionStatus> {
        return transport.sendRequest<PermissionStatus>('list_permissions');
      },
    },
    
    /**
     * MCP tools namespace.
     */
    tools: {
      /**
       * List available tools from connected MCP servers.
       */
      async list(): Promise<ToolDescriptor[]> {
        const result = await transport.sendRequest<{ tools: ToolDescriptor[] }>('tools_list');
        return result.tools;
      },
      
      /**
       * Call a specific tool.
       */
      async call(options: { tool: string; args: Record<string, unknown> }): Promise<unknown> {
        const result = await transport.sendRequest<{ success: boolean; result?: unknown; error?: ApiError }>(
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
         */
        async readability(): Promise<ActiveTabReadability> {
          return transport.sendRequest<ActiveTabReadability>('active_tab_read', undefined, 30000);
        },
      },
    },
    
    /**
     * Run an autonomous agent task with access to tools.
     */
    run(options: AgentRunOptions): AsyncIterable<RunEvent> {
      // Set up the event queue and listener BEFORE sending the message
      // to avoid race conditions where events arrive before we're listening
      const queue: RunEvent[] = [];
      let resolveNext: ((value: IteratorResult<RunEvent>) => void) | null = null;
      let done = false;
      
      // Generate requestId first so we can register the listener before sending
      const requestId = generateRequestId();
      
      transport.addStreamListener(requestId, {
        onToken() {}, // Not used for agent run
            onEvent(event: RunEvent) {
              if (event.type === 'final' || event.type === 'error') {
                done = true;
              }
          
          if (resolveNext) {
            resolveNext({ done: false, value: event });
            resolveNext = null;
          } else {
            queue.push(event);
          }
        },
      });
      
      // NOW send the message (listener is already registered)
      transport.sendMessageWithId(requestId, 'agent_run', {
        task: options.task,
        tools: options.tools,
        requireCitations: options.requireCitations,
        maxToolCalls: options.maxToolCalls,
      });
      
      // Handle abort signal
      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          transport.sendMessage('agent_run_abort', { requestId });
        });
      }
      
      return {
        [Symbol.asyncIterator](): AsyncIterator<RunEvent> {
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
}

