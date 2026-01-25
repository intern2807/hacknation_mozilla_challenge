/**
 * Web Agent API Type Definitions
 *
 * Types matching the Web IDL specification for window.ai and window.agent APIs.
 * See: docs/JS_AI_PROVIDER_API.md and spec/explainer.md
 */

// =============================================================================
// Error Types
// =============================================================================

export type ApiErrorCode =
  | 'ERR_NOT_INSTALLED'
  | 'ERR_PERMISSION_DENIED'
  | 'ERR_USER_GESTURE_REQUIRED'
  | 'ERR_SCOPE_REQUIRED'
  | 'ERR_TOOL_NOT_ALLOWED'
  | 'ERR_TOOL_FAILED'
  | 'ERR_MODEL_FAILED'
  | 'ERR_NOT_IMPLEMENTED'
  | 'ERR_SESSION_NOT_FOUND'
  | 'ERR_TIMEOUT'
  | 'ERR_INTERNAL';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export class WebAgentError extends Error {
  code: ApiErrorCode;
  details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'WebAgentError';
    this.code = code;
    this.details = details;
  }

  toJSON(): ApiError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// =============================================================================
// Permission Types
// =============================================================================

export type PermissionScope =
  | 'model:prompt'
  | 'model:tools'
  | 'model:list'
  | 'mcp:tools.list'
  | 'mcp:tools.call'
  | 'mcp:servers.register'
  | 'browser:activeTab.read'
  | 'browser:activeTab.interact'  // click, fill, scroll (same-tab only)
  | 'browser:activeTab.screenshot' // capture screenshots
  | 'chat:open'
  | 'web:fetch'
  | 'addressBar:suggest'
  | 'addressBar:context'
  | 'addressBar:history'
  | 'addressBar:execute';

export type PermissionGrant =
  | 'granted-once'
  | 'granted-always'
  | 'denied'
  | 'not-granted';

export interface PermissionGrantResult {
  granted: boolean;
  scopes: Record<PermissionScope, PermissionGrant>;
  allowedTools?: string[];
}

export interface PermissionStatus {
  origin: string;
  scopes: Record<PermissionScope, PermissionGrant>;
  allowedTools?: string[];
}

export interface RequestPermissionsOptions {
  scopes: PermissionScope[];
  reason?: string;
  tools?: string[];
}

export interface StoredPermission {
  grant: PermissionGrant;
  grantedAt: number;
  expiresAt?: number; // For 'granted-once'
  tabId?: number; // For 'granted-once'
}

export interface StoredOriginPermissions {
  origin: string;
  scopes: Record<PermissionScope, StoredPermission>;
  allowedTools: string[];
}

// =============================================================================
// Tool Types
// =============================================================================

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  serverId?: string;
}

