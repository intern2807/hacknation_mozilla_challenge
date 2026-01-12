/**
 * Bridge Message Dispatch System
 * 
 * Provides a declarative way to configure message forwarding to the native bridge.
 * This replaces repetitive if-else chains with a configurable dispatch table.
 * 
 * Message types:
 * - Simple forwards: Just forward to bridge with same type
 * - Parameterized forwards: Extract specific params from the message
 * - Transformed forwards: Process the response before returning
 */

import { sendToBridge, generateRequestId, REQUEST_TIMEOUT_MS, DOCKER_TIMEOUT_MS, CHAT_TIMEOUT_MS } from './native-connection';
import type { BridgeResponse, HarborMessage } from './native-connection';
import browser from 'webextension-polyfill';

// =============================================================================
// Types
// =============================================================================

type MessagePayload = { type: string; [key: string]: unknown };

/**
 * Configuration for a bridge message handler.
 */
export interface BridgeMessageConfig {
  /** Custom timeout in milliseconds (default: REQUEST_TIMEOUT_MS) */
  timeout?: number;
  
  /** 
   * Extract parameters from the incoming message.
   * Returns an object of params to merge into the bridge message.
   * If not provided, no additional params are extracted.
   */
  params?: (msg: MessagePayload) => Record<string, unknown>;
  
  /**
   * Transform the response before returning.
   * If not provided, response is returned as-is.
   */
  transform?: (response: BridgeResponse) => unknown;
  
  /**
   * Post-processing callback after successful response.
   * Use for side effects like notifications.
   */
  onSuccess?: (response: BridgeResponse, msg: MessagePayload) => void;
  
  /**
   * If true, validates the response has 'servers' property.
   * Used for catalog responses.
   */
  expectServers?: boolean;
}

// =============================================================================
// Dispatch Table
// =============================================================================

/**
 * Registry of message types that should be forwarded to the bridge.
 * 
 * The key is the message type, the value is the configuration.
 * Messages not in this table will fall through to be handled elsewhere.
 */
