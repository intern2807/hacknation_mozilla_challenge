/**
 * Provider Registry
 * 
 * Unified provider management with fallback chain:
 * 1. User-specified provider (explicit)
 * 2. User's configured default provider
 * 3. Native browser AI (Firefox wllama, Chrome AI) if available
 * 4. Bridge providers (Ollama, OpenAI, Anthropic, etc.)
 */

import type {
  LLMProvider,
  LLMProviderInfo,
  RuntimeCapabilities,
  FirefoxCapabilities,
  ChromeCapabilities,
  HarborCapabilities,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamToken,
} from './types';
import { detectFirefoxML, clearCapabilitiesCache as clearFirefoxCache } from './firefox-ml-provider';
import { isNativeBridgeReady } from './native-bridge';
import { bridgeRequest } from './bridge-client';

// =============================================================================
// Chrome AI Detection
// =============================================================================

/** Chrome AI API types */
interface ChromeAI {
  canCreateTextSession?(): Promise<'readily' | 'after-download' | 'no'>;
  languageModel?: {
    capabilities?(): Promise<{ available: string }>;
    create?(options?: unknown): Promise<unknown>;
  };
}

/**
 * Detect Chrome AI capabilities
 */
async function detectChromeAI(): Promise<ChromeCapabilities | null> {
  try {
    // Check for Chrome's window.ai
    const windowAi = (globalThis as { ai?: ChromeAI }).ai;
    
    if (!windowAi) {
      return null;
    }

    // Check if it's actually Chrome AI (not our injected API)
    // Chrome AI has languageModel.capabilities
    if (!windowAi.languageModel?.capabilities) {
      return null;
    }

    const caps = await windowAi.languageModel.capabilities();
    const available = caps.available === 'readily' || caps.available === 'after-download';

    return {
      available,
      supportsTools: false, // Chrome AI doesn't support tools as of now
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Provider Registry Class
// =============================================================================

/** Provider selection request */
interface ProviderRequest {
  /** Explicit provider ID to use */
  provider?: string;
  /** Whether tools are required */
  requiresTools?: boolean;
  /** Whether streaming is required */
  requiresStreaming?: boolean;
  /** Request type for routing */
  type?: 'chat' | 'embedding' | 'agent';
}

/**
 * Provider Registry
 * 
 * Manages all available LLM providers and handles selection/fallback logic.
 */
export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private defaultProviderId: string | null = null;
  private firefoxCapabilities: FirefoxCapabilities | null = null;
  private chromeCapabilities: ChromeCapabilities | null = null;
  private initialized = false;

  /**
   * Initialize the registry by detecting all available providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('[Harbor] Initializing provider registry...');

    // Detect native browser capabilities
    await this.refreshCapabilities();

    this.initialized = true;
    console.log('[Harbor] Provider registry initialized');
  }

  /**
   * Refresh capability detection for all runtimes
   */
  async refreshCapabilities(): Promise<void> {
    // Detect Firefox ML
    clearFirefoxCache();
    this.firefoxCapabilities = await detectFirefoxML();

    // Detect Chrome AI
    this.chromeCapabilities = await detectChromeAI();

    console.log('[Harbor] Capabilities refreshed:', {
      firefox: this.firefoxCapabilities,
      chrome: this.chromeCapabilities,
    });
  }

  /**
   * Register a provider instance
   */
  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
    console.log(`[Harbor] Registered provider: ${provider.id} (${provider.type})`);
  }

  /**
   * Unregister a provider instance
   */
  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  /**
   * Get a specific provider by ID
   */
  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Set the default provider ID
   */
  setDefault(providerId: string): void {
    if (!this.providers.has(providerId) && providerId !== 'bridge') {
      console.warn(`[Harbor] Provider ${providerId} not found, setting default anyway`);
    }
    this.defaultProviderId = providerId;
  }

  /**
   * Get runtime capabilities for all providers
   */
  async getCapabilities(): Promise<RuntimeCapabilities> {
    // Refresh if not initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Get bridge providers
    let bridgeProviders: string[] = [];
    let bridgeConnected = false;

    if (isNativeBridgeReady()) {
      bridgeConnected = true;
      try {
        const result = await bridgeRequest<{ providers: Array<{ id: string }> }>('llm.list_providers');
        bridgeProviders = result.providers.map(p => p.id);
      } catch (e) {
        console.debug('[Harbor] Could not list bridge providers:', e);
      }
    }

    const harbor: HarborCapabilities = {
      available: bridgeConnected || this.providers.size > 0,
      bridgeConnected,
      providers: bridgeProviders,
    };

    return {
      firefox: this.firefoxCapabilities,
      chrome: this.chromeCapabilities,
      harbor,
    };
  }

  /**
   * List all available providers with their info
   */
  async listProviders(): Promise<LLMProviderInfo[]> {
    const providers: LLMProviderInfo[] = [];

    // Add native Firefox providers
    if (this.firefoxCapabilities?.hasWllama) {
      providers.push({
        id: 'firefox-wllama',
        type: 'firefox-wllama',
        name: 'Firefox Local AI',
        available: true,
        models: this.firefoxCapabilities.models,
        isDefault: this.defaultProviderId === 'firefox-wllama',
        supportsTools: this.firefoxCapabilities.supportsTools,
        supportsStreaming: true,
        isNative: true,
        runtime: 'firefox',
      });
    }

    if (this.firefoxCapabilities?.hasTransformers) {
      providers.push({
        id: 'firefox-transformers',
        type: 'firefox-transformers',
        name: 'Firefox ML (Transformers.js)',
        available: true,
        isDefault: this.defaultProviderId === 'firefox-transformers',
        supportsTools: false,
        supportsStreaming: false,
        isNative: true,
        runtime: 'firefox',
      });
    }

    // Add Chrome AI provider
    if (this.chromeCapabilities?.available) {
      providers.push({
        id: 'chrome',
        type: 'chrome',
        name: 'Chrome Built-in AI',
        available: true,
        isDefault: this.defaultProviderId === 'chrome',
        supportsTools: this.chromeCapabilities.supportsTools,
        supportsStreaming: true,
        isNative: true,
        runtime: 'chrome',
      });
    }

    // Add registered providers
    for (const provider of this.providers.values()) {
      const info = await provider.getInfo();
      providers.push({
        ...info,
        isDefault: this.defaultProviderId === provider.id,
      });
    }

    // Add bridge providers if connected
    if (isNativeBridgeReady()) {
      try {
        const result = await bridgeRequest<{
          providers: Array<{
            id: string;
            name: string;
            available: boolean;
            models?: string[];
            supportsTools?: boolean;
          }>;
        }>('llm.list_providers');

        for (const bp of result.providers) {
          // Don't duplicate if already registered
          if (!providers.some(p => p.id === bp.id)) {
            providers.push({
              id: bp.id,
              type: bp.id,
              name: bp.name,
              available: bp.available,
              models: bp.models,
              isDefault: this.defaultProviderId === bp.id,
              supportsTools: bp.supportsTools ?? false,
              supportsStreaming: true,
              isNative: false,
              runtime: 'bridge',
            });
          }
        }
      } catch (e) {
        console.debug('[Harbor] Could not list bridge providers:', e);
      }
    }

    return providers;
  }

  /**
   * Get the best available provider for a request
   * 
   * Selection priority:
   * 1. User-specified provider (explicit)
   * 2. User's configured default provider
   * 3. Native browser AI (Firefox wllama, Chrome AI) if available and suitable
   * 4. Bridge providers
   */
  async getBestProvider(request: ProviderRequest = {}): Promise<string | null> {
    // 1. Explicit provider requested
    if (request.provider) {
      return request.provider;
    }

    // 2. User's configured default
    if (this.defaultProviderId) {
      // Check if it meets requirements
      if (await this.providerMeetsRequirements(this.defaultProviderId, request)) {
        return this.defaultProviderId;
      }
    }

    // 3. Try native browser AI for chat (privacy-first)
    if (request.type !== 'agent' || !request.requiresTools) {
      // Firefox wllama for chat
      if (this.firefoxCapabilities?.hasWllama) {
        if (!request.requiresTools || this.firefoxCapabilities.supportsTools) {
          return 'firefox-wllama';
        }
      }

      // Chrome AI as fallback
      if (this.chromeCapabilities?.available) {
        if (!request.requiresTools || this.chromeCapabilities.supportsTools) {
          return 'chrome';
        }
      }
    }

    // 4. Bridge providers
    if (isNativeBridgeReady()) {
      try {
        const result = await bridgeRequest<{ provider: string | null }>('llm.get_active');
        if (result.provider) {
          return result.provider;
        }
      } catch {
        // Fall through
      }

      // Return first available bridge provider
      try {
        const result = await bridgeRequest<{
          providers: Array<{ id: string; available: boolean; supportsTools?: boolean }>;
        }>('llm.list_providers');

        for (const bp of result.providers) {
          if (bp.available && (!request.requiresTools || bp.supportsTools)) {
            return bp.id;
          }
        }
      } catch {
        // Fall through
      }
    }

    return null;
  }

  /**
   * Get the best runtime identifier
   */
  async getBestRuntime(): Promise<'firefox' | 'chrome' | 'harbor' | null> {
    // Check Firefox first (privacy-first local inference)
    if (this.firefoxCapabilities?.hasWllama) {
      return 'firefox';
    }

    // Check Chrome AI
    if (this.chromeCapabilities?.available) {
      return 'chrome';
    }

    // Check Harbor bridge
    if (isNativeBridgeReady()) {
      return 'harbor';
    }

    // Check if any registered providers are available
    for (const provider of this.providers.values()) {
      if (await provider.isAvailable()) {
        return 'harbor';
      }
    }

    return null;
  }

  /**
   * Check if a provider meets the request requirements
   */
  private async providerMeetsRequirements(
    providerId: string,
    request: ProviderRequest,
  ): Promise<boolean> {
    // Check native providers
    if (providerId === 'firefox-wllama') {
      if (request.requiresTools && !this.firefoxCapabilities?.supportsTools) {
        return false;
      }
      return this.firefoxCapabilities?.hasWllama ?? false;
    }

    if (providerId === 'firefox-transformers') {
      // Transformers.js doesn't support chat/tools
      if (request.type === 'chat' || request.requiresTools) {
        return false;
      }
      return this.firefoxCapabilities?.hasTransformers ?? false;
    }

    if (providerId === 'chrome') {
      if (request.requiresTools && !this.chromeCapabilities?.supportsTools) {
        return false;
      }
      return this.chromeCapabilities?.available ?? false;
    }

    // Check registered providers
    const provider = this.providers.get(providerId);
    if (provider) {
      if (request.requiresTools && !provider.supportsTools()) {
        return false;
      }
      if (request.requiresStreaming && !provider.supportsStreaming()) {
        return false;
      }
      return provider.isAvailable();
    }

    // Assume bridge providers are available if bridge is connected
    return isNativeBridgeReady();
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let registryInstance: ProviderRegistry | null = null;

/**
 * Get the global provider registry instance
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!registryInstance) {
    registryInstance = new ProviderRegistry();
  }
  return registryInstance;
}

/**
 * Initialize the provider registry
 */
export async function initializeProviderRegistry(): Promise<ProviderRegistry> {
  const registry = getProviderRegistry();
  await registry.initialize();
  return registry;
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Get runtime capabilities
 */
export async function getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  const registry = getProviderRegistry();
  return registry.getCapabilities();
}

/**
 * List all available providers
 */
export async function listAllProviders(): Promise<LLMProviderInfo[]> {
  const registry = getProviderRegistry();
  return registry.listProviders();
}

/**
 * Get the best available runtime
 */
export async function getBestRuntime(): Promise<'firefox' | 'chrome' | 'harbor' | null> {
  const registry = getProviderRegistry();
  return registry.getBestRuntime();
}

/**
 * Get the best provider for a request
 */
export async function getBestProvider(request?: ProviderRequest): Promise<string | null> {
  const registry = getProviderRegistry();
  return registry.getBestProvider(request);
}
