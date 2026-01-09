/**
 * MCP Process Isolation Configuration
 * 
 * This is a separate file to avoid circular dependencies between
 * index.ts and manager.ts.
 * 
 * Process isolation is ENABLED by default for crash protection.
 * Set HARBOR_MCP_ISOLATION=0 to disable.
 */

let _useProcessIsolation = process.env.HARBOR_MCP_ISOLATION !== '0';

/**
 * Enable or disable process isolation for MCP servers.
 * When enabled, each server runs in a forked process for crash protection.
 */
export function setProcessIsolation(enabled: boolean): void {
  _useProcessIsolation = enabled;
}

/**
 * Check if process isolation is enabled.
 */
export function isProcessIsolationEnabled(): boolean {
  return _useProcessIsolation;
}