export const BRIDGE_MESSAGES: Record<string, BridgeMessageConfig> = {
  // =========================================================================
  // Server Store (legacy HTTP servers)
  // =========================================================================
  add_server: {
    params: (msg) => ({
      label: msg.label,
      base_url: msg.base_url,
    }),
  },
  remove_server: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  list_servers: {},
  connect_server: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  disconnect_server: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  list_tools: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  
  // =========================================================================
  // Catalog
  // =========================================================================
  catalog_get: {
    params: (msg) => ({ force: msg.force === true }),
    expectServers: true,
  },
  catalog_refresh: {
    expectServers: true,
  },
  catalog_search: {
    params: (msg) => ({ query: msg.query || '' }),
    expectServers: true,
  },
  catalog_enrich: {
    timeout: 120000, // 2 minutes
  },
  
  // =========================================================================
  // Curated Servers
  // =========================================================================
  get_curated_servers: {},
  install_curated_server: {
    params: (msg) => ({ server_id: msg.server_id }),
    onSuccess: (response) => {
      if (response.type === 'install_curated_server_result' && response.success) {
        notifyServersChanged();
      }
    },
  },
  install_github_repo: {
    params: (msg) => ({ github_url: msg.github_url }),
    onSuccess: (response) => {
      if (response.type === 'install_github_repo_result' && response.success) {
        notifyServersChanged();
      }
    },
  },
  
  // =========================================================================
  // Installer
  // =========================================================================
  check_runtimes: {},
  install_server: {
    params: (msg) => ({
      catalog_entry: msg.catalog_entry,
      package_index: msg.package_index || 0,
    }),
  },
  uninstall_server: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  add_remote_server: {
    params: (msg) => ({
      name: msg.name,
      url: msg.url,
      transport_type: msg.transport_type || 'http',
      headers: msg.headers,
    }),
    onSuccess: () => notifyServersChanged(),
  },
  import_config: {
    params: (msg) => ({
      config_json: msg.config_json,
      install_url: msg.install_url,
    }),
    onSuccess: () => notifyServersChanged(),
  },
  list_installed: {},
  update_server_args: {
    params: (msg) => ({
      server_id: msg.server_id,
      args: msg.args,
    }),
  },
  start_installed: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  stop_installed: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  set_server_secrets: {
    params: (msg) => ({
      server_id: msg.server_id,
      secrets: msg.secrets,
    }),
  },
  get_server_status: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  
  // =========================================================================
  // Docker
  // =========================================================================
  check_docker: {},
  reconnect_orphaned_containers: {
    timeout: DOCKER_TIMEOUT_MS,
    onSuccess: () => notifyServersChanged(),
  },
  build_docker_images: {
    params: (msg) => ({ image_type: msg.image_type }),
  },
  set_docker_mode: {
    params: (msg) => ({
      server_id: msg.server_id,
      use_docker: msg.use_docker,
      volumes: msg.volumes,
    }),
  },
  should_prefer_docker: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  
  // =========================================================================
  // MCP Connections
  // =========================================================================
  mcp_disconnect: {
    params: (msg) => ({ server_id: msg.server_id }),
    onSuccess: (_, msg) => {
      broadcastToExtension({
        type: 'mcp_server_disconnected',
        server_id: msg.server_id,
      });
    },
  },
  mcp_list_tools: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  mcp_list_connections: {},
  
  // =========================================================================
  // Credentials
  // =========================================================================
  set_credential: {
    params: (msg) => ({
      server_id: msg.server_id,
      key: msg.key,
      value: msg.value,
      credential_type: msg.credential_type || 'api_key',
    }),
  },
  list_credentials: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  delete_credential: {
    params: (msg) => ({
      server_id: msg.server_id,
      key: msg.key,
    }),
  },
  
  // =========================================================================
  // OAuth
  // =========================================================================
  oauth_cancel: {
    params: (msg) => ({ state: msg.state }),
  },
  oauth_revoke: {
    params: (msg) => ({
      server_id: msg.server_id,
      credential_key: msg.credential_key,
    }),
  },
  oauth_status: {
    params: (msg) => ({
      server_id: msg.server_id,
      credential_key: msg.credential_key,
    }),
  },
  list_oauth_providers: {},
  
  // =========================================================================
  // Manifest
  // =========================================================================
  get_server_manifest: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  manifest_oauth_status: {
    params: (msg) => ({ server_id: msg.server_id }),
  },
  
  // =========================================================================
  // LLM
  // =========================================================================
  llm_detect: {},
  llm_setup_status: {},
  llm_download_model: {
    params: (msg) => ({ model_id: msg.model_id }),
  },
  llm_delete_model: {
    params: (msg) => ({ model_id: msg.model_id }),
  },
  llm_start_local: {
    params: (msg) => ({
      model_id: msg.model_id,
      port: msg.port,
    }),
  },
  llm_stop_local: {},
  llm_chat: {
    timeout: CHAT_TIMEOUT_MS,
    params: (msg) => ({
      messages: msg.messages,
      tools: msg.tools,
      model: msg.model,
      max_tokens: msg.max_tokens,
      temperature: msg.temperature,
      system_prompt: msg.system_prompt,
    }),
  },
  llm_get_supported_providers: {},
  llm_get_config: {},
  llm_set_active: {
    params: (msg) => ({
      provider_id: msg.provider_id,
      model_id: msg.model_id,
    }),
  },
  llm_set_model: {
    params: (msg) => ({ model_id: msg.model_id }),
  },
  llm_list_models_for: {
    params: (msg) => ({ provider_id: msg.provider_id }),
  },
  llm_set_api_key: {
    params: (msg) => ({
      provider_id: msg.provider_id,
      api_key: msg.api_key,
    }),
  },
  llm_remove_api_key: {
    params: (msg) => ({ provider_id: msg.provider_id }),
  },
  
  // =========================================================================
  // Chat Sessions
  // =========================================================================
  chat_create_session: {
    params: (msg) => ({
      enabled_servers: msg.enabled_servers,
      name: msg.name,
      system_prompt: msg.system_prompt,
      max_iterations: msg.max_iterations,
    }),
  },
  chat_send_message: {
    timeout: CHAT_TIMEOUT_MS,
    params: (msg) => ({
      session_id: msg.session_id,
      message: msg.message,
      use_tool_router: msg.use_tool_router,
    }),
  },
  chat_get_session: {
    params: (msg) => ({ session_id: msg.session_id }),
  },
  chat_list_sessions: {
    params: (msg) => ({ limit: msg.limit }),
  },
  chat_delete_session: {
    params: (msg) => ({ session_id: msg.session_id }),
  },
  chat_update_session: {
    params: (msg) => ({
      session_id: msg.session_id,
      updates: msg.updates,
    }),
  },
  chat_clear_messages: {
    params: (msg) => ({ session_id: msg.session_id }),
  },
  
  // =========================================================================
  // MCP Tool Calls
  // =========================================================================
  mcp_call_tool: {
    params: (msg) => ({
      server_id: msg.server_id,
      tool_name: msg.tool_name,
      arguments: msg.arguments,
    }),
  },
};

// =============================================================================
// Helpers
// =============================================================================

function notifyServersChanged(): void {
  browser.runtime
    .sendMessage({ type: 'installed_servers_changed' })
    .catch(() => {});
}

function broadcastToExtension(message: Record<string, unknown>): void {
  browser.runtime
    .sendMessage(message)
    .catch(() => {});
}

// =============================================================================
// Dispatch Function
// =============================================================================

/**
 * Attempt to handle a message using the bridge dispatch table.
 * 
 * @param msg The incoming message
 * @returns A Promise with the response, or undefined if the message type is not in the table
 */
export function dispatchToBridge(msg: MessagePayload): Promise<unknown> | undefined {
  const config = BRIDGE_MESSAGES[msg.type];
  if (!config) {
    return undefined;
  }
  
  // Build the bridge message
  const bridgeMessage: HarborMessage = {
    type: msg.type,
    request_id: generateRequestId(),
    ...(config.params ? config.params(msg) : {}),
  };
  
  // Determine timeout
  const timeout = config.timeout || REQUEST_TIMEOUT_MS;
  
  // Send to bridge
  let promise = sendToBridge(bridgeMessage, timeout);
  
  // Handle expectServers validation
  if (config.expectServers) {
    promise = promise.then(response => {
      if (response && 'servers' in response) {
        return response;
      }
      throw new Error(response?.error?.message || `Failed to ${msg.type}`);
    });
  }
  
  // Handle transform
  if (config.transform) {
    promise = promise.then(response => config.transform!(response));
  }
  
  // Handle onSuccess (side effects)
  if (config.onSuccess) {
    promise = promise.then(response => {
      config.onSuccess!(response as BridgeResponse, msg);
      return response;
    });
  }
  
  return promise;
}

/**
 * Check if a message type is handled by the bridge dispatch table.
 */
export function isBridgeMessage(type: string): boolean {
  return type in BRIDGE_MESSAGES;
}

