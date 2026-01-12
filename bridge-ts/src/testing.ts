/**
 * Testing Utilities
 * 
 * This module exports utilities for testing, including singleton reset functions.
 * These functions should ONLY be used in test files.
 * 
 * @example
 * import { resetAllSingletons } from './testing.js';
 * 
 * beforeEach(async () => {
 *   await resetAllSingletons();
 * });
 */

import { __resetMcpClientManagerForTesting } from './mcp/manager.js';
import { __resetLLMManagerForTesting } from './llm/manager.js';
import { __resetChatOrchestratorForTesting } from './chat/orchestrator.js';
import { __resetInstalledServerManagerForTesting } from './installer/manager.js';
import { resetTokenStore } from './auth/token-store.js';
import { resetHarborOAuthBroker } from './auth/harbor-oauth.js';

export {
  // MCP
  __resetMcpClientManagerForTesting,
  
  // LLM
  __resetLLMManagerForTesting,
  
  // Chat
  __resetChatOrchestratorForTesting,
  
  // Installer
  __resetInstalledServerManagerForTesting,
  
  // Auth
  resetTokenStore,
  resetHarborOAuthBroker,
};

/**
 * Reset all singletons to their initial state.
 * This is useful in beforeEach hooks to ensure test isolation.
 */
export async function resetAllSingletons(): Promise<void> {
  // Reset in order from most dependent to least dependent
  __resetChatOrchestratorForTesting();
  await __resetMcpClientManagerForTesting();
  __resetLLMManagerForTesting();
  __resetInstalledServerManagerForTesting();
  resetHarborOAuthBroker();
  resetTokenStore();
}

