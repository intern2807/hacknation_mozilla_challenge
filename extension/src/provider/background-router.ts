/**
 * Harbor JS AI Provider - Background Router
 * 
 * Handles all provider API requests from content scripts.
 * Manages sessions, enforces permissions, and routes to appropriate handlers.
 */

import browser from 'webextension-polyfill';
import type {
  ProviderMessage,
  ApiError,
  PermissionScope,
  TextSessionState,
  TextSessionOptions,
  ToolDescriptor,
  ActiveTabReadability,
  StreamToken,
  RunEvent,
  // BYOC types
  DeclaredMCPServer,
  MCPServerRegistration,
  MCPRegistrationResult,
  ChatOpenOptions,
  ChatOpenResult,
} from './types';
import {
  getPermissionStatus,
  hasPermission,
  hasAllPermissions,
  getMissingPermissions,
  grantPermissions,
  denyPermissions,
  buildGrantResult,
  SCOPE_DESCRIPTIONS,
  GESTURE_REQUIRED_SCOPES,
  clearTabGrants,
  isToolAllowed,
  getAllowedTools,
} from './permissions';
import { llmChat } from '../background';
import { 
  getMcpConnections,
  listMcpTools,
  createChatSession, 
  sendChatMessage, 
  deleteChatSession,
  listLLMProviders,
  getActiveLLM,
} from '../bridge-api';

const DEBUG = true;

function log(...args: unknown[]): void {
  if (DEBUG) {
    console.log('[Harbor Provider Router]', ...args);
  }
}

// Storage-based debug log for reliable reading

// =============================================================================
// State Management
// =============================================================================

// Active text sessions
const textSessions = new Map<string, TextSessionState>();

// Pending permission requests waiting for user response
const pendingPermissionRequests = new Map<string, {
  port: browser.Runtime.Port;
  requestId: string;
  origin: string;
  scopes: PermissionScope[];
  tabId?: number;
  reason?: string;
  requestedTools?: string[];
}>();

// Active streaming requests
const streamingRequests = new Map<string, {
  port: browser.Runtime.Port;
  aborted: boolean;
}>();

// BYOC: Registered website MCP servers
const websiteMcpServers = new Map<string, {
  origin: string;
  serverId: string;
  url: string;
  name: string;
  description?: string;
  tools?: string[];
  tabId?: number;
  connectedAt: number;
}>();

// BYOC: Open chat sessions
const openChatSessions = new Map<string, {
  origin: string;
  chatId: string;
  tabId: number;
  options: ChatOpenOptions;
  openedAt: number;
}>();

// BYOC: Pending MCP registrations (waiting for permission)
const pendingMcpRegistrations = new Map<string, {
  port: browser.Runtime.Port;
  origin: string;
  payload: MCPServerRegistration;
}>();

// BYOC: Pending chat opens (waiting for permission)
const pendingChatOpens = new Map<string, {
  port: browser.Runtime.Port;
  origin: string;
  payload: ChatOpenOptions;
}>();

// Session ID counter
let sessionIdCounter = 0;

// =============================================================================
// Helper Functions
// =============================================================================

function generateSessionId(): string {
  return `session-${Date.now()}-${++sessionIdCounter}`;
}

function createError(code: ApiError['code'], message: string, details?: unknown): ApiError {
  return { code, message, details };
}

function sendResponse(port: browser.Runtime.Port, type: string, requestId: string, payload?: unknown): void {
  log('sendResponse called:', { type, requestId, payload, portName: port?.name });
  try {
    port.postMessage({
      namespace: 'harbor-provider',
      type,
      requestId,
      payload,
    });
    log('Response sent successfully');
  } catch (err) {
    log('Failed to send response (port may be disconnected):', err);
  }
}

function sendError(port: browser.Runtime.Port, requestId: string, error: ApiError): void {
  sendResponse(port, 'error', requestId, { error });
}

// =============================================================================
// Permission Enforcement
// =============================================================================

async function requirePermission(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  scope: PermissionScope
): Promise<boolean> {
  if (await hasPermission(origin, scope)) {
    return true;
  }
  
  sendError(port, requestId, createError(
    'ERR_SCOPE_REQUIRED',
    `Permission "${scope}" is required. Call agent.requestPermissions() first.`,
    { requiredScope: scope }
  ));
  return false;
}

async function requireAllPermissions(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  scopes: PermissionScope[]
): Promise<boolean> {
  if (await hasAllPermissions(origin, scopes)) {
    return true;
  }
  
  const missing = await getMissingPermissions(origin, scopes);
  sendError(port, requestId, createError(
    'ERR_SCOPE_REQUIRED',
    `Missing permissions: ${missing.join(', ')}. Call agent.requestPermissions() first.`,
    { requiredScopes: scopes, missingScopes: missing }
  ));
  return false;
}

// =============================================================================
// Permission Request UI
// =============================================================================

