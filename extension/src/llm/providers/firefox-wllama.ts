/**
 * Firefox Wllama Provider
 * 
 * LLM provider using Firefox's native wllama API (Firefox 142+).
 * Uses llama.cpp compiled to WebAssembly for local inference.
 */

import type {
  LLMProvider,
  LLMProviderInfo,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  StreamToken,
  ProviderConfig,
} from '../types';
import {
  hasWllama,
  createWllamaEngine,
  type FirefoxWllamaEngine,
  type FirefoxWllamaMessage,
} from '../firefox-ml-provider';

// =============================================================================
// Firefox Wllama Provider Implementation
// =============================================================================

export class FirefoxWllamaProvider implements LLMProvider {
  readonly id = 'firefox-wllama';
  readonly type = 'firefox-wllama' as const;
  readonly name = 'Firefox Local AI';
  readonly runtime = 'firefox' as const;
  readonly isNative = true;

  private engine: FirefoxWllamaEngine | null = null;
  private config: ProviderConfig;
  private currentModel: string | null = null;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Check if Firefox wllama is available
   */
  async isAvailable(): Promise<boolean> {
    return hasWllama();
  }

  /**
   * Get provider info
   */
  async getInfo(): Promise<LLMProviderInfo> {
    const available = await this.isAvailable();
    const models = await this.listModels();

    return {
      id: this.id,
      type: this.type,
      name: this.name,
      available,
      models,
      isDefault: false,
      supportsTools: this.supportsTools(),
      supportsStreaming: this.supportsStreaming(),
      isNative: true,
      runtime: 'firefox',
    };
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    // Default models typically available in Firefox wllama
    // TODO: Call browser.trial.ml.wllama.listModels() when available
    return ['llama-3.2-1b', 'llama-3.2-3b', 'phi-3-mini', 'gemma-2b'];
  }

  /**
   * Firefox wllama supports tool calling as of Firefox 142
   */
  supportsTools(): boolean {
    return true;
  }

  /**
   * Firefox wllama supports streaming
   */
  supportsStreaming(): boolean {
    return true;
  }

  /**
   * Ensure engine is created
   */
  private async ensureEngine(model?: string): Promise<FirefoxWllamaEngine> {
    const targetModel = model || this.config.defaultModel || 'llama-3.2-1b';

    // Re-create engine if model changed
    if (this.engine && this.currentModel !== targetModel) {
      await this.engine.unload();
      this.engine = null;
    }

    if (!this.engine) {
      this.engine = await createWllamaEngine({
        modelId: targetModel,
      });
      this.currentModel = targetModel;

      if (!this.engine) {
        throw new Error('Failed to create Firefox wllama engine');
      }
    }

    return this.engine;
  }

  /**
   * Convert our message format to Firefox wllama format
   */
  private convertMessages(messages: ChatMessage[]): FirefoxWllamaMessage[] {
    return messages
      .filter(m => m.role === 'system' || m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));
  }

  /**
   * Send chat messages and get response
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const engine = await this.ensureEngine(options?.model);
    const ffMessages = this.convertMessages(messages);

    try {
      const result = await engine.chat({
        messages: ffMessages,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        topP: options?.topP,
        stream: false,
      });

      return {
        content: result.content,
        finishReason: 'stop',
        model: this.currentModel || undefined,
      };
    } catch (e) {
      console.error('[Harbor] Firefox wllama chat error:', e);
      throw new Error(`Firefox wllama error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Send chat messages with streaming response
   */
  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamToken> {
    const engine = await this.ensureEngine(options?.model);
    const ffMessages = this.convertMessages(messages);

    try {
      const stream = engine.chatStream({
        messages: ffMessages,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        topP: options?.topP,
        stream: true,
      });

      for await (const chunk of stream) {
        if (chunk.done) {
          yield { type: 'done' };
          break;
        }
        yield { type: 'token', token: chunk.token };
      }
    } catch (e) {
      console.error('[Harbor] Firefox wllama stream error:', e);
      yield {
        type: 'error',
        error: {
          code: 'FIREFOX_WLLAMA_ERROR',
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }

  /**
   * Unload the engine to free resources
   */
  async unload(): Promise<void> {
    if (this.engine) {
      await this.engine.unload();
      this.engine = null;
      this.currentModel = null;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Firefox wllama provider if available
 */
export async function createFirefoxWllamaProvider(
  config?: ProviderConfig,
): Promise<FirefoxWllamaProvider | null> {
  if (!hasWllama()) {
    return null;
  }

  return new FirefoxWllamaProvider(config);
}
