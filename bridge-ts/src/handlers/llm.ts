/**
 * LLM Handlers
 * 
 * Handlers for LLM provider management, model selection, and chat.
 */

import { log, pushStatus } from '../native-messaging.js';
import { getLLMSetupManager, DownloadProgress, ChatMessage, ToolDefinition } from '../llm/index.js';
import { 
  MessageHandler, 
  withErrorHandling,
  requireFields,
} from './context.js';

// =============================================================================
// Provider Management
// =============================================================================

/**
 * Detect available LLM providers.
 */
export const handleLlmDetect: MessageHandler = withErrorHandling(
  'llm_detect_result',
  'llm_error',
  async (ctx) => {
    const providers = await ctx.llmManager.detectAll();
    const active = ctx.llmManager.getActiveId();
    
    return { 
      providers,
      active,
      hasAvailable: ctx.llmManager.hasAvailableProvider(),
    };
  }
);

/**
 * List all LLM providers and their status.
 */
export const handleLlmListProviders: MessageHandler = withErrorHandling(
  'llm_list_providers_result',
  'llm_error',
  async (ctx) => {
    const providers = ctx.llmManager.getAllStatus();
    const active = ctx.llmManager.getActiveId();
    
    return { providers, active };
  }
);

/**
 * Get the active LLM provider status.
 */
export const handleLlmGetActive: MessageHandler = withErrorHandling(
  'llm_get_active_result',
  'llm_error',
  async (ctx) => {
    const activeId = ctx.llmManager.getActiveId();
    const activeStatus = ctx.llmManager.getActiveStatus();
    const activeModelId = ctx.llmManager.getActiveModelId();
    
    return { 
      active: activeId,
      model: activeModelId,
      status: activeStatus,
    };
  }
);

/**
 * Get all supported providers and their configuration requirements.
 */
export const handleLlmGetSupportedProviders: MessageHandler = withErrorHandling(
  'llm_get_supported_providers_result',
  'llm_error',
  async (ctx) => {
    const providers = ctx.llmManager.getSupportedProviders();
    return { providers };
  }
);

/**
 * Get the current LLM configuration.
 */
export const handleLlmGetConfig: MessageHandler = withErrorHandling(
  'llm_get_config_result',
  'llm_error',
  async (ctx) => {
    const summary = ctx.llmManager.getSummary();
    const allStatus = ctx.llmManager.getAllStatus();
    return { ...summary, providers: allStatus };
  }
);

// =============================================================================
// Provider/Model Selection
// =============================================================================

/**
 * Set the active LLM provider and optionally the model.
 */
export const handleLlmSetActive: MessageHandler = requireFields(
  ['provider_id'],
  async (ctx) => {
    const providerId = ctx.message.provider_id as string;
    const modelId = ctx.message.model_id as string | undefined;

    try {
      const success = ctx.llmManager.setActive(providerId, modelId);
      
      if (!success) {
        return ctx.error('llm_error', `Provider not available: ${providerId}`);
      }
      
      return ctx.result('llm_set_active_result', { 
        success: true,
        active: providerId,
        model: ctx.llmManager.getActiveModelId(),
      });
    } catch (e) {
      log(`Failed to set active LLM provider: ${e}`);
      return ctx.error('llm_error', String(e));
    }
  }
);

/**
 * Set the active model for the current provider.
 */
export const handleLlmSetModel: MessageHandler = requireFields(
  ['model_id'],
  async (ctx) => {
    const modelId = ctx.message.model_id as string;

    try {
      const success = ctx.llmManager.setActiveModel(modelId);
      
      if (!success) {
        return ctx.error('llm_error', `Failed to set model: ${modelId}`);
      }
      
      return ctx.result('llm_set_model_result', { 
        success: true,
        model: modelId,
        provider: ctx.llmManager.getActiveId(),
      });
    } catch (e) {
      log(`Failed to set LLM model: ${e}`);
      return ctx.error('llm_error', String(e));
    }
  }
);

// =============================================================================
// Model Listing
// =============================================================================

/**
 * List models from the active LLM provider.
 */
export const handleLlmListModels: MessageHandler = async (ctx) => {
  try {
    const active = ctx.llmManager.getActiveId();
    if (!active) {
      return ctx.error('llm_error', 'No active LLM provider. Run llm_detect first.');
    }
    
    const models = await ctx.llmManager.listModels();
    
    return ctx.result('llm_list_models_result', { 
      models,
      provider: active,
    });
  } catch (e) {
    log(`Failed to list LLM models: ${e}`);
    return ctx.error('llm_error', String(e));
  }
};

/**
 * List models for a specific provider.
 */
export const handleLlmListModelsFor: MessageHandler = requireFields(
  ['provider_id'],
  withErrorHandling(
    'llm_list_models_for_result',
    'llm_error',
    async (ctx) => {
      const providerId = ctx.message.provider_id as string;
      const models = await ctx.llmManager.listModelsFor(providerId);
      return { models, provider: providerId };
    }
  )
);

// =============================================================================
// API Key Management
// =============================================================================

/**
 * Set an API key for a provider.
 */
export const handleLlmSetApiKey: MessageHandler = requireFields(
  ['provider_id', 'api_key'],
  async (ctx) => {
    const providerId = ctx.message.provider_id as string;
    const apiKey = ctx.message.api_key as string;

    try {
      await ctx.llmManager.setApiKey(providerId, apiKey);
      
      // Re-detect to update provider status
      await ctx.llmManager.detectAll();
      
      return ctx.result('llm_set_api_key_result', { 
        success: true,
        provider: providerId,
      });
    } catch (e) {
      log(`Failed to set API key: ${e}`);
      return ctx.error('llm_error', String(e));
    }
  }
);

/**
 * Remove an API key for a provider.
 */