async function showPermissionPrompt(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  scopes: PermissionScope[],
  reason?: string,
  requestedTools?: string[]
): Promise<void> {
  // Store the pending request (including tabId for cleanup on tab close)
  const promptId = `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tabId = port.sender?.tab?.id;
  pendingPermissionRequests.set(promptId, {
    port,
    requestId,
    origin,
    scopes,
    tabId,
    reason,
    requestedTools,
  });
  
  // Build permission prompt URL with query params
  const promptUrl = browser.runtime.getURL('permission-prompt.html');
  const params = new URLSearchParams({
    promptId,
    origin,
    scopes: JSON.stringify(scopes),
    reason: reason || '',
  });
  
  // If requesting mcp:tools.call, include the tools list
  if (scopes.includes('mcp:tools.call')) {
    // Get available tools to show in the prompt
    let availableTools: string[] = [];
    try {
      const connectionsResponse = await browser.runtime.sendMessage({
        type: 'mcp_list_connections',
      }) as { type: string; connections?: Array<{ serverId: string; serverName: string; toolCount: number }> };
      
      if (connectionsResponse.connections) {
        for (const conn of connectionsResponse.connections) {
          const toolsResponse = await browser.runtime.sendMessage({
            type: 'mcp_list_tools',
            server_id: conn.serverId,
          }) as { type: string; tools?: Array<{ name: string; description?: string }> };
          
          if (toolsResponse.tools) {
            for (const tool of toolsResponse.tools) {
              availableTools.push(`${conn.serverId}/${tool.name}`);
            }
          }
        }
      }
    } catch (err) {
      log('Failed to fetch available tools for prompt:', err);
    }
    
    // If specific tools were requested, filter to those
    if (requestedTools && requestedTools.length > 0) {
      availableTools = availableTools.filter(t => requestedTools.includes(t));
    }
    
    if (availableTools.length > 0) {
      params.set('tools', JSON.stringify(availableTools));
    }
  }
  
  // Open as a popup window - increase height to accommodate tools
  const hasTools = params.has('tools');
  const fullUrl = `${promptUrl}?${params.toString()}`;
  log('Opening permission prompt window:', { fullUrl, hasTools });
  try {
    const win = await browser.windows.create({
      url: fullUrl,
      type: 'popup',
      width: 420,
      height: hasTools ? 600 : 500,
      focused: true,
    });
    log('Permission prompt window created:', win?.id);
  } catch (err) {
    log('Failed to open permission prompt:', err);
    pendingPermissionRequests.delete(promptId);
    sendError(port, requestId, createError('ERR_INTERNAL', 'Failed to show permission prompt'));
  }
}

// Handle permission prompt response (called from permission-prompt.ts)
export function handlePermissionPromptResponse(
  promptId: string,
  decision: 'allow-once' | 'allow-always' | 'deny',
  allowedTools?: string[]
): void {
  log('handlePermissionPromptResponse called:', { promptId, decision, allowedTools });
  const pending = pendingPermissionRequests.get(promptId);
  if (!pending) {
    log('No pending request for promptId:', promptId);
    return;
  }
  
  pendingPermissionRequests.delete(promptId);
  
  const { port, requestId, origin, scopes, tabId } = pending;
  log('Processing permission decision for:', { origin, scopes, requestId, tabId });
  
  (async () => {
    if (decision === 'deny') {
      log('Denying permissions');
      await denyPermissions(origin, scopes);
      const result = await buildGrantResult(origin, scopes);
      log('Sending deny result:', result);
      sendResponse(port, 'permissions_result', requestId, result);
      
      // BYOC: Handle denied MCP registration
      const pendingMcp = pendingMcpRegistrations.get(requestId);
      if (pendingMcp) {
        pendingMcpRegistrations.delete(requestId);
        sendResponse(port, 'mcp_register_result', requestId, {
          success: false,
          error: { code: 'USER_DENIED', message: 'User denied permission' }
        } as MCPRegistrationResult);
      }
      
      // BYOC: Handle denied chat open
      const pendingChat = pendingChatOpens.get(requestId);
      if (pendingChat) {
        pendingChatOpens.delete(requestId);
        sendResponse(port, 'chat_open_result', requestId, {
          success: false,
          error: { code: 'USER_DENIED', message: 'User denied permission' }
        } as ChatOpenResult);
      }
    } else {
      const mode = decision === 'allow-once' ? 'once' : 'always';
      log('Granting permissions with mode:', mode);
      // Pass tabId so temporary grants can be cleaned up when the tab closes
      await grantPermissions(origin, scopes, mode, { allowedTools, tabId });
      const result = await buildGrantResult(origin, scopes);
      log('Sending grant result:', result);
      sendResponse(port, 'permissions_result', requestId, result);
      
      // BYOC: Complete pending MCP registration
      const pendingMcp = pendingMcpRegistrations.get(requestId);
      if (pendingMcp) {
        pendingMcpRegistrations.delete(requestId);
        await completeMcpRegistration(pendingMcp.port, requestId, pendingMcp.origin, pendingMcp.payload);
      }
      
      // BYOC: Complete pending chat open
      const pendingChat = pendingChatOpens.get(requestId);
      if (pendingChat) {
        pendingChatOpens.delete(requestId);
        await completeChatOpen(pendingChat.port, requestId, pendingChat.origin, pendingChat.payload);
      }
    }
    
    // Notify sidebar to refresh permissions display
    try {
      await browser.runtime.sendMessage({ type: 'permissions_changed' });
    } catch {
      // Sidebar may not be open, ignore
    }
  })().catch(err => {
    log('Error handling permission response:', err);
    sendError(port, requestId, createError('ERR_INTERNAL', 'Failed to process permission decision'));
  });
}

// =============================================================================
// Request Handlers
// =============================================================================

async function handleRequestPermissions(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: { scopes: PermissionScope[]; reason?: string; tools?: string[] }
): Promise<void> {
  log('handleRequestPermissions called:', { origin, payload });
  const { scopes, reason, tools } = payload;
  
  // Filter to valid scopes
  const validScopes = scopes.filter(s => SCOPE_DESCRIPTIONS[s] !== undefined);
  log('Valid scopes:', validScopes);
  
  if (validScopes.length === 0) {
    log('No valid scopes, returning empty result');
    const result = await buildGrantResult(origin, []);
    sendResponse(port, 'permissions_result', requestId, result);
    return;
  }
  
  // Check for web:fetch - not implemented in v1
  if (validScopes.includes('web:fetch')) {
    log('web:fetch not implemented');
    sendError(port, requestId, createError(
      'ERR_NOT_IMPLEMENTED',
      'web:fetch permission is not implemented in v1'
    ));
    return;
  }
  
  // Check if all scopes are already granted
  const missing = await getMissingPermissions(origin, validScopes);
  log('Missing permissions:', missing);
  
  if (missing.length === 0) {
    log('All permissions already granted');
    const result = await buildGrantResult(origin, validScopes);
    sendResponse(port, 'permissions_result', requestId, result);
    return;
  }
  
  // Check if any are denied
  const status = await getPermissionStatus(origin);
  log('Current permission status:', status);
  const denied = missing.filter(s => status.scopes[s] === 'denied');
  log('Denied scopes:', denied);
  
  if (denied.length > 0) {
    // User previously denied - return current status without re-prompting
    log('Returning denied status without re-prompting');
    const result = await buildGrantResult(origin, validScopes);
    sendResponse(port, 'permissions_result', requestId, result);
    return;
  }
  
  // Show permission prompt for missing scopes (include requested tools)
  log('Opening permission prompt for:', missing);
  await showPermissionPrompt(port, requestId, origin, missing, reason, tools);
}

async function handleListPermissions(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string
): Promise<void> {
  const status = await getPermissionStatus(origin);
  sendResponse(port, 'list_permissions_result', requestId, status);
}

// =============================================================================
// LLM Provider Handlers
// =============================================================================

async function handleLLMListProviders(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string
): Promise<void> {
  // Require model:list permission
  if (!(await requirePermission(port, requestId, origin, 'model:list'))) {
    return;
  }
  
  try {
    const response = await listLLMProviders();
    
    if (response.type === 'error' || !response.providers) {
      sendError(port, requestId, createError('ERR_INTERNAL', response.error?.message || 'Failed to list providers'));
      return;
    }
    
    // Get the active provider to mark which one is default
    const activeResponse = await getActiveLLM();
    const activeProvider = activeResponse.provider;
    
    // Transform response to LLMProviderInfo[] format expected by JS API
    const providersWithDefault = response.providers.map(p => ({
      id: p.id,
      name: p.name,
      available: p.available,
      baseUrl: p.baseUrl,
      // Transform models from LLMModel[] to string[] (just IDs)
      models: Array.isArray(p.models) 
        ? p.models.map((m: { id?: string } | string) => typeof m === 'string' ? m : m.id || 'unknown')
        : undefined,
      isDefault: p.id === activeProvider,
      supportsTools: p.supportsTools,
    }));
    
    sendResponse(port, 'llm_list_providers_result', requestId, { providers: providersWithDefault });
  } catch (err) {
    log('LLM list providers error:', err);
    sendError(port, requestId, createError('ERR_INTERNAL', String(err)));
  }
}

async function handleLLMGetActive(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string
): Promise<void> {
  // Require model:list permission
  if (!(await requirePermission(port, requestId, origin, 'model:list'))) {
    return;
  }
  
  try {
    const response = await getActiveLLM();
    
    if (response.type === 'error') {
      sendError(port, requestId, createError('ERR_INTERNAL', response.error?.message || 'Failed to get active LLM'));
      return;
    }
    
    sendResponse(port, 'llm_get_active_result', requestId, {
      provider: response.provider ?? null,
      model: response.model ?? null,
    });
  } catch (err) {
    log('LLM get active error:', err);
    sendError(port, requestId, createError('ERR_INTERNAL', String(err)));
  }
}

async function handleCreateTextSession(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: { options?: TextSessionOptions }
): Promise<void> {
  // Require model:prompt permission
  if (!(await requirePermission(port, requestId, origin, 'model:prompt'))) {
    return;
  }
  
  const options = payload.options || {};
  const sessionId = generateSessionId();
  
  const session: TextSessionState = {
    id: sessionId,
    origin,
    options,
    messages: [],
    createdAt: Date.now(),
  };
  
  // Add system prompt if provided
  if (options.systemPrompt) {
    session.messages.push({ role: 'system', content: options.systemPrompt });
  }
  
  textSessions.set(sessionId, session);
  
  sendResponse(port, 'create_text_session_result', requestId, { sessionId });
}

async function handleTextSessionPrompt(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: { sessionId: string; input: string; streaming: boolean }
): Promise<void> {
  const { sessionId, input, streaming } = payload;
  
  const session = textSessions.get(sessionId);
  if (!session) {
    sendError(port, requestId, createError('ERR_SESSION_NOT_FOUND', 'Session not found'));
    return;
  }
  
  if (session.origin !== origin) {
    sendError(port, requestId, createError('ERR_PERMISSION_DENIED', 'Session belongs to different origin'));
    return;
  }
  
  // Add user message to session
  session.messages.push({ role: 'user', content: input });
  
  try {
    // Call LLM directly via exported function
    log('Calling llmChat with messages:', session.messages.length);
    const llmResponse = await llmChat({
      messages: session.messages.map(m => ({ role: m.role, content: m.content })),
      model: session.options.model,
      provider: session.options.provider,  // Pass provider if specified
      temperature: session.options.temperature,
      // No tools for basic text session
    });
    
    log('LLM response received:', llmResponse);
    
    // Handle undefined response (bridge not connected)
    if (!llmResponse) {
      sendError(port, requestId, createError('ERR_MODEL_FAILED', 'LLM not available - is the bridge connected?'));
      return;
    }
    
    if (llmResponse.type === 'error' || !llmResponse.response?.message?.content) {
      const errorMsg = llmResponse.error?.message || 'LLM request failed';
      sendError(port, requestId, createError('ERR_MODEL_FAILED', errorMsg));
      return;
    }
    
    const assistantContent = llmResponse.response.message.content;
    session.messages.push({ role: 'assistant', content: assistantContent });
    
    if (streaming) {
      // For streaming, we simulate token-by-token for now
      // TODO: Implement proper streaming from bridge
      const tokens = assistantContent.split(/(\s+)/);
      for (const token of tokens) {
        if (token) {
          sendResponse(port, 'text_session_stream_token', requestId, {
            requestId,
            token: { type: 'token', token },
          });
        }
      }
      sendResponse(port, 'text_session_stream_done', requestId, { requestId });
    } else {
      sendResponse(port, 'text_session_prompt_result', requestId, { result: assistantContent });
    }
  } catch (err) {
    log('LLM error:', err);
    sendError(port, requestId, createError('ERR_MODEL_FAILED', String(err)));
  }
}

async function handleTextSessionDestroy(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: { sessionId: string }
): Promise<void> {
  const { sessionId } = payload;
  
  const session = textSessions.get(sessionId);
  if (session && session.origin === origin) {
    textSessions.delete(sessionId);
  }
  
  sendResponse(port, 'text_session_destroy_result', requestId, { success: true });
}

async function handleToolsList(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string
): Promise<void> {
  log('[ToolsList] Request from origin:', origin);
  
  // Require mcp:tools.list permission
  if (!(await requirePermission(port, requestId, origin, 'mcp:tools.list'))) {
    log('[ToolsList] Permission denied for mcp:tools.list');
    return;
  }
  
  log('[ToolsList] Permission granted, fetching connections...');
  
  try {
    const allTools: ToolDescriptor[] = [];
    
    // First, add any website-registered tools for this origin
    const tabId = port.sender?.tab?.id;
    for (const [serverId, server] of websiteMcpServers) {
      // Include website tools if they're from the same origin or same tab
      if (server.origin === origin || server.tabId === tabId) {
        log(`[ToolsList] Including website server: ${serverId} with ${server.tools?.length || 0} tools`);
        
        // Add tools with proper format
        if (server.tools) {
          for (const toolName of server.tools) {
            allTools.push({
              name: `${serverId}/${toolName}`,
              description: `Website tool: ${toolName} from ${server.name}`,
              serverId,
              // Note: We don't have full schema for website tools yet
              // The page will handle validation
            });
          }
        }
      }
    }
    
    // Then get MCP server tools
    const connectionsResponse = await getMcpConnections();
    log('[ToolsList] Connections response:', JSON.stringify(connectionsResponse));
    
    if (connectionsResponse.type !== 'error' && connectionsResponse.connections) {
      log(`[ToolsList] Found ${connectionsResponse.connections.length} connected MCP servers`);
      
      // For each connected server, get its tools
      for (const conn of connectionsResponse.connections) {
        log(`[ToolsList] Server ${conn.serverId}: toolCount=${conn.toolCount}`);
        log(`[ToolsList] Getting tools from server: ${conn.serverId}`);
        const toolsResponse = await listMcpTools(conn.serverId);
        log(`[ToolsList] Tools response for ${conn.serverId}:`, JSON.stringify(toolsResponse));
        
        if (toolsResponse.tools) {
          for (const tool of toolsResponse.tools) {
            allTools.push({
              name: `${conn.serverId}/${tool.name}`,
              description: tool.description,
              inputSchema: tool.inputSchema,
              serverId: conn.serverId,
            });
          }
        }
      }
    }
    
    log(`[ToolsList] Total tools found: ${allTools.length}`);
    sendResponse(port, 'tools_list_result', requestId, { tools: allTools });
  } catch (err) {
    log('Tools list error:', err);
    sendError(port, requestId, createError('ERR_INTERNAL', String(err)));
  }
}

// Pending website tool calls
const pendingWebsiteToolCalls = new Map<string, {
  port: browser.Runtime.Port;
  requestId: string;
}>();

// Listen for website tool results from content scripts
browser.runtime.onMessage.addListener((message: { type: string; callId?: string; result?: unknown; error?: string }) => {
  if (message.type === 'website_tool_result' && message.callId) {
    const pending = pendingWebsiteToolCalls.get(message.callId);
    if (pending) {
      pendingWebsiteToolCalls.delete(message.callId);
      
      if (message.error) {
        sendError(pending.port, pending.requestId, createError('ERR_TOOL_FAILED', message.error));
      } else {
        sendResponse(pending.port, 'tools_call_result', pending.requestId, {
          success: true,
          result: message.result,
        });
      }
      log('[Tool Call] Website tool result received:', message.callId);
    }
  }
});

async function handleToolsCall(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: { tool: string; args: Record<string, unknown> }
): Promise<void> {
  // Require mcp:tools.call permission
  if (!(await requirePermission(port, requestId, origin, 'mcp:tools.call'))) {
    return;
  }
  
  const { tool, args } = payload;
  
  // Parse tool name: "serverId/toolName"
  const slashIndex = tool.indexOf('/');
  if (slashIndex === -1) {
    sendError(port, requestId, createError(
      'ERR_TOOL_NOT_ALLOWED',
      'Tool name must be in format "serverId/toolName"'
    ));
    return;
  }
  
  const serverId = tool.slice(0, slashIndex);
  const toolName = tool.slice(slashIndex + 1);
  
  // Check if this is a website-registered tool
  const websiteServer = websiteMcpServers.get(serverId);
  if (websiteServer) {
    log('[Tool Call] Website tool detected:', serverId, toolName);
    
    // Verify the tool belongs to the same origin or we have permission
    // For now, allow if the calling origin matches the server origin
    // or if we have mcp:tools.call permission
    
    const tabId = websiteServer.tabId;
    if (!tabId) {
      sendError(port, requestId, createError('ERR_TOOL_FAILED', 'Website tab not found'));
      return;
    }
    
    // Generate call ID
    const callId = `wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Store pending call
    pendingWebsiteToolCalls.set(callId, { port, requestId });
    
    // Set timeout
    setTimeout(() => {
      if (pendingWebsiteToolCalls.has(callId)) {
        pendingWebsiteToolCalls.delete(callId);
        sendError(port, requestId, createError('ERR_TOOL_FAILED', 'Website tool call timed out'));
      }
    }, 30000);
    
    try {
      // Send tool call request to content script
      await browser.tabs.sendMessage(tabId, {
        type: 'website_tool_call',
        callId,
        toolName,
        args,
      });
      log('[Tool Call] Sent to tab:', tabId, toolName);
    } catch (err) {
      pendingWebsiteToolCalls.delete(callId);
      sendError(port, requestId, createError('ERR_TOOL_FAILED', `Failed to call website tool: ${err}`));
    }
    
    return;
  }
  
  // Not a website tool - use normal MCP flow
  // Check if this specific tool is allowed for this origin
  const toolAllowed = await isToolAllowed(origin, tool);
  if (!toolAllowed) {
    const allowedTools = await getAllowedTools(origin);
    sendError(port, requestId, createError(
      'ERR_TOOL_NOT_ALLOWED',
      `Tool "${tool}" is not in the allowlist for this origin. Request permission with this tool first.`,
      { tool, allowedTools }
    ));
    return;
  }
  
  try {
    // Call the tool via MCP
    const callResponse = await browser.runtime.sendMessage({
      type: 'mcp_call_tool',
      server_id: serverId,
      tool_name: toolName,
      arguments: args,
    }) as { type: string; result?: unknown; error?: { message: string } };
    
    if (callResponse.type === 'error') {
      sendError(port, requestId, createError('ERR_TOOL_FAILED', callResponse.error?.message || 'Tool call failed'));
      return;
    }
    
    sendResponse(port, 'tools_call_result', requestId, {
      success: true,
      result: callResponse.result,
    });
  } catch (err) {
    log('Tool call error:', err);
    sendError(port, requestId, createError('ERR_TOOL_FAILED', String(err)));
  }
}