export interface ToolCallOptions {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

// =============================================================================
// Text Session Types
// =============================================================================

export type AICapabilityAvailability = 'readily' | 'after-download' | 'no';

export interface TextSessionOptions {
  model?: string;
  provider?: string;
  temperature?: number;
  top_p?: number;
  systemPrompt?: string;
}

export interface AILanguageModelCapabilities {
  available: AICapabilityAvailability;
  defaultTopK?: number;
  maxTopK?: number;
  defaultTemperature?: number;
}

export interface AILanguageModelCreateOptions {
  systemPrompt?: string;
  initialPrompts?: ConversationMessage[];
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamToken {
  type: 'token' | 'done' | 'error';
  token?: string;
  error?: ApiError;
}

export interface TextSession {
  sessionId: string;
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<StreamToken>;
  destroy(): Promise<void>;
  clone(): Promise<TextSession>;
}

export interface StoredSession {
  sessionId: string;
  origin: string;
  options: TextSessionOptions;
  history: ConversationMessage[];
  createdAt: number;
}

// =============================================================================
// LLM Provider Types
// =============================================================================

export interface LLMProviderInfo {
  /** Unique instance ID (e.g., 'openai-work', 'openai-personal') */
  id: string;
  /** Provider type (e.g., 'openai', 'anthropic', 'ollama') */
  type: string;
  /** User-defined display name */
  name: string;
  /** Whether this provider instance is available */
  available: boolean;
  /** Custom base URL if configured */
  baseUrl?: string;
  /** Available model IDs */
  models?: string[];
  /** Whether this is the global default provider */
  isDefault: boolean;
  /** Whether this is the default for its provider type */
  isTypeDefault: boolean;
  /** Whether this provider supports tool calling */
  supportsTools?: boolean;
}

export interface ActiveLLMConfig {
  provider: string | null;
  model: string | null;
}

export interface AddProviderOptions {
  /** Provider type (e.g., 'openai', 'anthropic') */
  type: string;
  /** User-defined display name */
  name: string;
  /** API key (for cloud providers) */
  apiKey?: string;
  /** Custom base URL */
  baseUrl?: string;
}

// =============================================================================
// Agent Run Types
// =============================================================================

export interface AgentRunOptions {
  task: string;
  tools?: string[];
  provider?: string;
  useAllTools?: boolean;
  requireCitations?: boolean;
  maxToolCalls?: number;
  signal?: AbortSignal;
}

export interface Citation {
  source: 'tab' | 'tool';
  ref: string;
  excerpt: string;
}

export interface StatusEvent {
  type: 'status';
  message: string;
}

export interface ToolCallEvent {
  type: 'tool_call';
  tool: string;
  args: unknown;
}

export interface ToolResultEvent {
  type: 'tool_result';
  tool: string;
  result?: unknown;
  error?: ApiError;
}

export interface TokenEvent {
  type: 'token';
  token: string;
}

export interface FinalEvent {
  type: 'final';
  output: string;
  citations?: Citation[];
}

export interface ErrorEvent {
  type: 'error';
  error: ApiError;
}

export type RunEvent =
  | StatusEvent
  | ToolCallEvent
  | ToolResultEvent
  | TokenEvent
  | FinalEvent
  | ErrorEvent;

// =============================================================================
// Browser API Types
// =============================================================================

export interface ActiveTabReadability {
  url: string;
  title: string;
  text: string;
}

// =============================================================================
// BYOC (Bring Your Own Chatbot) Types
// =============================================================================

export interface DeclaredMCPServer {
  url: string;
  title: string;
  description?: string;
  tools?: string[];
  transport?: 'sse' | 'websocket';
}

export interface MCPServerRegistration {
  url: string;
  name: string;
  description?: string;
  tools?: string[];
  transport?: 'sse' | 'websocket';
}

export interface MCPRegistrationResult {
  success: boolean;
  serverId?: string;
  error?: {
    code: 'USER_DENIED' | 'INVALID_URL' | 'CONNECTION_FAILED' | 'NOT_SUPPORTED';
    message: string;
  };
}

export type ChatAvailability = 'readily' | 'no';

export interface ChatOpenOptions {
  initialMessage?: string;
  systemPrompt?: string;
  tools?: string[];
  sessionId?: string;
  style?: {
    theme?: 'light' | 'dark' | 'auto';
    accentColor?: string;
    position?: 'right' | 'left' | 'center';
  };
}

export interface ChatOpenResult {
  success: boolean;
  chatId?: string;
  error?: {
    code: 'USER_DENIED' | 'NOT_AVAILABLE' | 'ALREADY_OPEN';
    message: string;
  };
}

// =============================================================================
// Message Protocol Types (for transport layer)
// =============================================================================

export type MessageType =
  // AI methods
  | 'ai.canCreateTextSession'
  | 'ai.createTextSession'
  | 'ai.languageModel.capabilities'
  | 'ai.languageModel.create'
  | 'ai.providers.list'
  | 'ai.providers.getActive'
  | 'ai.providers.add'
  | 'ai.providers.remove'
  | 'ai.providers.setDefault'
  | 'ai.providers.setTypeDefault'
  | 'ai.runtime.getBest'
  | 'ai.runtime.getCapabilities'
  // Session methods
  | 'session.prompt'
  | 'session.promptStreaming'
  | 'session.destroy'
  | 'session.clone'
  // Agent methods
  | 'agent.requestPermissions'
  | 'agent.permissions.list'
  | 'agent.tools.list'
  | 'agent.tools.call'
  | 'agent.browser.activeTab.readability'
  | 'agent.browser.activeTab.click'
  | 'agent.browser.activeTab.fill'
  | 'agent.browser.activeTab.select'
  | 'agent.browser.activeTab.scroll'
  | 'agent.browser.activeTab.getElement'
  | 'agent.browser.activeTab.waitForSelector'
  | 'agent.browser.activeTab.screenshot'
  | 'agent.run'
  // BYOC methods
  | 'agent.mcp.discover'
  | 'agent.mcp.register'
  | 'agent.mcp.unregister'
  | 'agent.chat.canOpen'
  | 'agent.chat.open'
  | 'agent.chat.close'
  // Address Bar methods
  | 'agent.addressBar.canProvide'
  | 'agent.addressBar.registerProvider'
  | 'agent.addressBar.registerToolShortcuts'
  | 'agent.addressBar.registerSiteProvider'
  | 'agent.addressBar.discover'
  | 'agent.addressBar.listProviders'
  | 'agent.addressBar.unregisterProvider'
  | 'agent.addressBar.setDefaultProvider'
  | 'agent.addressBar.getDefaultProvider'
  | 'agent.addressBar.query'
  | 'agent.addressBar.select';

export interface TransportRequest {
  id: string;
  type: MessageType;
  payload?: unknown;
}

export interface TransportResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: ApiError;
}

export interface TransportStreamEvent {
  id: string;
  event: RunEvent | StreamToken;
  done?: boolean;
}

// =============================================================================
// Required Permission Scopes per Method
// =============================================================================

export const REQUIRED_SCOPES: Partial<Record<MessageType, PermissionScope[]>> = {
  'ai.createTextSession': ['model:prompt'],
  'ai.languageModel.create': ['model:prompt'],
  'ai.providers.list': ['model:list'],
  'ai.providers.getActive': ['model:list'],
  'ai.providers.add': ['model:list'],
  'ai.providers.remove': ['model:list'],
  'ai.providers.setDefault': ['model:list'],
  'ai.providers.setTypeDefault': ['model:list'],
  'session.prompt': ['model:prompt'],
  'session.promptStreaming': ['model:prompt'],
  'agent.tools.list': ['mcp:tools.list'],
  'agent.tools.call': ['mcp:tools.call'],
  'agent.browser.activeTab.readability': ['browser:activeTab.read'],
  'agent.browser.activeTab.click': ['browser:activeTab.interact'],
  'agent.browser.activeTab.fill': ['browser:activeTab.interact'],
  'agent.browser.activeTab.select': ['browser:activeTab.interact'],
  'agent.browser.activeTab.scroll': ['browser:activeTab.interact'],
  'agent.browser.activeTab.getElement': ['browser:activeTab.read'],
  'agent.browser.activeTab.waitForSelector': ['browser:activeTab.read'],
  'agent.browser.activeTab.screenshot': ['browser:activeTab.screenshot'],
  'agent.run': ['model:tools'],
  'agent.mcp.register': ['mcp:servers.register'],
  'agent.chat.open': ['chat:open'],
  'agent.addressBar.registerProvider': ['addressBar:suggest'],
  'agent.addressBar.registerToolShortcuts': ['addressBar:suggest', 'addressBar:execute'],
  'agent.addressBar.registerSiteProvider': ['addressBar:suggest'],
};

// =============================================================================
// Address Bar Types
// =============================================================================

export type AddressBarTriggerType = 'prefix' | 'keyword' | 'regex' | 'always';

export interface AddressBarTrigger {
  type: AddressBarTriggerType;
  value: string;
  hint?: string;
}

export interface AddressBarQueryContext {
  query: string;
  trigger: AddressBarTrigger;
  currentTab?: {
    url: string;
    title: string;
    domain: string;
  };
  recentHistory?: {
    url: string;
    title: string;
    visitCount: number;
    lastVisit: number;
  }[];
  isTyping: boolean;
  timeSinceLastKeystroke: number;
}

export type AddressBarSuggestionType = 'url' | 'search' | 'tool' | 'action' | 'answer';

export interface AddressBarSuggestion {
  id: string;
  type: AddressBarSuggestionType;
  title: string;
  description?: string;
  icon?: string;
  url?: string;
  searchQuery?: string;
  searchEngine?: string;
  tool?: {
    name: string;
    args: Record<string, unknown>;
  };
  action?: AddressBarAction;
  answer?: {
    text: string;
    source?: string;
    copyable?: boolean;
  };
  confidence?: number;
  provider: string;
}

export type AddressBarAction =
  | { type: 'navigate'; url: string }
  | { type: 'search'; query: string; engine?: string }
  | { type: 'copy'; text: string; notify?: boolean }
  | { type: 'execute'; tool: string; args: Record<string, unknown> }
  | { type: 'show'; content: string; format: 'text' | 'markdown' | 'html' }
  | { type: 'agent'; task: string; tools?: string[] };

export type AddressBarResultHandler = 'inline' | 'popup' | 'navigate' | 'clipboard';

export interface ToolShortcut {
  trigger: string;
  tool: string;
  description: string;
  examples?: string[];
  argParser?: string; // Serialized function or built-in parser name
  useLLMParser?: boolean;
  llmParserPrompt?: string;
}

export interface ToolShortcutsOptions {
  shortcuts: ToolShortcut[];
  resultHandler: AddressBarResultHandler;
}

export interface AddressBarProviderOptions {
  id: string;
  name: string;
  description: string;
  triggers: AddressBarTrigger[];
  // Note: onQuery is handled via message passing, not stored
}

export interface SiteProviderOptions {
  origin: string;
  name: string;
  description: string;
  patterns: string[];
  icon?: string;
  endpoint?: string;
  // Note: onQuery is handled via message passing if no endpoint
}

export interface DeclaredAddressBarProvider {
  origin: string;
  name: string;
  description?: string;
  endpoint: string;
  patterns: string[];
  icon?: string;
}

export interface AddressBarProviderInfo {
  id: string;
  name: string;
  description: string;
  triggers: AddressBarTrigger[];
  isDefault: boolean;
  origin?: string;
  type: 'ai' | 'tool' | 'site';
}

export interface StoredAddressBarProvider {
  id: string;
  name: string;
  description: string;
  triggers: AddressBarTrigger[];
  origin: string;
  type: 'ai' | 'tool' | 'site';
  patterns?: string[];
  endpoint?: string;
  shortcuts?: ToolShortcut[];
  resultHandler?: AddressBarResultHandler;
  createdAt: number;
}
