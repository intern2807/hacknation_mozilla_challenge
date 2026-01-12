/**
 * Handler Context
 * 
 * Defines the context passed to message handlers and helper functions
 * for creating standardized responses. Includes utilities to reduce
 * boilerplate in handler implementations.
 */

import { ServerStore } from '../server-store.js';
import { McpClient } from '../mcp-client.js';
import { CatalogManager, CatalogClient } from '../catalog/index.js';
import { InstalledServerManager } from '../installer/index.js';
import { McpClientManager } from '../mcp/index.js';
import { LLMManager } from '../llm/index.js';
import { Message, ErrorResponse, ResultResponse } from '../types.js';
import { log } from '../native-messaging.js';

// =============================================================================
// Handler Context
// =============================================================================

/**
 * Context object passed to all message handlers.
 * Provides access to all singleton services needed for handling messages.
 */
export interface HandlerContext {
  /** The incoming message */
  message: Message;
  
  /** Request ID from the message (convenience accessor) */
  requestId: string;
  
  /** Server store (legacy HTTP servers) */
  store: ServerStore;
  
  /** MCP HTTP client (legacy) */
  client: McpClient;
  
  /** Catalog manager for browsing available servers */
  catalog: CatalogManager;
  
  /** Installed server manager for package-based servers */
  installer: InstalledServerManager;
  
  /** MCP stdio connection manager */
  mcpManager: McpClientManager;
  
  /** LLM provider manager */
  llmManager: LLMManager;
  
  /** Optional catalog client for worker architecture */
  catalogClient: CatalogClient | null;
  
  // Convenience methods bound to this context
  
  /** Create an error response for this request */
  error: (code: string, message: string, details?: unknown) => ErrorResponse;
  
  /** Create a success result response for this request */
  result: (type: string, data?: object) => ResultResponse;
}

/**
 * Handler function signature.
 * All handlers take a context and return a promise of a response.
 */
export type MessageHandler = (
  ctx: HandlerContext
) => Promise<ResultResponse | ErrorResponse>;

/**
 * Legacy handler function signature (for backwards compatibility during migration).
 * Will be removed once all handlers are migrated to use HandlerContext.
 */
export type LegacyMessageHandler = (
  message: Message,
  store: ServerStore,
  client: McpClient,
  catalog: CatalogManager,
  installer: InstalledServerManager,
  mcpManager: McpClientManager,
  llmManager: LLMManager
) => Promise<ResultResponse | ErrorResponse>;

// =============================================================================
// Response Helpers
// =============================================================================

/**
 * Create an error response.
 */
export function makeError(
  requestId: string,
  code: string,
  message: string,
  details?: unknown
): ErrorResponse {
  return {
    type: 'error',
    request_id: requestId,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/**
 * Create a success result response.
 */
export function makeResult(
  requestId: string,
  type: string,
  data: object = {}
): ResultResponse {
  return {
    type,
    request_id: requestId,
    ...data,
  } as ResultResponse;
}

// =============================================================================
// Handler Wrappers
// =============================================================================

/**
 * Create a HandlerContext from the legacy handler parameters.
 */
export function createContext(
  message: Message,
  store: ServerStore,
  client: McpClient,
  catalog: CatalogManager,
  installer: InstalledServerManager,
  mcpManager: McpClientManager,
  llmManager: LLMManager,
  catalogClient: CatalogClient | null
): HandlerContext {
  const requestId = message.request_id || '';
  
  return {
    message,
    requestId,
    store,
    client,
    catalog,
    installer,
    mcpManager,
    llmManager,
    catalogClient,
    error: (code, msg, details) => makeError(requestId, code, msg, details),
    result: (type, data) => makeResult(requestId, type, data),
  };
}

/**
 * Wrap a handler that uses HandlerContext to work with the legacy signature.
 * This allows gradual migration of handlers to the new pattern.
 */
export function wrapHandler(
  handler: MessageHandler,
  getCatalogClient: () => CatalogClient | null
): LegacyMessageHandler {
  return async (message, store, client, catalog, installer, mcpManager, llmManager) => {
    const ctx = createContext(
      message, store, client, catalog, installer, mcpManager, llmManager, getCatalogClient()
    );
    return handler(ctx);
  };
}

/**
 * Wrap a handler with automatic try-catch error handling.
 * Reduces boilerplate for handlers that just need to catch and report errors.
 * 
 * @param resultType - The result message type (e.g., 'catalog_get_result')
 * @param errorCode - The error code to use on failure
 * @param handler - The handler function that returns the result data
 */
export function withErrorHandling<T extends object>(
  resultType: string,
  errorCode: string,
  handler: (ctx: HandlerContext) => Promise<T>
): MessageHandler {
  return async (ctx: HandlerContext) => {
    try {
      const data = await handler(ctx);
      return ctx.result(resultType, data);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      log(`[${resultType}] Error: ${errorMsg}`);
      return ctx.error(errorCode, errorMsg);
    }
  };
}

/**
 * Wrap a handler that validates required message fields.
 * Returns an error if any required field is missing.
 * 
 * @param fields - Array of required field names
 * @param handler - The handler to call if validation passes
 */
export function requireFields(
  fields: string[],
  handler: MessageHandler
): MessageHandler {
  return async (ctx: HandlerContext) => {
    for (const field of fields) {
      if (ctx.message[field] === undefined) {
        return ctx.error('invalid_request', `Missing required field: '${field}'`);
      }
    }
    return handler(ctx);
  };
}

/**
 * Compose multiple handler wrappers.
 * Applies wrappers from right to left (innermost first).
 */
export function compose(
  ...wrappers: Array<(handler: MessageHandler) => MessageHandler>
): (handler: MessageHandler) => MessageHandler {
  return (handler) => wrappers.reduceRight((h, wrapper) => wrapper(h), handler);
}