async function handleActiveTabRead(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string
): Promise<void> {
  // Require browser:activeTab.read permission
  if (!(await requirePermission(port, requestId, origin, 'browser:activeTab.read'))) {
    return;
  }
  
  // Note: In a full implementation, we would check for user gesture here
  // For v1, we trust the permission grant
  
  try {
    // Get the active tab
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    
    if (!activeTab?.id || !activeTab.url) {
      sendError(port, requestId, createError('ERR_INTERNAL', 'No active tab found'));
      return;
    }
    
    // Don't read from extension pages, about:, chrome:, etc.
    const url = new URL(activeTab.url);
    if (!['http:', 'https:'].includes(url.protocol)) {
      sendError(port, requestId, createError(
        'ERR_PERMISSION_DENIED',
        'Cannot read from this type of page'
      ));
      return;
    }
    
    // Inject content script to extract readable content
    const results = await browser.scripting.executeScript({
      target: { tabId: activeTab.id },
      func: extractReadableContent,
    });
    
    if (!results || results.length === 0 || !results[0].result) {
      sendError(port, requestId, createError('ERR_INTERNAL', 'Failed to extract content'));
      return;
    }
    
    const content = results[0].result as ActiveTabReadability;
    sendResponse(port, 'active_tab_read_result', requestId, content);
  } catch (err) {
    log('Active tab read error:', err);
    sendError(port, requestId, createError('ERR_INTERNAL', String(err)));
  }
}

