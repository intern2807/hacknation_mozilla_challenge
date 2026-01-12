import browser from 'webextension-polyfill';
import { setupProviderRouter, handlePermissionPromptResponse } from './provider/background-router';
import { getAllPermissions, revokeAllPermissions } from './provider/permissions';
import {
  sendToBridge,
  generateRequestId,
  connectToNative,
  disconnectNative,
  isConnected,
  sendHello,
  setMessageCallback,
  getConnectionState,
  BridgeResponse,
  HarborMessage,
  REQUEST_TIMEOUT_MS,
  DOCKER_TIMEOUT_MS,
  CHAT_TIMEOUT_MS,
} from './native-connection';
import { dispatchToBridge } from './bridge-dispatch';

// BUILD MARKER - if you don't see this, the extension is using cached code!
// Harbor extension background script
console.log('Harbor background script loading...');

// Message log for debugging
interface LogEntry {
  id: number;
  timestamp: number;
  direction: 'send' | 'recv';
  type: string;
  summary: string;
  data: unknown;
}

const MAX_LOG_ENTRIES = 100;
let logIdCounter = 0;
const messageLog: LogEntry[] = [];

function addLogEntry(direction: 'send' | 'recv', type: string, data: unknown): void {
  const summary = getMessageSummary(direction, type, data);
  
  const entry: LogEntry = {
    id: ++logIdCounter,
    timestamp: Date.now(),
    direction,
    type,
    summary,
    data,
  };
  
  messageLog.push(entry);
  
  // Keep only the last MAX_LOG_ENTRIES
  while (messageLog.length > MAX_LOG_ENTRIES) {
    messageLog.shift();
  }
  
  // Broadcast the new log entry to any listeners
  browser.runtime
    .sendMessage({ type: 'log_entry', entry })
    .catch(() => {});
}

function getMessageSummary(direction: 'send' | 'recv', type: string, data: unknown): string {
  const arrow = direction === 'send' ? '→' : '←';
  const d = data as Record<string, unknown>;
  
  switch (type) {
    case 'catalog_get':
    case 'catalog_refresh':
      return `${arrow} Fetching catalog...`;
    case 'catalog_get_result':
    case 'catalog_refresh_result':
      const servers = (d.servers as unknown[])?.length || 0;
      return `${arrow} Received ${servers} servers`;
    case 'catalog_enrich':
      return `${arrow} Starting popularity enrichment...`;
    case 'catalog_enrich_result':
      return `${arrow} Enriched ${d.enriched || 0} servers`;
    case 'install_server':
      const name = (d.catalog_entry as Record<string, unknown>)?.name || 'server';
      return `${arrow} Installing ${name}...`;
    case 'install_server_result':
      return `${arrow} Installation complete`;
    case 'add_remote_server':
      return `${arrow} Adding remote server: ${d.name}...`;
    case 'add_remote_server_result':
      return `${arrow} Remote server added`;
    case 'import_config':
      return `${arrow} Importing MCP configuration...`;
    case 'import_config_result':
      return `${arrow} Imported ${d.imported?.length || 0} servers`;
    case 'mcp_connect':
      return `${arrow} Connecting to ${d.server_id}...`;
    case 'mcp_connect_result':
      return d.connected ? `${arrow} Connected!` : `${arrow} Connection failed`;
    case 'error':
      const errMsg = (d.error as Record<string, unknown>)?.message || 'Unknown error';
      return `${arrow} Error: ${errMsg}`;
    case 'hello':
      return `${arrow} Handshake`;
    case 'pong':
      return `${arrow} Bridge v${d.bridge_version}`;
    default:
      return `${arrow} ${type}`;
  }
}

/**
 * Broadcast a message to all extension pages (sidebar, chat, directory).
 * Uses runtime.sendMessage which reaches all extension contexts.
 */
function broadcastToExtension(message: Record<string, unknown>): void {
  browser.runtime
    .sendMessage(message)
    .catch(() => {
      // Ignore errors - no listeners is fine
    });
}

