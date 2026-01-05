/**
 * Provider Registry - A clean abstraction layer for catalog data sources.
 * 
 * This module provides a pluggable architecture for different catalog providers.
 * Each provider can be independently developed, tested, and replaced.
 * 
 * DESIGN GOALS:
 * - Easy to add new providers (just implement CatalogProvider interface)
 * - Easy to replace/disable providers at runtime
 * - Clean separation between discovery, enrichment, and storage
 * - Support for different data sources (APIs, scraping, local files)
 * 
 * FUTURE CONSIDERATIONS:
 * - Could be replaced with a cloud-hosted registry service
 * - Could add caching layers per provider
 * - Could add rate limiting per provider
 * - Could add OAuth/API keys per provider
 */

import { CatalogProvider, ProviderResult } from './base.js';
import { OfficialRegistryProvider } from './official-registry.js';
import { GitHubAwesomeProvider } from './github-awesome.js';
import { log } from '../native-messaging.js';

export interface ProviderConfig {
  /** Whether this provider is enabled */
  enabled: boolean;
  /** Provider priority for deduplication (higher = preferred) */
  priority: number;
  /** Custom configuration options */
  options?: Record<string, unknown>;
}

export interface ProviderRegistryConfig {
  providers: Record<string, ProviderConfig>;
}

const DEFAULT_CONFIG: ProviderRegistryConfig = {
  providers: {
    official_registry: { enabled: true, priority: 100 },
    github_awesome: { enabled: true, priority: 50 },
  },
};

/**
 * Registry for managing catalog providers.
 * 
 * This is the main extension point for adding new data sources.
 * To add a new provider:
 * 
 * 1. Create a class that extends CatalogProvider
 * 2. Implement fetch() to return server data
 * 3. Register it with providerRegistry.register(new MyProvider())
 */
export class ProviderRegistry {
  private providers: Map<string, CatalogProvider> = new Map();
  private config: ProviderRegistryConfig;

  constructor(config: ProviderRegistryConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.registerBuiltinProviders();
  }

  private registerBuiltinProviders(): void {
    // Built-in providers - can be disabled via config
    this.register(new OfficialRegistryProvider());
    this.register(new GitHubAwesomeProvider());
  }

  /**
   * Register a new provider.
   * 
   * @param provider - The provider instance to register
   * @param config - Optional configuration override
   */
  register(provider: CatalogProvider, config?: ProviderConfig): void {
    this.providers.set(provider.id, provider);
    
    if (config) {
      this.config.providers[provider.id] = config;
    } else if (!this.config.providers[provider.id]) {
      // Default config for new providers
      this.config.providers[provider.id] = { enabled: true, priority: 0 };
    }

    log(`[ProviderRegistry] Registered provider: ${provider.id}`);
  }

  /**
   * Unregister a provider.
   */
  unregister(providerId: string): boolean {
    const removed = this.providers.delete(providerId);
    if (removed) {
      log(`[ProviderRegistry] Unregistered provider: ${providerId}`);
    }
    return removed;
  }

  /**
   * Get a specific provider by ID.
   */
  get(providerId: string): CatalogProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get all enabled providers, sorted by priority.
   */
  getEnabled(): CatalogProvider[] {
    return Array.from(this.providers.values())
      .filter(p => this.config.providers[p.id]?.enabled !== false)
      .sort((a, b) => {
        const priorityA = this.config.providers[a.id]?.priority ?? 0;
        const priorityB = this.config.providers[b.id]?.priority ?? 0;
        return priorityB - priorityA; // Higher priority first
      });
  }

  /**
   * Get all registered provider IDs.
   */
  getIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Enable or disable a provider.
   */
  setEnabled(providerId: string, enabled: boolean): void {
    if (this.config.providers[providerId]) {
      this.config.providers[providerId].enabled = enabled;
    }
  }

  /**
   * Fetch from all enabled providers concurrently.
   */
  async fetchAll(query?: string): Promise<ProviderResult[]> {
    const enabledProviders = this.getEnabled();
    
    log(`[ProviderRegistry] Fetching from ${enabledProviders.length} providers`);
    
    const results = await Promise.allSettled(
      enabledProviders.map(p => p.fetch(query))
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const provider = enabledProviders[i];
        log(`[ProviderRegistry] ${provider.id} failed: ${result.reason}`);
        return {
          providerId: provider.id,
          providerName: provider.name,
          ok: false,
          servers: [],
          error: String(result.reason),
          fetchedAt: Date.now(),
        };
      }
    });
  }

  /**
   * Get configuration for a provider.
   */
  getConfig(providerId: string): ProviderConfig | undefined {
    return this.config.providers[providerId];
  }

  /**
   * Update configuration for a provider.
   */
  updateConfig(providerId: string, config: Partial<ProviderConfig>): void {
    if (!this.config.providers[providerId]) {
      this.config.providers[providerId] = { enabled: true, priority: 0 };
    }
    Object.assign(this.config.providers[providerId], config);
  }
}

// Singleton instance
let _registry: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!_registry) {
    _registry = new ProviderRegistry();
  }
  return _registry;
}

/**
 * Reset the registry (useful for testing).
 */
export function resetProviderRegistry(): void {
  _registry = null;
}