// Content extraction function (injected into page)
function extractReadableContent(): ActiveTabReadability {
  // Clone the document to avoid modifying the actual page
  const clone = document.cloneNode(true) as Document;
  
  // Remove non-content elements
  const removeSelectors = [
    'script', 'style', 'noscript', 'iframe', 'object', 'embed',
    'nav', 'footer', 'header', 'aside',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '.nav', '.navigation', '.menu', '.sidebar', '.footer', '.header',
    '.advertisement', '.ad', '.ads', '.social-share',
  ];
  
  for (const selector of removeSelectors) {
    clone.querySelectorAll(selector).forEach(el => el.remove());
  }
  
  // Try to find main content
  const mainContent = clone.querySelector('main, article, [role="main"], .content, .post, .entry') 
    || clone.body;
  
  // Get text content
  let text = mainContent?.textContent || '';
  
  // Clean up whitespace
  text = text
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
  
  // Truncate to reasonable size (50k chars)
  const MAX_LENGTH = 50000;
  if (text.length > MAX_LENGTH) {
    text = text.slice(0, MAX_LENGTH) + '\n\n[Content truncated...]';
  }
  
  return {
    url: window.location.href,
    title: document.title,
    text,
  };
}

// =============================================================================
// Agent Run Handler - Uses Bridge Orchestrator
// =============================================================================
// This is the single, clean path for tool-enabled chat:
// 1. Create a chat session with connected servers
// 2. Send the message via chat_send_message (uses bridge orchestrator)
// 3. The bridge orchestrator handles:
//    - Text-based tool call parsing (for LLMs that output JSON as text)
//    - Tool execution via MCP
//    - Iteration until final response
// 4. Stream results back to the client
// 5. Clean up the session