// Set up message callback to handle broadcasts and logging
setMessageCallback((response) => {
  // Log the received message
  addLogEntry('recv', response.type, response);

  // Handle status updates (pushed from bridge, not in response to a request)
  if (response.type === 'status_update') {
    console.log('[Background] Status update:', response);
    browser.runtime
      .sendMessage({ 
        ...response,  // Spread first, then override type
        type: 'catalog_status', 
      })
      .catch(() => {});
    return;
  }
  
  // Handle server progress updates (Docker startup, etc.)
  if (response.type === 'server_progress') {
    console.log('[Background] Server progress:', response);
    browser.runtime
      .sendMessage({ 
        type: 'server_progress', 
        server_id: (response as { server_id?: string }).server_id,
        message: (response as { message?: string }).message,
        timestamp: (response as { timestamp?: number }).timestamp,
      })
      .catch(() => {});
    return;
  }

  // Broadcast the response to sidebars
  browser.runtime
    .sendMessage({ type: 'bridge_response', response })
    .catch(() => {});
  
  // Broadcast specific events for UI updates
  if (response.type === 'install_server_result' || 
      response.type === 'uninstall_server_result') {
    browser.runtime
      .sendMessage({ type: 'installed_servers_changed' })
      .catch(() => {});
  }
});

// Exported LLM chat function for use by background-router
export interface LLMChatOptions {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  provider?: string;  // Specify which LLM provider to use
  temperature?: number;
  tools?: unknown[];
  max_tokens?: number;
  system_prompt?: string;
}

export interface LLMChatResponse {
  type: string;
  response?: {
    message?: {
      content?: string;
    };
  };
  error?: {
    message: string;
  };
}

export async function llmChat(options: LLMChatOptions): Promise<LLMChatResponse> {
  return sendToBridge({
    type: 'llm_chat',
    request_id: generateRequestId(),
    messages: options.messages,
    tools: options.tools,
    model: options.model,
    provider: options.provider,
    max_tokens: options.max_tokens,
    temperature: options.temperature,
    system_prompt: options.system_prompt,
  }, CHAT_TIMEOUT_MS) as Promise<LLMChatResponse>;
}

