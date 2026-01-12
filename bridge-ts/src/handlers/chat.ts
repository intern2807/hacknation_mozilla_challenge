/**
 * Chat Session Handlers
 * 
 * Handles chat session lifecycle and message orchestration.
 */

import * as M from '../message-types.js';
import { HandlerContext, MessageHandler, withErrorHandling, requireFields } from './context.js';
import { 
  getChatOrchestrator, 
  getChatSessionStore, 
  createSession,
} from '../chat/index.js';
import { log } from '../native-messaging.js';

// =============================================================================
// Chat Session Handlers
// =============================================================================

/**
 * Create a new chat session.
 */
export const handleChatCreateSession: MessageHandler = withErrorHandling(
  'chat_create_session_result',
  'chat_error',
  async (ctx) => {
    const enabledServers = (ctx.message.enabled_servers as string[]) || [];
    const name = ctx.message.name as string | undefined;
    const systemPrompt = ctx.message.system_prompt as string | undefined;
    const maxIterations = ctx.message.max_iterations as number | undefined;

    log(`[ChatCreateSession] Creating session with ${enabledServers.length} enabled servers: ${enabledServers.join(', ')}`);

    const sessionStore = getChatSessionStore();
    
    const session = createSession(enabledServers, {
      name,
      systemPrompt,
      config: maxIterations ? { maxIterations } : undefined,
    });
    
    log(`[ChatCreateSession] Created session ${session.id} with enabledServers: ${session.enabledServers.join(', ')}`);
    
    sessionStore.save(session);
    
    return { 
      session: {
        id: session.id,
        name: session.name,
        enabledServers: session.enabledServers,
        systemPrompt: session.systemPrompt,
        createdAt: session.createdAt,
        config: session.config,
      },
    };
  }
);

/**
 * Send a message to a chat session and run the orchestration loop.
 */
export const handleChatSendMessage: MessageHandler = requireFields(
  ['session_id', 'message'],
  withErrorHandling('chat_send_message_result', 'chat_error', async (ctx) => {
    const sessionId = ctx.message.session_id as string;
    const userMessage = ctx.message.message as string;
    const useToolRouter = ctx.message.use_tool_router === true; // Default to false - let LLM see all tools

    // Ensure LLM is available
    const activeId = ctx.llmManager.getActiveId();
    if (!activeId) {
      throw new Error('No active LLM provider. Run llm_detect first.');
    }

    const sessionStore = getChatSessionStore();
    const session = sessionStore.get(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    log(`[ChatSendMessage] Session ${sessionId} has ${session.enabledServers.length} enabled servers: ${session.enabledServers.join(', ')}`);
    
    // Apply tool router setting for this request
    session.config.useToolRouter = useToolRouter;
    log(`[ChatSendMessage] Tool router: ${useToolRouter ? 'enabled' : 'disabled'}`);
    
    const orchestrator = getChatOrchestrator();
    const result = await orchestrator.run(session, userMessage);
    
    // Save updated session
    sessionStore.save(session);
    
    return { 
      response: result.finalResponse,
      steps: result.steps,
      iterations: result.iterations,
      reachedMaxIterations: result.reachedMaxIterations,
      durationMs: result.durationMs,
      routing: result.routing,
    };
  })
);

/**
 * Get a chat session.
 */
export const handleChatGetSession: MessageHandler = requireFields(
  ['session_id'],
  withErrorHandling('chat_get_session_result', 'chat_error', async (ctx) => {
    const sessionId = ctx.message.session_id as string;

    const sessionStore = getChatSessionStore();
    const session = sessionStore.get(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    return { session };
  })
);

/**
 * List all chat sessions.
 */
export const handleChatListSessions: MessageHandler = withErrorHandling(
  'chat_list_sessions_result',
  'chat_error',
  async (ctx) => {
    const limit = (ctx.message.limit as number) || 50;

    const sessionStore = getChatSessionStore();
    const sessions = sessionStore.getRecent(limit).map(s => ({
      id: s.id,
      name: s.name,
      enabledServers: s.enabledServers,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    
    return { sessions };
  }
);

/**
 * Delete a chat session.
 */
export const handleChatDeleteSession: MessageHandler = requireFields(
  ['session_id'],
  withErrorHandling('chat_delete_session_result', 'chat_error', async (ctx) => {
    const sessionId = ctx.message.session_id as string;

    const sessionStore = getChatSessionStore();
    const deleted = sessionStore.delete(sessionId);
    
    return { deleted };
  })
);

/**
 * Update a chat session (name, system prompt, etc).
 */
export const handleChatUpdateSession: MessageHandler = requireFields(
  ['session_id'],
  withErrorHandling('chat_update_session_result', 'chat_error', async (ctx) => {
    const sessionId = ctx.message.session_id as string;
    const updates = (ctx.message.updates || {}) as Partial<{
      name: string;
      systemPrompt: string;
      enabledServers: string[];
    }>;

    const sessionStore = getChatSessionStore();
    const session = sessionStore.get(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    // Apply updates
    if (updates.name !== undefined) {
      session.name = updates.name;
    }
    if (updates.systemPrompt !== undefined) {
      session.systemPrompt = updates.systemPrompt;
    }
    if (updates.enabledServers !== undefined) {
      session.enabledServers = updates.enabledServers;
    }
    
    session.updatedAt = Date.now();
    sessionStore.save(session);
    
    return { 
      session: {
        id: session.id,
        name: session.name,
        enabledServers: session.enabledServers,
        systemPrompt: session.systemPrompt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
    };
  })
);

/**
 * Clear messages from a chat session.
 */
export const handleChatClearMessages: MessageHandler = requireFields(
  ['session_id'],
  withErrorHandling('chat_clear_messages_result', 'chat_error', async (ctx) => {
    const sessionId = ctx.message.session_id as string;

    const sessionStore = getChatSessionStore();
    const session = sessionStore.get(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    session.messages = [];
    session.updatedAt = Date.now();
    sessionStore.save(session);
    
    return { cleared: true };
  })
);

