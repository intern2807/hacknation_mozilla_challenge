/**
 * Host API Handlers
 * 
 * Handles the Web Agent API permission system and tool execution.
 * This is the policy layer that enforces permissions, rate limits, etc.
 */

import * as M from '../message-types.js';
import { HandlerContext, MessageHandler, withErrorHandling, requireFields } from './context.js';
import {
  getMcpHost,
  GrantType,
  PermissionScope,
  grantPermission,
  revokePermission,
  checkPermission,
  getPermissions,
  expireTabGrants,
} from '../host/index.js';

// =============================================================================
// Permission Handlers
// =============================================================================

/**
 * Grant a permission to an origin.
 */
export const handleHostGrantPermission: MessageHandler = requireFields(
  ['origin', 'scope'],
  withErrorHandling('host_grant_permission_result', 'permission_error', async (ctx) => {
    const origin = ctx.message.origin as string;
    const scope = ctx.message.scope as PermissionScope;
    const grantType = (ctx.message.grant_type as GrantType) || GrantType.ALLOW_ONCE;

    await grantPermission(origin, 'default', scope, grantType, {
      tabId: ctx.message.tab_id as number | undefined,
      allowedTools: ctx.message.allowed_tools as string[] | undefined,
    });
    
    return { granted: true };
  })
);

/**
 * Revoke a permission from an origin.
 */
export const handleHostRevokePermission: MessageHandler = requireFields(
  ['origin', 'scope'],
  withErrorHandling('host_revoke_permission_result', 'permission_error', async (ctx) => {
    const origin = ctx.message.origin as string;
    const scope = ctx.message.scope as PermissionScope;

    await revokePermission(origin, 'default', scope);
    
    return { revoked: true };
  })
);

/**
 * Check if an origin has a permission.
 */
export const handleHostCheckPermission: MessageHandler = requireFields(
  ['origin', 'scope'],
  withErrorHandling('host_check_permission_result', 'permission_error', async (ctx) => {
    const origin = ctx.message.origin as string;
    const scope = ctx.message.scope as PermissionScope;

    const result = checkPermission(origin, 'default', scope);
    
    return {
      granted: result.granted,
      grant: result.grant,
      error: result.error,
    };
  })
);

/**
 * Get all permissions for an origin.
 */
export const handleHostGetPermissions: MessageHandler = requireFields(
  ['origin'],
  withErrorHandling('host_get_permissions_result', 'permission_error', async (ctx) => {
    const origin = ctx.message.origin as string;

    const grants = getPermissions(origin, 'default');
    
    return { grants };
  })
);

/**
 * Expire tab-scoped permissions when a tab closes.
 */
export const handleHostExpireTabGrants: MessageHandler = requireFields(
  ['tab_id'],
  withErrorHandling('host_expire_tab_grants_result', 'permission_error', async (ctx) => {
    const tabId = ctx.message.tab_id as number;

    const expired = expireTabGrants(tabId);
    
    return { expired };
  })
);

// =============================================================================
// Tool Handlers
// =============================================================================

/**
 * List tools (with permission enforcement).
 */
export const handleHostListTools: MessageHandler = requireFields(
  ['origin'],
  async (ctx) => {
    const origin = ctx.message.origin as string;

    try {
      const host = getMcpHost();
      const result = host.listTools(origin, {
        serverIds: ctx.message.server_ids as string[] | undefined,
      });

      if (result.error) {
        return {
          type: 'error',
          request_id: ctx.requestId,
          error: result.error,
        };
      }

      return ctx.result('host_list_tools_result', { tools: result.tools });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return ctx.error('host_error', msg);
    }
  }
);

/**
 * Call a tool (with permission and rate limit enforcement).
 */
export const handleHostCallTool: MessageHandler = requireFields(
  ['origin', 'tool_name'],
  async (ctx) => {
    const origin = ctx.message.origin as string;
    const toolName = ctx.message.tool_name as string;
    const args = (ctx.message.args || {}) as Record<string, unknown>;

    try {
      const host = getMcpHost();
      const result = await host.callTool(origin, toolName, args, {
        timeoutMs: ctx.message.timeout_ms as number | undefined,
        runId: ctx.message.run_id as string | undefined,
      });

      if (!result.ok) {
        return {
          type: 'error',
          request_id: ctx.requestId,
          error: result.error,
        };
      }

      return ctx.result('host_call_tool_result', {
        result: result.result,
        provenance: result.provenance,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return ctx.error('host_error', msg);
    }
  }
);

/**
 * Get Host statistics.
 */
export const handleHostGetStats: MessageHandler = withErrorHandling(
  'host_get_stats_result',
  'host_error',
  async (_ctx) => {
    const host = getMcpHost();
    const stats = host.getStats();
    return { stats };
  }
);