async function handleAgentRun(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: { task: string; tools?: string[]; provider?: string; requireCitations?: boolean; maxToolCalls?: number }
): Promise<void> {
  console.log('🔧 handleAgentRun v2 - using bridge orchestrator');
  log('[AgentRun] Starting with task:', payload.task?.substring(0, 50));
  
  // Require model:tools permission
  if (!(await requirePermission(port, requestId, origin, 'model:tools'))) {
    return;
  }
  
  const { task, provider, requireCitations, maxToolCalls = 5 } = payload;
  
  // Note: provider selection is not yet implemented in chat sessions
  // TODO: Pass provider to createChatSession when bridge supports it
  if (provider) {
    log('[AgentRun] Provider specified:', provider, '(will use for future implementation)');
  }
  
  // Track this streaming request
  streamingRequests.set(requestId, { port, aborted: false });
  
  const sendEvent = (event: RunEvent): void => {
    const req = streamingRequests.get(requestId);
    if (req && !req.aborted) {
      sendResponse(port, 'agent_run_event', requestId, { requestId, event });
    }
  };
  
  let sessionId: string | null = null;
  
  try {
    sendEvent({ type: 'status', message: 'Initializing agent...' });
    
    // Get connected MCP servers using direct function call
    // (browser.runtime.sendMessage from background to itself doesn't work reliably)
    const connectionsResponse = await getMcpConnections();
    log('[AgentRun] Connections response:', connectionsResponse);
    
    // Handle error response
    if (connectionsResponse.type === 'error') {
      log('[AgentRun] Connections response error:', connectionsResponse);
      const errorMsg = connectionsResponse.error?.message || 'Unknown error listing MCP connections';
      sendEvent({ type: 'error', error: createError('ERR_INTERNAL', `Bridge error: ${errorMsg}`) });
      return;
    }
    
    // Check if we have any connected servers (chat can work without them, just no tools)
    const connections = connectionsResponse.connections || [];
    const enabledServers = connections.map(c => c.serverId);
    const totalTools = connections.reduce((sum, c) => sum + c.toolCount, 0);
    
    if (connections.length === 0) {
      log('[AgentRun] No MCP servers connected - will chat without tools');
      sendEvent({ type: 'status', message: 'No MCP servers connected - chatting without tools' });
    } else {
      sendEvent({ type: 'status', message: `Found ${totalTools} tools from ${enabledServers.length} servers` });
    }
    
    // Check if aborted
    const req = streamingRequests.get(requestId);
    if (!req || req.aborted) {
      sendEvent({ type: 'error', error: createError('ERR_INTERNAL', 'Request aborted') });
      return;
    }
    
    // Build custom system prompt if needed
    let systemPrompt: string | undefined;
    if (requireCitations) {
      systemPrompt = 'You are a helpful AI assistant. When using information from tools, cite your sources.';
    }
    
    // Create a temporary chat session with the connected servers
    const createResponse = await createChatSession({
      enabledServers,
      name: `Agent task: ${task.substring(0, 30)}...`,
      systemPrompt,
      maxIterations: maxToolCalls,
    });
    
    if (createResponse.type === 'error' || !createResponse.session?.id) {
      sendEvent({ type: 'error', error: createError('ERR_INTERNAL', createResponse.error?.message || 'Failed to create session') });
      return;
    }
    
    sessionId = createResponse.session.id;
    log('[AgentRun] Created session:', sessionId);
    
    // Check if aborted
    const req2 = streamingRequests.get(requestId);
    if (!req2 || req2.aborted) {
      sendEvent({ type: 'error', error: createError('ERR_INTERNAL', 'Request aborted') });
      return;
    }
    
    sendEvent({ type: 'status', message: 'Processing...' });
    
    // Send the message - the bridge orchestrator handles everything
    const chatResponse = await sendChatMessage({
      sessionId,
      message: task,
      // useToolRouter defaults to false - LLM sees all tools and decides
    });
    
    if (chatResponse.type === 'error') {
      sendEvent({ type: 'error', error: createError('ERR_INTERNAL', chatResponse.error?.message || 'Chat failed') });
      return;
    }
    
    // Stream the orchestration steps to the client
    const citations: Array<{ source: 'tab' | 'tool'; ref: string; excerpt: string }> = [];
    
    if (chatResponse.steps) {
      for (const step of chatResponse.steps) {
        // Check if aborted
        const req3 = streamingRequests.get(requestId);
        if (!req3 || req3.aborted) {
          sendEvent({ type: 'error', error: createError('ERR_INTERNAL', 'Request aborted') });
          return;
        }
        
        if (step.type === 'tool_calls' && step.toolCalls) {
          for (const tc of step.toolCalls) {
            sendEvent({ type: 'tool_call', tool: tc.name, args: tc.arguments });
          }
        }
        
        if (step.type === 'tool_results' && step.toolResults) {
          for (const tr of step.toolResults) {
            // Use full prefixed name to match tool_call event
            const fullToolName = tr.serverId ? `${tr.serverId}__${tr.toolName}` : tr.toolName;
            sendEvent({ 
              type: 'tool_result', 
              tool: fullToolName,
              result: tr.content,
              error: tr.isError ? createError('ERR_TOOL_FAILED', tr.content) : undefined,
            });
            
            if (requireCitations && !tr.isError) {
              citations.push({
                source: 'tool',
                ref: `${tr.serverId}/${tr.toolName}`,
                excerpt: tr.content.slice(0, 200),
              });
            }
          }
        }
        
        if (step.type === 'error' && step.error) {
          sendEvent({ type: 'error', error: createError('ERR_INTERNAL', step.error) });
          return;
        }
      }
    }
    
    // Get the final response
    const finalOutput = chatResponse.response || '';
    
    // Stream the output token by token for a nice effect
    const tokens = finalOutput.split(/(\s+)/);
    for (const token of tokens) {
      if (token) {
        sendEvent({ type: 'token', token });
        await new Promise(r => setTimeout(r, 10)); // Small delay for streaming effect
      }
    }
    
    sendEvent({ 
      type: 'final', 
      output: finalOutput,
      citations: requireCitations && citations.length > 0 ? citations : undefined,
    });
    
    if (chatResponse.reachedMaxIterations) {
      log('[AgentRun] Warning: reached max iterations');
    }
    
  } catch (err) {
    log('[AgentRun] Error:', err);
    sendEvent({ type: 'error', error: createError('ERR_INTERNAL', String(err)) });
  } finally {
    // Clean up the temporary session
    if (sessionId) {
      deleteChatSession(sessionId);
    }
    streamingRequests.delete(requestId);
  }
}

