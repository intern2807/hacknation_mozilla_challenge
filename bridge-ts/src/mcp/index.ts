/**
 * MCP Client module - manages connections to MCP servers.
 * 
 * Supports:
 * - Local servers via stdio (npm, pypi, binary)
 * - Remote servers via HTTP/SSE
 * - Process isolation for crash protection
 * 
 * Process Isolation:
 * When enabled, each MCP server runs in a separate forked process.
 * This provides crash isolation: if a server misbehaves, only the
 * runner process dies, not the main bridge.
 * 
 * Enable with: setProcessIsolation(true) or HARBOR_MCP_ISOLATION=0 to disable
 */

export { StdioMcpClient, type McpConnectionInfo } from './stdio-client.js';
export { HttpMcpClient } from './http-client.js';
export { McpClientManager, getMcpClientManager, type ConnectedServer } from './manager.js';
export { McpRunnerClient } from './runner-client.js';
export { runMcpRunner } from './runner.js';

// Re-export isolation configuration
export { setProcessIsolation, isProcessIsolationEnabled } from './isolation-config.js';