// Handle messages from sidebar
browser.runtime.onMessage.addListener(
  (message: unknown, _sender: browser.Runtime.MessageSender) => {
    const msg = message as { type: string; [key: string]: unknown };

    if (msg.type === 'get_state') {
      return Promise.resolve(getConnectionState());
    }
    
    if (msg.type === 'get_message_log') {
      return Promise.resolve({ log: messageLog });
    }
    
    if (msg.type === 'get_debug_logs') {
      return browser.storage.local.get('harbor_debug_logs').then(result => {
        return { logs: result.harbor_debug_logs || [] };
      });
    }

    if (msg.type === 'send_hello') {
      if (!isConnected()) {
        connectToNative();
      }
      sendHello();
      return Promise.resolve({ sent: true });
    }

    // Diagnostic ping - tests the full pipeline including push status updates
    if (msg.type === 'send_ping') {
      if (!isConnected()) {
        connectToNative();
      }
      return sendToBridge({
        type: 'ping',
        request_id: generateRequestId(),
        echo: msg.echo || 'test',
      });
    }

    if (msg.type === 'reconnect') {
      disconnectNative();
      connectToNative();
      sendHello();
      return Promise.resolve({ reconnecting: true });
    }

    // =======================================================================
    // Try dispatch table for common bridge messages
    // =======================================================================
    const dispatched = dispatchToBridge(msg);
    if (dispatched !== undefined) {
      return dispatched;
    }

    // =======================================================================
    // Special handlers that need custom logic
    // =======================================================================

    // Install from VS Code button (detected on web pages)
    if (msg.type === 'install_from_vscode_button') {
      const params = msg.params as { 
        name: string; 
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        npmPackage?: string;
        pypiPackage?: string;
      };
      
      // Determine what to install
      let installType = 'install_server';
      let installPayload: Record<string, unknown> = {
        request_id: generateRequestId(),
      };
      
      if (params.npmPackage) {
        // Install npm package
        installPayload.type = 'install_server';
        installPayload.catalog_entry = {
          id: `vscode-${params.name}-${Date.now()}`,
          name: params.name,
          description: `Installed from VS Code button on ${msg.pageUrl}`,
          endpointUrl: '',
          installableOnly: true,
          tags: ['vscode'],
          source: 'vscode-button',
          fetchedAt: Date.now(),
          homepageUrl: msg.pageUrl,
          repositoryUrl: '',
          packages: [{
            registryType: 'npm',
            identifier: params.npmPackage,
            environmentVariables: [],
          }],
        };
      } else if (params.pypiPackage) {
        // Install pypi package
        installPayload.type = 'install_server';
        installPayload.catalog_entry = {
          id: `vscode-${params.name}-${Date.now()}`,
          name: params.name,
          description: `Installed from VS Code button on ${msg.pageUrl}`,
          endpointUrl: '',
          installableOnly: true,
          tags: ['vscode'],
          source: 'vscode-button',
          fetchedAt: Date.now(),
          homepageUrl: msg.pageUrl,
          repositoryUrl: '',
          packages: [{
            registryType: 'pypi',
            identifier: params.pypiPackage,
            environmentVariables: [],
          }],
        };
      } else {
        // Unknown install type - return error
        return Promise.resolve({
          success: false,
          error: { message: 'Unknown install type. Expected npm or pypi package.' },
        });
      }
      
      return sendToBridge(installPayload as HarborMessage).then(result => {
        if (result && result.type === 'install_server_result') {
          browser.runtime
            .sendMessage({ type: 'installed_servers_changed' })
            .catch(() => {});
          return { success: true, server: result.server };
        }
        return {
          success: false,
          error: result?.error || { message: 'Installation failed' },
        };
      });
    }

    // MCP connect - needs special logic for Docker timeout and broadcast
    if (msg.type === 'mcp_connect') {
      const useDocker = msg.use_docker || false;
      console.log('[Background] mcp_connect request for:', msg.server_id, 'skip_security_check:', msg.skip_security_check, 'use_docker:', useDocker);
      
      // Use longer timeout for Docker (building images takes time)
      const timeout = useDocker ? DOCKER_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
      
      return sendToBridge({
        type: 'mcp_connect',
        request_id: generateRequestId(),
        server_id: msg.server_id,
        skip_security_check: msg.skip_security_check || false,
        use_docker: useDocker,
      }, timeout).then(result => {
        console.log('[Background] mcp_connect result:', result);
        // Broadcast to all extension pages that a server connected
        if (result && result.type === 'mcp_connect_result' && result.connected) {
          broadcastToExtension({
            type: 'mcp_server_connected',
            server_id: msg.server_id,
            tools: result.tools,
            running_in_docker: result.running_in_docker,
          });
        }
        return result;
      });
    }

    // OAuth start - needs popup window creation
    if (msg.type === 'oauth_start') {
      return sendToBridge({
        type: 'oauth_start',
        request_id: generateRequestId(),
        server_id: msg.server_id,
        credential_key: msg.credential_key,
        provider_id: msg.provider_id,
      }).then(async (result) => {
        if (result?.type === 'oauth_start_result' && result.auth_url) {
          // Open the OAuth URL in a new window
          try {
            await browser.windows.create({
              url: result.auth_url as string,
              type: 'popup',
              width: 600,
              height: 700,
            });
          } catch (err) {
            // Fallback to opening in a tab if popup fails
            await browser.tabs.create({ url: result.auth_url as string });
          }
        }
        return result;
      });
    }

    // Manifest OAuth start - needs popup window creation
    if (msg.type === 'manifest_oauth_start') {
      console.log('[Background] manifest_oauth_start for:', msg.server_id);
      return sendToBridge({
        type: 'manifest_oauth_start',
        request_id: generateRequestId(),
        server_id: msg.server_id,
      }).then(async (result) => {
        if (result?.type === 'manifest_oauth_start_result' && result.auth_url) {
          // Open the OAuth URL in a new window
          try {
            await browser.windows.create({
              url: result.auth_url as string,
              type: 'popup',
              width: 600,
              height: 700,
            });
          } catch (err) {
            // Fallback to opening in a tab if popup fails
            await browser.tabs.create({ url: result.auth_url as string });
          }
        }
        return result;
      });
    }

    if (msg.type === 'start_manifest_server') {
      const useDocker = msg.use_docker || false;
      console.log('[Background] start_manifest_server for:', msg.server_id, 'use_docker:', useDocker);
      // Use 5-minute timeout for Docker (image pull + npm install from GitHub can be slow)
      const timeout = useDocker ? DOCKER_TIMEOUT_MS : REQUEST_TIMEOUT_MS * 4; // 2 minutes for native
      return sendToBridge({
        type: 'start_manifest_server',
        request_id: generateRequestId(),
        server_id: msg.server_id,
        use_docker: useDocker,
      }, timeout);
    }

    // LLM messages
    if (msg.type === 'llm_detect') {
      return sendToBridge({
        type: 'llm_detect',
        request_id: generateRequestId(),
      });
    }

    if (msg.type === 'llm_setup_status') {
      return sendToBridge({
        type: 'llm_setup_status',
        request_id: generateRequestId(),
      });
    }

    if (msg.type === 'llm_download_model') {
      return sendToBridge({
        type: 'llm_download_model',
        request_id: generateRequestId(),
        model_id: msg.model_id,
      });
    }

    if (msg.type === 'llm_delete_model') {
      return sendToBridge({
        type: 'llm_delete_model',
        request_id: generateRequestId(),
        model_id: msg.model_id,
      });
    }

    if (msg.type === 'llm_start_local') {
      return sendToBridge({
        type: 'llm_start_local',
        request_id: generateRequestId(),
        model_id: msg.model_id,
        port: msg.port,
      });
    }

    if (msg.type === 'llm_stop_local') {
      return sendToBridge({
        type: 'llm_stop_local',
        request_id: generateRequestId(),
      });
    }

    if (msg.type === 'llm_chat') {
      // Direct LLM chat - used by window.ai.createTextSession
      // Note: For tool-enabled chat, use chat_send_message which goes through the bridge orchestrator
      return sendToBridge({
        type: 'llm_chat',
        request_id: generateRequestId(),
        messages: msg.messages,
        tools: msg.tools,
        model: msg.model,
        max_tokens: msg.max_tokens,
        temperature: msg.temperature,
        system_prompt: msg.system_prompt,
      }, CHAT_TIMEOUT_MS);
    }

    // LLM provider configuration messages
    if (msg.type === 'llm_get_supported_providers') {
      return sendToBridge({
        type: 'llm_get_supported_providers',
        request_id: generateRequestId(),
      });
    }

    if (msg.type === 'llm_get_config') {
      return sendToBridge({
        type: 'llm_get_config',
        request_id: generateRequestId(),
      });
    }

    if (msg.type === 'llm_set_active') {
      return sendToBridge({
        type: 'llm_set_active',
        request_id: generateRequestId(),
        provider_id: msg.provider_id,
        model_id: msg.model_id,
      });
    }

    if (msg.type === 'llm_set_model') {
      return sendToBridge({
        type: 'llm_set_model',
        request_id: generateRequestId(),
        model_id: msg.model_id,
      });
    }

    if (msg.type === 'llm_list_models_for') {
      return sendToBridge({
        type: 'llm_list_models_for',
        request_id: generateRequestId(),
        provider_id: msg.provider_id,
      });
    }

    if (msg.type === 'llm_set_api_key') {
      return sendToBridge({
        type: 'llm_set_api_key',
        request_id: generateRequestId(),
        provider_id: msg.provider_id,
        api_key: msg.api_key,
      });
    }

    if (msg.type === 'llm_remove_api_key') {
      return sendToBridge({
        type: 'llm_remove_api_key',
        request_id: generateRequestId(),
        provider_id: msg.provider_id,
      });
    }

    // MCP connections list
    if (msg.type === 'mcp_list_connections') {
      return sendToBridge({
        type: 'mcp_list_connections',
        request_id: generateRequestId(),
      }).catch((err) => {
        console.error('[Background] mcp_list_connections error:', err);
        return { type: 'error', error: { message: err instanceof Error ? err.message : 'Failed to list connections' } };
      });
    }

    // Chat session messages
    if (msg.type === 'chat_create_session') {
      return sendToBridge({
        type: 'chat_create_session',
        request_id: generateRequestId(),
        enabled_servers: msg.enabled_servers,
        name: msg.name,
        system_prompt: msg.system_prompt,
        max_iterations: msg.max_iterations,
      }).catch((err) => {
        console.error('[Background] chat_create_session error:', err);
        return { type: 'error', error: { message: err instanceof Error ? err.message : 'Failed to create session' } };
      });
    }

    if (msg.type === 'chat_send_message') {
      // Use longer timeout for chat (LLM + tools can be slow)
      return sendToBridge({
        type: 'chat_send_message',
        request_id: generateRequestId(),
        session_id: msg.session_id,
        message: msg.message,
        use_tool_router: msg.use_tool_router,
      }, CHAT_TIMEOUT_MS).catch((err) => {
        console.error('[Background] chat_send_message error:', err);
        return { type: 'error', error: { message: err instanceof Error ? err.message : 'Failed to send message' } };
      });
    }

    if (msg.type === 'chat_get_session') {
      return sendToBridge({
        type: 'chat_get_session',
        request_id: generateRequestId(),
        session_id: msg.session_id,
      });
    }

    if (msg.type === 'chat_list_sessions') {
      return sendToBridge({
        type: 'chat_list_sessions',
        request_id: generateRequestId(),
        limit: msg.limit,
      });
    }

    if (msg.type === 'chat_delete_session') {
      return sendToBridge({
        type: 'chat_delete_session',
        request_id: generateRequestId(),
        session_id: msg.session_id,
      });
    }

    if (msg.type === 'chat_update_session') {
      return sendToBridge({
        type: 'chat_update_session',
        request_id: generateRequestId(),
        session_id: msg.session_id,
        updates: msg.updates,
      });
    }

    if (msg.type === 'chat_clear_messages') {
      return sendToBridge({
        type: 'chat_clear_messages',
        request_id: generateRequestId(),
        session_id: msg.session_id,
      });
    }

    // MCP tool call (used by JS AI Provider)
    if (msg.type === 'mcp_call_tool') {
      return sendToBridge({
        type: 'mcp_call_tool',
        request_id: generateRequestId(),
        server_id: msg.server_id,
        tool_name: msg.tool_name,
        arguments: msg.arguments,
      });
    }

    // Permission prompt response (from permission-prompt.html)
    if (msg.type === 'provider_permission_response') {
      handlePermissionPromptResponse(msg.promptId, msg.decision, msg.allowedTools);
      return Promise.resolve({ received: true });
    }

    // List all permissions (for sidebar management UI)
    // Includes both persistent AND temporary (once) grants
    if (msg.type === 'list_all_permissions') {
      return (async () => {
        try {
          const permissions = await getAllPermissions();
          return { type: 'list_all_permissions_result', permissions };
        } catch (err) {
          console.error('Failed to list permissions:', err);
          return { type: 'error', error: { message: 'Failed to list permissions' } };
        }
      })();
    }

    // Revoke all permissions for an origin (clears both persistent and temporary grants)
    if (msg.type === 'revoke_origin_permissions') {
      return (async () => {
        try {
          await revokeAllPermissions(msg.origin as string);
          return { type: 'revoke_origin_permissions_result', success: true };
        } catch (err) {
          console.error('Failed to revoke permissions:', err);
          return { type: 'error', error: { message: 'Failed to revoke permissions' } };
        }
      })();
    }

    // Proxy fetch requests from sidebar (for CORS)
    if (msg.type === 'proxy_fetch') {
      console.log('[proxy_fetch] Received request for:', msg.url);
      return (async () => {
        try {
          console.log('[proxy_fetch] Starting fetch...');
          const response = await fetch(msg.url as string, {
            method: (msg.method as string) || 'GET',
            headers: (msg.headers as Record<string, string>) || {},
          });
          
          console.log('[proxy_fetch] Response status:', response.status);
          
          if (!response.ok) {
            console.log('[proxy_fetch] Response not ok:', response.statusText);
            return { 
              ok: false, 
              status: response.status, 
              error: response.statusText 
            };
          }
          
          const contentType = response.headers.get('content-type') || '';
          let data: string | object;
          
          if (contentType.includes('application/json')) {
            data = await response.json();
            console.log('[proxy_fetch] Parsed JSON, keys:', Object.keys(data as object));
          } else {
            data = await response.text();
            console.log('[proxy_fetch] Got text, length:', (data as string).length);
          }
          
          return { ok: true, status: response.status, data };
        } catch (err) {
          console.error('[proxy_fetch] Error:', err);
          return { 
            ok: false, 
            status: 0, 
            error: err instanceof Error ? err.message : 'Fetch failed' 
          };
        }
      })();
    }

    return Promise.resolve(undefined);
  }
);