function handleAgentRunAbort(requestId: string): void {
  const req = streamingRequests.get(requestId);
  if (req) {
    req.aborted = true;
  }
}

// =============================================================================
// BYOC: MCP Server Registration Handlers
// =============================================================================

async function handleMcpDiscover(
  port: browser.Runtime.Port,
  requestId: string,
  _origin: string
): Promise<void> {
  // mcp_discover is handled in content-bridge.ts (parses <link> elements)
  // If it reaches here, return empty array (content script didn't intercept)
  sendResponse(port, 'mcp_discover_result', requestId, { servers: [] });
}

async function handleMcpRegister(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: MCPServerRegistration
): Promise<void> {
  log('[MCP Register] Request from origin:', origin, 'payload:', payload);
  
  // Check/request mcp:servers.register permission
  if (!(await hasPermission(origin, 'mcp:servers.register'))) {
    // Store pending registration and show permission prompt
    pendingMcpRegistrations.set(requestId, { port, origin, payload });
    await showPermissionPrompt(
      port,
      requestId,
      origin,
      ['mcp:servers.register'],
      `Register AI tools from "${payload.name}"`,
    );
    return;
  }
  
  // Permission granted - proceed with registration
  await completeMcpRegistration(port, requestId, origin, payload);
}

async function completeMcpRegistration(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: MCPServerRegistration
): Promise<void> {
  try {
    // Validate URL
    let url: URL;
    try {
      url = new URL(payload.url, origin);
    } catch {
      sendResponse(port, 'mcp_register_result', requestId, {
        success: false,
        error: { code: 'INVALID_URL', message: 'Invalid MCP server URL' }
      } as MCPRegistrationResult);
      return;
    }
    
    // For production, require HTTPS (allow localhost for development)
    if (url.protocol !== 'https:' && url.protocol !== 'wss:' && url.hostname !== 'localhost') {
      sendResponse(port, 'mcp_register_result', requestId, {
        success: false,
        error: { code: 'INVALID_URL', message: 'MCP server URL must use HTTPS' }
      } as MCPRegistrationResult);
      return;
    }
    
    // Generate server ID with origin namespace
    const originHost = new URL(origin).hostname;
    const serverId = `byoc__${originHost}__${Date.now()}`;
    
    log('[MCP Register] Attempting to connect to:', url.toString());
    
    // Try to connect to the MCP server via the bridge
    // First, add it as a temporary HTTP/SSE server
    try {
      const addResponse = await browser.runtime.sendMessage({
        type: 'add_remote_mcp',
        server_id: serverId,
        name: payload.name || `${originHost} MCP Server`,
        url: url.toString(),
        transport: payload.transport || 'sse',
        temporary: true, // Mark as temporary (clean up when tab closes)
        origin: origin,
      }) as { type: string; success?: boolean; error?: { message: string } };
      
      if (addResponse.type === 'error' || !addResponse.success) {
        log('[MCP Register] Bridge connection failed:', addResponse.error);
        // Fall back to postMessage-based tools (page implements tools directly)
        log('[MCP Register] Falling back to postMessage-based tools');
      } else {
        log('[MCP Register] Bridge connection successful:', serverId);
      }
    } catch (bridgeErr) {
      // Bridge not available or error - fall back to postMessage tools
      log('[MCP Register] Bridge error (using postMessage fallback):', bridgeErr);
    }
    
    // Store the registration (works with both bridge and postMessage approaches)
    websiteMcpServers.set(serverId, {
      origin,
      serverId,
      url: url.toString(),
      name: payload.name,
      description: payload.description,
      tools: payload.tools,
      tabId: port.sender?.tab?.id,
      connectedAt: Date.now(),
    });
    
    sendResponse(port, 'mcp_register_result', requestId, {
      success: true,
      serverId,
    } as MCPRegistrationResult);
  } catch (err) {
    log('[MCP Register] Error:', err);
    sendResponse(port, 'mcp_register_result', requestId, {
      success: false,
      error: { code: 'CONNECTION_FAILED', message: String(err) }
    } as MCPRegistrationResult);
  }
}

