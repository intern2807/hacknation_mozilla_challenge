/**
 * Chrome AI Provider
 * 
 * LLM provider using Chrome's built-in AI (Chrome 131+).
 * Uses Chrome's window.ai.languageModel API.
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

// =============================================================================
// Chrome AI API Types
// =============================================================================

interface ChromeAICapabilities {
  available: 'readily' | 'after-download' | 'no';
  defaultTopK?: number;
  maxTopK?: number;
  defaultTemperature?: number;
}

interface ChromeAISession {
  prompt(input: string): Promise<string>;
  promptStreaming(input: string): AsyncIterable<string>;
  destroy(): void;
  clone(): Promise<ChromeAISession>;
}

interface ChromeAICreateOptions {
  systemPrompt?: string;
  initialPrompts?: Array<{ role: string; content: string }>;
  temperature?: number;
  topK?: number;
}

interface ChromeLanguageModel {
  capabilities(): Promise<ChromeAICapabilities>;
  create(options?: ChromeAICreateOptions): Promise<ChromeAISession>;
}

interface ChromeAI {
  languageModel?: ChromeLanguageModel;
  canCreateTextSession?(): Promise<'readily' | 'after-download' | 'no'>;
}

// =============================================================================
// Chrome AI Detection
// =============================================================================

/**
 * Get Chrome's AI API if available
 */
function getChromeAI(): ChromeAI | null {
  try {
    const windowAi = (globalThis as { ai?: ChromeAI }).ai;
    
    // Check if it has languageModel (Chrome's API)
    if (windowAi?.languageModel) {
      return windowAi;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if Chrome AI is available
 */
export async function hasChromeAI(): Promise<boolean> {
  const ai = getChromeAI();
  if (!ai?.languageModel) {
    return false;
  }

  try {
    const caps = await ai.languageModel.capabilities();
    return caps.available === 'readily' || caps.available === 'after-download';
  } catch {
    return false;
  }
}

// =============================================================================
// Chrome AI Provider Implementation
// =============================================================================

export class ChromeAIProvider implements LLMProvider {
  readonly id = 'chrome';
  readonly type = 'chrome' as const;
  readonly name = 'Chrome Built-in AI';
  readonly runtime = 'chrome' as const;
  readonly isNative = true;

  private config: ProviderConfig;
  private session: ChromeAISession | null = null;
  private currentSystemPrompt: string | null = null;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
  }

  /**
   * Check if Chrome AI is available
   */
  async isAvailable(): Promise<boolean> {
    return hasChromeAI();
  }

  /**
   * Get provider info
   */
  async getInfo(): Promise<LLMProviderInfo> {
    const available = await this.isAvailable();

    return {
      id: this.id,
      type: this.type,
      name: this.name,
      available,
      isDefault: false,
      supportsTools: this.supportsTools(),
      supportsStreaming: this.supportsStreaming(),
      isNative: true,
      runtime: 'chrome',
    };
  }

  /**
   * List available models - Chrome AI doesn't expose model selection
   */
  async listModels(): Promise<string[]> {
    return ['gemini-nano']; // Chrome's built-in model
  }

  /**
   * Chrome AI doesn't support tool calling currently
   */
  supportsTools(): boolean {
    return false;
  }

  /**
   * Chrome AI supports streaming
   */
  supportsStreaming(): boolean {
    return true;
  }

  /**
   * Ensure session is created with the right system prompt
   */
  private async ensureSession(systemPrompt?: string): Promise<ChromeAISession> {
    const ai = getChromeAI();
    if (!ai?.languageModel) {
      throw new Error('Chrome AI not available');
    }

    // Re-create session if system prompt changed
    const targetPrompt = systemPrompt || null;
    if (this.session && this.currentSystemPrompt !== targetPrompt) {
      this.session.destroy();
      this.session = null;
    }

    if (!this.session) {
      this.session = await ai.languageModel.create({
        systemPrompt: targetPrompt || undefined,
      });
      this.currentSystemPrompt = targetPrompt;
    }

    return this.session;
  }

  /**
   * Convert messages to a single prompt for Chrome AI
   * Chrome AI uses a simpler session-based API
   */
  private messagesToPrompt(messages: ChatMessage[]): { systemPrompt?: string; userPrompt: string } {
    let systemPrompt: string | undefined;
    const userMessages: string[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else if (msg.role === 'user') {
        userMessages.push(msg.content);
      } else if (msg.role === 'assistant') {
        // Include assistant messages as context
        userMessages.push(`Assistant: ${msg.content}`);
      }
    }

    // Use the last user message as the prompt
    const lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const userPrompt = lastUserMsg?.content || userMessages.join('\n');

    return { systemPrompt, userPrompt };
  }

  /**
   * Send chat messages and get response
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const { systemPrompt, userPrompt } = this.messagesToPrompt(messages);
    const session = await this.ensureSession(systemPrompt);

    try {
      const content = await session.prompt(userPrompt);

      return {
        content,
        finishReason: 'stop',
        model: 'gemini-nano',
      };
    } catch (e) {
      console.error('[Harbor] Chrome AI chat error:', e);
      throw new Error(`Chrome AI error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Send chat messages with streaming response
   */
  async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<StreamToken> {
    const { systemPrompt, userPrompt } = this.messagesToPrompt(messages);
    const session = await this.ensureSession(systemPrompt);

    try {
      const stream = session.promptStreaming(userPrompt);
      let previousLength = 0;

      for await (const chunk of stream) {
        // Chrome AI streams the full response so far, not deltas
        // We need to extract just the new part
        const newContent = chunk.slice(previousLength);
        previousLength = chunk.length;

        if (newContent) {
          yield { type: 'token', token: newContent };
        }
      }

      yield { type: 'done' };
    } catch (e) {
      console.error('[Harbor] Chrome AI stream error:', e);
      yield {
        type: 'error',
        error: {
          code: 'CHROME_AI_ERROR',
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
  }

  /**
   * Destroy the session to free resources
   */
  destroy(): void {
    if (this.session) {
      this.session.destroy();
      this.session = null;
      this.currentSystemPrompt = null;
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Chrome AI provider if available
 */
export async function createChromeAIProvider(
  config?: ProviderConfig,
): Promise<ChromeAIProvider | null> {
  if (!(await hasChromeAI())) {
    return null;
  }

  return new ChromeAIProvider(config);
}
