/**
 * LLM Provider Types
 * 
 * Unified type definitions for LLM providers including native browser AI
 * (Firefox ML, Chrome AI) and bridge providers (Ollama, OpenAI, etc.)
 */

// =============================================================================
// Provider Runtime Types
// =============================================================================

/** Which runtime provides the LLM capability */
export type ProviderRuntime = 'firefox' | 'chrome' | 'bridge';

/** Provider type identifiers */
export type ProviderType = 
  | 'firefox-wllama'      // Firefox 142+ wllama (llama.cpp via WASM)
  | 'firefox-transformers' // Firefox 134+ Transformers.js
  | 'chrome'              // Chrome built-in AI
  | 'ollama'              // Ollama local server
  | 'llamafile'           // llamafile local server
  | 'openai'              // OpenAI API
  | 'anthropic';          // Anthropic API

// =============================================================================
// Provider Info Types
// =============================================================================

/** Extended LLM provider info with native provider fields */
export interface LLMProviderInfo {
  /** Unique instance ID (e.g., 'openai-work', 'firefox-wllama') */
  id: string;
  
  /** Provider type */
  type: ProviderType | string;
  
  /** User-defined or native display name */
  name: string;
  
  /** Whether the provider is currently accessible */
  available: boolean;
  
  /** Custom API endpoint (bridge providers only) */
  baseUrl?: string;
  
  /** Available model IDs */
  models?: string[];
  
  /** Whether this is the global default provider */
  isDefault: boolean;
  
  /** Whether this is the default for its provider type */
  isTypeDefault?: boolean;
  
  /** Whether it supports tool/function calling */
  supportsTools?: boolean;
  
  /** Whether it supports streaming */
  supportsStreaming?: boolean;
  
  // Native provider fields
  
  /** True for browser-native providers (Firefox ML, Chrome AI) */
  isNative?: boolean;
  
  /** Which runtime provides this */
  runtime?: ProviderRuntime;
  
  /** True if model needs to be downloaded first */
  downloadRequired?: boolean;
  
  /** Download progress 0-100 if currently downloading */
  downloadProgress?: number;
}

/** Active LLM configuration */
export interface ActiveLLMConfig {
  /** Active provider instance ID */
  provider: string | null;
  /** Active model ID */
  model: string | null;
}

// =============================================================================
// Runtime Capabilities Types
// =============================================================================

/** Firefox ML capabilities */
export interface FirefoxCapabilities {
  /** Whether Firefox ML is available at all */
  available: boolean;
  
  /** Firefox 142+ LLM support via wllama */
  hasWllama: boolean;
  
  /** Firefox 134+ embeddings via Transformers.js */
  hasTransformers: boolean;
  
  /** Whether tool calling is supported */
  supportsTools: boolean;
  
  /** Available model IDs */
  models: string[];
}

/** Chrome AI capabilities */
export interface ChromeCapabilities {
  /** Whether Chrome AI is available */
  available: boolean;
  
  /** Whether tool calling is supported */
  supportsTools: boolean;
}

/** Harbor bridge capabilities */
export interface HarborCapabilities {
  /** Whether Harbor is available */
  available: boolean;
  
  /** Whether the native bridge is connected */
  bridgeConnected: boolean;
  
  /** Connected bridge provider IDs */
  providers: string[];
}

/** Combined runtime capabilities */
export interface RuntimeCapabilities {
  firefox: FirefoxCapabilities | null;
  chrome: ChromeCapabilities | null;
  harbor: HarborCapabilities;
}

// =============================================================================
// Message Types
// =============================================================================

/** Chat message role */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** Chat message */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

/** Tool definition for LLM */
export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/** Chat request options */
export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  tools?: ToolDefinition[];
  stream?: boolean;
}

/** Stream token event */
export interface StreamToken {
  type: 'token' | 'done' | 'error';
  token?: string;
  finishReason?: string;
  error?: { code: string; message: string };
}

/** Tool call from LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Chat response */
export interface ChatResponse {
  content: string;
  finishReason?: string;
  toolCalls?: ToolCall[];
  model?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// =============================================================================
// Provider Interface
// =============================================================================

/** Base interface for all LLM providers */
export interface LLMProvider {
  /** Unique provider ID */
  readonly id: string;
  
  /** Provider type */
  readonly type: ProviderType | string;
  
  /** Human-readable name */
  readonly name: string;
  
  /** Runtime that provides this */
  readonly runtime: ProviderRuntime;
  
  /** Whether this is a native browser provider */
  readonly isNative: boolean;
  
  /** Check if provider is currently available */
  isAvailable(): Promise<boolean>;
  
  /** Get provider info */
  getInfo(): Promise<LLMProviderInfo>;
  
  /** List available models */
  listModels(): Promise<string[]>;
  
  /** Whether provider supports tool calling */
  supportsTools(): boolean;
  
  /** Whether provider supports streaming */
  supportsStreaming(): boolean;
  
  /** Send chat messages and get response */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  
  /** Send chat messages with streaming response */
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamToken>;
}

// =============================================================================
// Provider Factory Types
// =============================================================================

/** Provider configuration */
export interface ProviderConfig {
  /** API key for cloud providers */
  apiKey?: string;
  
  /** Base URL override */
  baseUrl?: string;
  
  /** Default model */
  defaultModel?: string;
  
  /** Request timeout in ms */
  timeout?: number;
}

/** Provider factory function */
export type ProviderFactory = (config?: ProviderConfig) => Promise<LLMProvider | null>;