async function handleMcpUnregister(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: { serverId: string }
): Promise<void> {
  const server = websiteMcpServers.get(payload.serverId);
  
  // Only allow unregistering servers from the same origin
  if (!server || server.origin !== origin) {
    sendResponse(port, 'mcp_unregister_result', requestId, { success: false });
    return;
  }
  
  // TODO: Disconnect from bridge if connected
  
  websiteMcpServers.delete(payload.serverId);
  log('[MCP Unregister] Removed server:', payload.serverId);
  sendResponse(port, 'mcp_unregister_result', requestId, { success: true });
}

// =============================================================================
// BYOC: Chat UI Handlers
// =============================================================================

async function handleChatCanOpen(
  port: browser.Runtime.Port,
  requestId: string,
  _origin: string
): Promise<void> {
  // Check if page-chat injection is available
  // For now, always return 'readily' since we can inject page-chat
  sendResponse(port, 'chat_can_open_result', requestId, { availability: 'readily' });
}

async function handleChatOpen(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: ChatOpenOptions
): Promise<void> {
  log('[Chat Open] Request from origin:', origin);
  
  // Check/request chat:open permission
  if (!(await hasPermission(origin, 'chat:open'))) {
    pendingChatOpens.set(requestId, { port, origin, payload });
    await showPermissionPrompt(
      port,
      requestId,
      origin,
      ['chat:open'],
      'Open the AI chat assistant'
    );
    return;
  }
  
  // Permission granted - open the chat
  await completeChatOpen(port, requestId, origin, payload);
}

async function completeChatOpen(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: ChatOpenOptions
): Promise<void> {
  const tabId = port.sender?.tab?.id;
  if (!tabId) {
    sendResponse(port, 'chat_open_result', requestId, {
      success: false,
      error: { code: 'NOT_AVAILABLE', message: 'No tab context' }
    } as ChatOpenResult);
    return;
  }
  
  // Check if chat already open for this tab
  for (const [, session] of openChatSessions) {
    if (session.tabId === tabId) {
      sendResponse(port, 'chat_open_result', requestId, {
        success: false,
        error: { code: 'ALREADY_OPEN', message: 'Chat already open in this tab' }
      } as ChatOpenResult);
      return;
    }
  }
  
  // Generate chat ID
  const chatId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    // Inject page-chat configuration first
    await browser.scripting.executeScript({
      target: { tabId },
      func: (config: { chatId: string; options: ChatOpenOptions }) => {
        (window as unknown as { __harborPageChatConfig: unknown }).__harborPageChatConfig = {
          chatId: config.chatId,
          ...config.options,
        };
      },
      args: [{ chatId, options: payload }],
    });
    
    // Then inject the page-chat script
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['page-chat.js'],
    });
    
    // Store session
    openChatSessions.set(chatId, {
      origin,
      chatId,
      tabId,
      options: payload,
      openedAt: Date.now(),
    });
    
    log('[Chat Open] Chat opened:', chatId);
    sendResponse(port, 'chat_open_result', requestId, {
      success: true,
      chatId,
    } as ChatOpenResult);
  } catch (err) {
    log('[Chat Open] Error:', err);
    sendResponse(port, 'chat_open_result', requestId, {
      success: false,
      error: { code: 'NOT_AVAILABLE', message: String(err) }
    } as ChatOpenResult);
  }
}