// Connect on startup
connectToNative();
sendHello();

// Chrome: Open side panel when action button is clicked
// The sidePanel API is Chrome-specific and not in webextension-polyfill
declare const chrome: {
  sidePanel?: {
    open(options: { windowId: number }): Promise<void>;
    setOptions(options: { path?: string; enabled?: boolean }): Promise<void>;
  };
  action?: {
    onClicked: {
      addListener(callback: (tab: { windowId: number }) => void): void;
    };
  };
};

if (typeof chrome !== 'undefined' && chrome.sidePanel) {
  // Enable the side panel for all tabs
  chrome.sidePanel.setOptions({ enabled: true }).catch(() => {});
  
  // Open side panel when toolbar action is clicked
  chrome.action?.onClicked.addListener((tab) => {
    if (tab.windowId) {
      chrome.sidePanel?.open({ windowId: tab.windowId }).catch(console.error);
    }
  });
  console.log('[Harbor] Chrome side panel support enabled');
}

// Check for first run and open welcome page
async function checkFirstRun(): Promise<void> {
  try {
    const result = await browser.storage.local.get('harbor_first_run_complete');
    if (!result.harbor_first_run_complete) {
      // First run! Open the welcome page
      console.log('[Background] First run detected, opening welcome page');
      await browser.tabs.create({
        url: browser.runtime.getURL('welcome.html'),
      });
    }
  } catch (err) {
    console.error('[Background] Error checking first run:', err);
  }
}