export const handleLlmRemoveApiKey: MessageHandler = requireFields(
  ['provider_id'],
  async (ctx) => {
    const providerId = ctx.message.provider_id as string;

    try {
      await ctx.llmManager.removeApiKey(providerId);
      return ctx.result('llm_remove_api_key_result', { 
        success: true,
        provider: providerId,
      });
    } catch (e) {
      log(`Failed to remove API key: ${e}`);
      return ctx.error('llm_error', String(e));
    }
  }
);

// =============================================================================
// Chat
// =============================================================================

/**
 * Send a chat message to the active LLM (or specified provider).
 */
export const handleLlmChat: MessageHandler = async (ctx) => {
  const messages = ctx.message.messages as ChatMessage[] | undefined;
  const tools = ctx.message.tools as ToolDefinition[] | undefined;
  const model = ctx.message.model as string | undefined;
  const provider = ctx.message.provider as string | undefined;
  const maxTokens = ctx.message.max_tokens as number | undefined;
  const temperature = ctx.message.temperature as number | undefined;
  const systemPrompt = ctx.message.system_prompt as string | undefined;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return ctx.error('invalid_request', 'Missing or empty messages array');
  }

  try {
    // If provider is specified, temporarily switch to it
    const originalProviderId = ctx.llmManager.getActiveId();
    let usedProvider = originalProviderId;
    
    if (provider && provider !== originalProviderId) {
      const providerStatus = ctx.llmManager.getStatus(provider);
      if (!providerStatus?.available) {
        return ctx.error('llm_error', `Provider "${provider}" is not available`);
      }
      if (!ctx.llmManager.setActive(provider, model)) {
        return ctx.error('llm_error', `Failed to switch to provider "${provider}"`);
      }
      usedProvider = provider;
      log(`[LLMChat] Temporarily using provider: ${provider}`);
    }
    
    if (!usedProvider) {
      return ctx.error('llm_error', 'No active LLM provider. Run llm_detect first.');
    }
    
    try {
      const response = await ctx.llmManager.chat({
        messages,
        tools,
        model,
        maxTokens,
        temperature,
        systemPrompt,
      });
      
      return ctx.result('llm_chat_result', { 
        response,
        provider: usedProvider,
      });
    } finally {
      // Restore original provider if we switched
      if (provider && provider !== originalProviderId && originalProviderId) {
        ctx.llmManager.setActive(originalProviderId);
        log(`[LLMChat] Restored original provider: ${originalProviderId}`);
      }
    }
  } catch (e) {
    log(`Failed to chat with LLM: ${e}`);
    return ctx.error('llm_error', String(e));
  }
};

// =============================================================================
// Local Model Management (Setup)
// =============================================================================

/**
 * Get the status of local LLM setup (llamafile).
 */
export const handleLlmSetupStatus: MessageHandler = withErrorHandling(
  'llm_setup_status_result',
  'llm_error',
  async () => {
    const setupManager = getLLMSetupManager();
    return await setupManager.getStatus();
  }
);

/**
 * Download a local model.
 * This is a fire-and-forget operation - progress is sent via pushStatus.
 */
export const handleLlmDownloadModel: MessageHandler = requireFields(
  ['model_id'],
  async (ctx) => {
    const modelId = ctx.message.model_id as string;

    const setupManager = getLLMSetupManager();
    
    // Start download in background (don't await)
    // Progress is pushed via native messaging
    setupManager.downloadModel(modelId, (progress: DownloadProgress) => {
      // Push progress updates to extension
      pushStatus('llm_download', progress.status, {
        modelId,
        percent: progress.percent,
        bytesDownloaded: progress.bytesDownloaded,
        totalBytes: progress.totalBytes,
        error: progress.error,
      });
    }).then(async () => {
      // Download complete - push final status
      const status = await setupManager.getStatus();
      pushStatus('llm_download', 'complete', { modelId, status });
    }).catch((e) => {
      // Download failed - push error status
      pushStatus('llm_download', 'error', { modelId, error: String(e) });
    });
    
    // Return immediately - download continues in background
    return ctx.result('llm_download_model_result', { 
      started: true,
      modelId,
    });
  }
);

/**
 * Delete a local model.
 */
export const handleLlmDeleteModel: MessageHandler = requireFields(
  ['model_id'],
  withErrorHandling(
    'llm_delete_model_result',
    'llm_error',
    async (ctx) => {
      const modelId = ctx.message.model_id as string;
      const setupManager = getLLMSetupManager();
      await setupManager.deleteModel(modelId);
      return { success: true, model_id: modelId };
    }
  )
);

/**
 * Start a local LLM server (llamafile).
 */
export const handleLlmStartLocal: MessageHandler = async (ctx) => {
  const modelId = ctx.message.model_id as string || '';
  const port = (ctx.message.port as number) || 8080;

  if (!modelId) {
    return ctx.error('invalid_request', 'Missing model_id');
  }

  try {
    const setupManager = getLLMSetupManager();
    const result = await setupManager.startLocalLLM(modelId, port);
    
    if (!result.success) {
      return ctx.error('start_error', result.error || 'Failed to start');
    }
    
    // Re-detect LLM providers so the new one is available
    await ctx.llmManager.detectAll();
    
    return ctx.result('llm_start_local_result', { 
      success: true,
      url: result.url,
      modelId,
    });
  } catch (e) {
    log(`Failed to start local LLM: ${e}`);
    return ctx.error('start_error', String(e));
  }
};

/**
 * Stop the local LLM server.
 */
export const handleLlmStopLocal: MessageHandler = withErrorHandling(
  'llm_stop_local_result',
  'stop_error',
  async () => {
    const setupManager = getLLMSetupManager();
    const stopped = await setupManager.stopLocalLLM();
    return { stopped };
  }
);