async function handleChatClose(
  port: browser.Runtime.Port,
  requestId: string,
  origin: string,
  payload: { chatId?: string }
): Promise<void> {
  const tabId = port.sender?.tab?.id;
  
  // Find the chat session
  let chatToClose: string | undefined;
  
  if (payload.chatId) {
    const session = openChatSessions.get(payload.chatId);
    if (session && session.origin === origin) {
      chatToClose = payload.chatId;
    }
  } else {
    // Close any chat from this origin on this tab
    for (const [chatId, session] of openChatSessions) {
      if (session.origin === origin && session.tabId === tabId) {
        chatToClose = chatId;
        break;
      }
    }
  }
  
  if (!chatToClose || !tabId) {
    sendResponse(port, 'chat_close_result', requestId, { success: false });
    return;
  }
  
  try {
    // Send message to page-chat to close
    await browser.tabs.sendMessage(tabId, {
      type: 'harbor_chat_close',
      chatId: chatToClose,
    });
    
    openChatSessions.delete(chatToClose);
    log('[Chat Close] Chat closed:', chatToClose);
    sendResponse(port, 'chat_close_result', requestId, { success: true });
  } catch (err) {
    log('[Chat Close] Error:', err);
    sendResponse(port, 'chat_close_result', requestId, { success: false });
  }
}

// =============================================================================
// Message Router
// =============================================================================

function handleProviderMessage(
  port: browser.Runtime.Port,
  message: ProviderMessage & { origin: string; href?: string }
): void {
  const { type, requestId, payload, origin } = message;
  
  log('Handling message:', type, 'from', origin);
  
  switch (type) {
    case 'ping':
      sendResponse(port, 'pong', requestId, { version: '1.0.0' });
      break;
      
    case 'request_permissions':
      handleRequestPermissions(port, requestId, origin, payload as { scopes: PermissionScope[]; reason?: string });
      break;
      
    case 'list_permissions':
      handleListPermissions(port, requestId, origin);
      break;
    
    case 'llm_list_providers':
      handleLLMListProviders(port, requestId, origin);
      break;
      
    case 'llm_get_active':
      handleLLMGetActive(port, requestId, origin);
      break;
      
    case 'create_text_session':
      handleCreateTextSession(port, requestId, origin, payload as { options?: TextSessionOptions });
      break;
      
    case 'text_session_prompt':
    case 'text_session_prompt_streaming':
      handleTextSessionPrompt(port, requestId, origin, payload as { sessionId: string; input: string; streaming: boolean });
      break;
      
    case 'text_session_destroy':
      handleTextSessionDestroy(port, requestId, origin, payload as { sessionId: string });
      break;
      
    case 'tools_list':
      handleToolsList(port, requestId, origin);
      break;
      
    case 'tools_call':
      handleToolsCall(port, requestId, origin, payload as { tool: string; args: Record<string, unknown> });
      break;
      
    case 'active_tab_read':
      handleActiveTabRead(port, requestId, origin);
      break;
      
    case 'agent_run':
      handleAgentRun(port, requestId, origin, payload as { task: string; tools?: string[]; provider?: string; requireCitations?: boolean; maxToolCalls?: number });
      break;
      
    case 'agent_run_abort':
      handleAgentRunAbort((payload as { requestId: string }).requestId);
      break;
    
    // BYOC: MCP Server Registration
    case 'mcp_discover':
      handleMcpDiscover(port, requestId, origin);
      break;
      
    case 'mcp_register':
      handleMcpRegister(port, requestId, origin, payload as MCPServerRegistration);
      break;
      
    case 'mcp_unregister':
      handleMcpUnregister(port, requestId, origin, payload as { serverId: string });
      break;
    
    // BYOC: Chat UI
    case 'chat_can_open':
      handleChatCanOpen(port, requestId, origin);
      break;
      
    case 'chat_open':
      handleChatOpen(port, requestId, origin, payload as ChatOpenOptions);
      break;
      
    case 'chat_close':
      handleChatClose(port, requestId, origin, payload as { chatId?: string });
      break;
      
    default:
      sendError(port, requestId, createError('ERR_NOT_IMPLEMENTED', `Unknown message type: ${type}`));
  }
}

// =============================================================================
// Port Connection Handler
// =============================================================================

export function setupProviderRouter(): void {
  console.log('🚀 Harbor Provider Router v2 (using bridge orchestrator)');
  
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'provider-bridge') return;
    
    log('[Router] Provider bridge connected');
    
    port.onMessage.addListener((message: ProviderMessage & { origin: string }) => {
      if (message.namespace !== 'harbor-provider') return;
      handleProviderMessage(port, message);
    });
    
    port.onDisconnect.addListener(() => {
      log('Provider bridge disconnected');
      // Clean up any pending requests for this port
      for (const [promptId, pending] of pendingPermissionRequests) {
        if (pending.port === port) {
          pendingPermissionRequests.delete(promptId);
        }
      }
    });
  });
  
  // Clean up temporary grants when tabs close
  browser.tabs.onRemoved.addListener((tabId) => {
    clearTabGrants(tabId);
  });
  
  log('Provider router initialized');
}

// Export for permission prompt to use
export { pendingPermissionRequests };

