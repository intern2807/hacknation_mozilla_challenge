/**
 * Firefox ML Provider Detection
 * 
 * Detects Firefox's native ML capabilities:
 * - browser.trial.ml (Firefox 134+) - Transformers.js for embeddings
 * - browser.trial.ml.wllama (Firefox 142+) - llama.cpp via WASM for LLM
 */

import type { FirefoxCapabilities } from './types';

// =============================================================================
// Firefox ML API Types (from browser.trial.ml)
// =============================================================================

/** Firefox ML engine options */
interface FirefoxMLEngineOptions {
  modelId: string;
  taskName?: string;
  dtype?: 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'bnb4' | 'q4f16';
  device?: 'gpu' | 'cpu' | 'wasm';
}

/** Firefox ML engine */
interface FirefoxMLEngine {
  run(request: unknown): Promise<unknown>;
}

/** Firefox wllama options */
interface FirefoxWllamaOptions {
  modelId?: string;
  modelUrl?: string;
  contextSize?: number;
}

/** Firefox wllama chat message */
interface FirefoxWllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Firefox wllama chat options */
interface FirefoxWlamaChatOptions {
  messages: FirefoxWllamaMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
}

/** Firefox wllama engine */
interface FirefoxWllamaEngine {
  chat(options: FirefoxWlamaChatOptions): Promise<{ content: string }>;
  chatStream(options: FirefoxWlamaChatOptions): AsyncIterable<{ token: string; done?: boolean }>;
  unload(): Promise<void>;
}

/** Firefox ML API namespace */
interface FirefoxMLApi {
  createEngine(options: FirefoxMLEngineOptions): Promise<FirefoxMLEngine>;
  runEngine?(options: unknown): Promise<unknown>;
  deleteCachedModels?(): Promise<void>;
  onProgress?: {
    addListener(callback: (data: { progress: number; model: string }) => void): void;
    removeListener(callback: (data: { progress: number; model: string }) => void): void;
  };
  wllama?: {
    createEngine(options: FirefoxWllamaOptions): Promise<FirefoxWllamaEngine>;
    listModels?(): Promise<string[]>;
  };
}

/** Browser type with trial.ml */
interface BrowserWithML {
  trial?: {
    ml?: FirefoxMLApi;
  };
}

// =============================================================================
// Detection Functions
// =============================================================================

/** Cached capabilities to avoid repeated detection */
let cachedCapabilities: FirefoxCapabilities | null = null;

/**
 * Get the Firefox ML API if available
 */
export function getFirefoxML(): FirefoxMLApi | null {
  try {
    const browserGlobal = typeof browser !== 'undefined' ? browser : null;
    const ml = (browserGlobal as BrowserWithML | null)?.trial?.ml;
    return ml ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if Firefox Transformers.js (browser.trial.ml) is available
 */
export function hasTransformersJS(): boolean {
  const ml = getFirefoxML();
  return ml !== null && typeof ml.createEngine === 'function';
}

/**
 * Check if Firefox wllama (browser.trial.ml.wllama) is available
 */
export function hasWllama(): boolean {
  const ml = getFirefoxML();
  return ml?.wllama !== undefined && typeof ml.wllama.createEngine === 'function';
}

/**
 * Detect Firefox ML capabilities
 * 
 * @param forceRefresh - If true, bypass cache and re-detect
 */
export async function detectFirefoxML(forceRefresh = false): Promise<FirefoxCapabilities> {
  // Return cached result if available
  if (cachedCapabilities && !forceRefresh) {
    return cachedCapabilities;
  }

  const ml = getFirefoxML();
  
  if (!ml) {
    cachedCapabilities = {
      available: false,
      hasWllama: false,
      hasTransformers: false,
      supportsTools: false,
      models: [],
    };
    return cachedCapabilities;
  }

  const hasTransformers = typeof ml.createEngine === 'function';
  const wllamaAvailable = ml.wllama !== undefined && typeof ml.wllama.createEngine === 'function';
  
  // Try to list available wllama models
  let models: string[] = [];
  if (wllamaAvailable && ml.wllama?.listModels) {
    try {
      models = await ml.wllama.listModels();
    } catch (e) {
      console.debug('[Harbor] Could not list Firefox wllama models:', e);
      // Default models that are typically available
      models = ['llama-3.2-1b', 'llama-3.2-3b'];
    }
  }

  cachedCapabilities = {
    available: hasTransformers || wllamaAvailable,
    hasWllama: wllamaAvailable,
    hasTransformers,
    // wllama supports tool calling as of Firefox 142
    supportsTools: wllamaAvailable,
    models,
  };

  console.log('[Harbor] Firefox ML capabilities detected:', cachedCapabilities);
  return cachedCapabilities;
}

/**
 * Clear the capabilities cache
 */
export function clearCapabilitiesCache(): void {
  cachedCapabilities = null;
}

// =============================================================================
// Engine Creation Helpers
// =============================================================================

/**
 * Create a Firefox wllama engine for chat
 */
export async function createWllamaEngine(options?: FirefoxWllamaOptions): Promise<FirefoxWllamaEngine | null> {
  const ml = getFirefoxML();
  if (!ml?.wllama) {
    console.warn('[Harbor] Firefox wllama not available');
    return null;
  }

  try {
    const engine = await ml.wllama.createEngine(options ?? {});
    return engine;
  } catch (e) {
    console.error('[Harbor] Failed to create Firefox wllama engine:', e);
    return null;
  }
}

/**
 * Create a Firefox Transformers.js engine
 */
export async function createTransformersEngine(options: FirefoxMLEngineOptions): Promise<FirefoxMLEngine | null> {
  const ml = getFirefoxML();
  if (!ml) {
    console.warn('[Harbor] Firefox ML not available');
    return null;
  }

  try {
    const engine = await ml.createEngine(options);
    return engine;
  } catch (e) {
    console.error('[Harbor] Failed to create Firefox ML engine:', e);
    return null;
  }
}

// =============================================================================
// Progress Tracking
// =============================================================================

type ProgressCallback = (data: { progress: number; model: string }) => void;

/**
 * Add a listener for model download progress
 */
export function onDownloadProgress(callback: ProgressCallback): () => void {
  const ml = getFirefoxML();
  if (!ml?.onProgress) {
    return () => {};
  }

  ml.onProgress.addListener(callback);
  return () => ml.onProgress?.removeListener(callback);
}

// =============================================================================
// Re-export types for convenience
// =============================================================================

export type {
  FirefoxMLApi,
  FirefoxMLEngine,
  FirefoxMLEngineOptions,
  FirefoxWllamaEngine,
  FirefoxWllamaOptions,
  FirefoxWllamaMessage,
  FirefoxWlamaChatOptions,
};
