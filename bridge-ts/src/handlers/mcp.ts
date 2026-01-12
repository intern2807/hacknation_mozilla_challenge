/**
 * MCP Connection Handlers
 * 
 * Handlers for MCP stdio server connections - listing, calling tools,
 * reading resources, and getting prompts.
 */

import { log } from '../native-messaging.js';
import { 
  MessageHandler, 
  HandlerContext,
  withErrorHandling,
  requireFields,
} from './context.js';

// =============================================================================
// Helper: Require Connected Server
// =============================================================================

/**
 * Wrap a handler to require the specified server to be connected.
 * Extracts server_id from the message and validates connection status.
 */
function requireConnected(
  resultType: string,
  handler: (ctx: HandlerContext, serverId: string) => Promise<object>
): MessageHandler {
  return requireFields(['server_id'], async (ctx) => {
    const serverId = ctx.message.server_id as string;
    
    if (!ctx.mcpManager.isConnected(serverId)) {
      return ctx.error('not_connected', `Not connected to server: ${serverId}`);
    }
    
    try {
      const data = await handler(ctx, serverId);
      return ctx.result(resultType, data);
    } catch (e) {
      log(`[${resultType}] Error: ${e}`);
      return ctx.error('mcp_error', String(e));
    }
  });
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Disconnect from an MCP server.
 */
export const handleMcpDisconnect: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling(
    'mcp_disconnect_result',
    'disconnect_error',
    async (ctx) => {
      const serverId = ctx.message.server_id as string;
      const disconnected = await ctx.mcpManager.disconnect(serverId);
      return { disconnected };
    }
  )
);

/**
 * List all active MCP connections.
 */
export const handleMcpListConnections: MessageHandler = withErrorHandling(
  'mcp_list_connections_result',
  'list_error',
  async (ctx) => {
    const connections = ctx.mcpManager.getAllConnections().map(conn => ({
      serverId: conn.serverId,
      serverName: conn.installedServer.name,
      connectionInfo: conn.connectionInfo,
      connectedAt: conn.connectedAt,
      toolCount: conn.tools.length,
      resourceCount: conn.resources.length,
      promptCount: conn.prompts.length,
      pid: ctx.mcpManager.getPid(conn.serverId),
    }));
    
    return { connections };
  }
);

/**
 * List tools from a connected MCP server.
 */
export const handleMcpListTools: MessageHandler = requireConnected(
  'mcp_list_tools_result',
  async (ctx, serverId) => {
    const tools = await ctx.mcpManager.listTools(serverId);
    return { tools };
  }
);

/**
 * List resources from a connected MCP server.
 */
export const handleMcpListResources: MessageHandler = requireConnected(
  'mcp_list_resources_result',
  async (ctx, serverId) => {
    const resources = await ctx.mcpManager.listResources(serverId);
    return { resources };
  }
);

/**
 * List prompts from a connected MCP server.
 */
export const handleMcpListPrompts: MessageHandler = requireConnected(
  'mcp_list_prompts_result',
  async (ctx, serverId) => {
    const prompts = await ctx.mcpManager.listPrompts(serverId);
    return { prompts };
  }
);

/**
 * Call a tool on a connected MCP server.
 */
export const handleMcpCallTool: MessageHandler = requireFields(
  ['tool_name'],
  requireConnected(
    'mcp_call_tool_result',
    async (ctx, serverId) => {
      const toolName = ctx.message.tool_name as string;
      const args = (ctx.message.arguments || {}) as Record<string, unknown>;
      const result = await ctx.mcpManager.callTool(serverId, toolName, args);
      return { result };
    }
  )
);

/**
 * Read a resource from a connected MCP server.
 */
export const handleMcpReadResource: MessageHandler = requireFields(
  ['uri'],
  requireConnected(
    'mcp_read_resource_result',
    async (ctx, serverId) => {
      const uri = ctx.message.uri as string;
      const resource = await ctx.mcpManager.readResource(serverId, uri);
      return { resource };
    }
  )
);

/**
 * Get a prompt from a connected MCP server.
 */
export const handleMcpGetPrompt: MessageHandler = requireFields(
  ['prompt_name'],
  requireConnected(
    'mcp_get_prompt_result',
    async (ctx, serverId) => {
      const promptName = ctx.message.prompt_name as string;
      const args = (ctx.message.arguments || {}) as Record<string, string>;
      const prompt = await ctx.mcpManager.getPrompt(serverId, promptName, args);
      return { prompt };
    }
  )
);

/**
 * Get stderr logs from a connected MCP server.
 */
export const handleMcpGetLogs: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling(
    'mcp_get_logs_result',
    'logs_error',
    async (ctx) => {
      const serverId = ctx.message.server_id as string;
      const logs = ctx.mcpManager.getStderrLog(serverId);
      const pid = ctx.mcpManager.getPid(serverId);
      return { logs, pid };
    }
  )
);

