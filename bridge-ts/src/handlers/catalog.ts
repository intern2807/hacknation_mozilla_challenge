/**
 * Catalog Handlers
 * 
 * Handlers for browsing and searching the MCP server catalog.
 * Demonstrates the new handler patterns with reduced boilerplate.
 */

import { log } from '../native-messaging.js';
import { CatalogClient } from '../catalog/index.js';
import { 
  MessageHandler, 
  HandlerContext, 
  withErrorHandling,
  requireFields,
} from './context.js';

// =============================================================================
// Module State
// =============================================================================

// Reference to the catalog client for worker architecture
let _catalogClient: CatalogClient | null = null;

export function setCatalogClient(client: CatalogClient): void {
  _catalogClient = client;
  log('[CatalogHandlers] Using catalog worker architecture');
}

export function getCatalogClientRef(): CatalogClient | null {
  return _catalogClient;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Apply search filter to catalog servers.
 */
function filterByQuery<T extends { name: string; description?: string; tags?: string[] }>(
  servers: T[], 
  query?: string
): T[] {
  if (!query || servers.length === 0) return servers;
  
  const searchTerm = query.toLowerCase();
  return servers.filter(s => 
    s.name.toLowerCase().includes(searchTerm) ||
    s.description?.toLowerCase().includes(searchTerm) ||
    s.tags?.some(t => t.toLowerCase().includes(searchTerm))
  );
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * Get the catalog, optionally forcing a refresh.
 */
export const handleCatalogGet: MessageHandler = withErrorHandling(
  'catalog_get_result',
  'catalog_error',
  async (ctx) => {
    const force = ctx.message.force as boolean || false;
    const query = ctx.message.query as string | undefined;

    // Use worker client if available
    if (_catalogClient) {
      if (force) {
        await _catalogClient.refresh(true);
      }
      const result = _catalogClient.getCatalog();
      if (query) {
        result.servers = filterByQuery(result.servers, query);
      }
      return result;
    }
    
    // Fall back to single-process CatalogManager
    log(`[handleCatalogGet] Using CatalogManager fallback (no worker)`);
    let result = await ctx.catalog.getCached();
    log(`[handleCatalogGet] Cache has ${result.servers.length} servers, isStale=${result.isStale}`);
    
    // If cache is empty/stale or force refresh requested, fetch from providers
    if (force || result.servers.length === 0 || result.isStale) {
      log(`[handleCatalogGet] Refreshing from providers...`);
      result = await ctx.catalog.refresh({ force: true, query });
      log(`[handleCatalogGet] After refresh: ${result.servers.length} servers`);
    }
    
    result.servers = filterByQuery(result.servers, query);
    return result;
  }
);

/**
 * Force refresh the catalog from all providers.
 */
export const handleCatalogRefresh: MessageHandler = withErrorHandling(
  'catalog_refresh_result',
  'catalog_error',
  async (ctx) => {
    const query = ctx.message.query as string | undefined;

    // Use worker client if available
    if (_catalogClient) {
      await _catalogClient.refresh(true);
      const result = _catalogClient.getCatalog();
      result.servers = filterByQuery(result.servers, query);
      return result;
    }
    
    // Fall back to single-process CatalogManager
    const result = await ctx.catalog.refresh({ force: true, query });
    result.servers = filterByQuery(result.servers, query);
    return result;
  }
);

/**
 * Enrich all catalog entries with additional metadata.
 */
export const handleCatalogEnrich: MessageHandler = withErrorHandling(
  'catalog_enrich_result',
  'enrich_error',
  async (ctx) => {
    log('[handleCatalogEnrich] Starting full enrichment...');
    
    // Use worker client if available
    if (_catalogClient) {
      return await _catalogClient.enrich();
    }
    
    // Fall back to single-process CatalogManager
    const result = await ctx.catalog.enrichAll();
    return {
      enriched: result.enriched,
      failed: result.failed,
    };
  }
);

/**
 * Search the catalog for servers matching a query.
 */
export const handleCatalogSearch: MessageHandler = requireFields(
  ['query'],
  withErrorHandling(
    'catalog_search_result',
    'catalog_error',
    async (ctx) => {
      const query = ctx.message.query as string;
      return await ctx.catalog.search(query);
    }
  )
);
