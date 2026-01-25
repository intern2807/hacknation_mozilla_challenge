/**
 * LLM Module
 * 
 * Unified LLM provider management with support for:
 * - Native browser AI (Firefox ML, Chrome AI)
 * - Bridge providers (Ollama, OpenAI, Anthropic, etc.)
 */

// Types
export * from './types';

// Detection
export {
  detectFirefoxML,
  hasWllama,
  hasTransformersJS,
  getFirefoxML,
  createWllamaEngine,
  createTransformersEngine,
  onDownloadProgress,
  clearCapabilitiesCache,
} from './firefox-ml-provider';

// Registry
export {
  ProviderRegistry,
  getProviderRegistry,
  initializeProviderRegistry,
  getRuntimeCapabilities,
  listAllProviders,
  getBestRuntime,
  getBestProvider,
} from './provider-registry';

// Providers
export {
  FirefoxWllamaProvider,
  createFirefoxWllamaProvider,
  ChromeAIProvider,
  createChromeAIProvider,
  hasChromeAI,
} from './providers';

// Bridge client
export {
  initializeBridgeClient,
  bridgeRequest,
  bridgeStreamRequest,
  getBridgeConnectionState,
  checkBridgeHealth,
} from './bridge-client';

// Native bridge
export {
  connectNativeBridge,
  disconnectNativeBridge,
  isNativeBridgeReady,
  getConnectionState,
  onConnectionStateChange,
} from './native-bridge';