checkFirstRun();

// Auto-detect LLM on startup so provider API can use it immediately
async function autoDetectLLM(): Promise<void> {
  try {
    // Give the bridge a moment to initialize
    await new Promise(r => setTimeout(r, 500));
    
    const response = await sendToBridge({
      type: 'llm_detect',
      request_id: generateRequestId(),
    });
    
    if (response.type === 'llm_detect_result') {
      console.log('[Background] Auto-detected LLM providers:', response);
    }
  } catch (err) {
    console.warn('[Background] LLM auto-detection failed:', err);
  }
}

autoDetectLLM();

// Initialize the JS AI Provider router
setupProviderRouter();

// ============================================================================
// Page Chat - inject chat sidebar into current tab
// ============================================================================

async function injectPageChat(tabId: number): Promise<void> {
  try {
    // Inject the page-chat content script
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['page-chat.js'],
    });
    console.log('[Background] Page chat injected into tab', tabId);
  } catch (err) {
    console.error('[Background] Failed to inject page chat:', err);
  }
}

// Listen for keyboard command
browser.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-page-chat') {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.id) {
      await injectPageChat(tabs[0].id);
    }
  }
});

// Also handle message from sidebar/popup to open page chat
browser.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'open_page_chat' && message.tabId) {
    injectPageChat(message.tabId);
  }
});

console.log('Harbor background script initialized');
