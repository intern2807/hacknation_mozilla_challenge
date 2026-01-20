import {
  callMcpMethod,
  callMcpTool,
  getMcpServer,
  initializeMcpRuntime,
  listMcpServers,
  listRunningServerIds,
  registerMcpServer,
  startMcpServer,
  stopMcpServer,
  unregisterMcpServer,
} from '../wasm/runtime';
import {
  addInstalledServer,
  ensureBuiltinServers,
  removeInstalledServer,
  updateInstalledServer,
} from '../storage/servers';
import type { McpServerManifest } from '../wasm/types';

export function initializeMcpHost(): void {
  console.log('[Harbor] MCP host starting...');
  initializeMcpRuntime();
  ensureBuiltinServers().then((servers) => {
    servers.forEach((server) => registerMcpServer(server));
    console.log('[Harbor] MCP host ready (WASM + JS support).');
  });
}

export async function listRegisteredServers(): Promise<McpServerManifest[]> {
  return listMcpServers().map((handle) => handle.manifest);
}

export async function listServersWithStatus(): Promise<Array<McpServerManifest & { running: boolean }>> {
  const running = new Set(listRunningServerIds());
  return listMcpServers().map((handle) => ({
    ...handle.manifest,
    running: running.has(handle.id),
  }));
}

export async function addServer(manifest: McpServerManifest): Promise<void> {
  registerMcpServer(manifest);
  await addInstalledServer(manifest);
}

export function startServer(serverId: string): Promise<boolean> {
  return startMcpServer(serverId);
}

export async function validateAndStartServer(serverId: string): Promise<{ ok: boolean; tools?: McpServerManifest['tools']; error?: string }> {
  const started = await startMcpServer(serverId);
  if (!started) {
    return { ok: false, error: 'Failed to start server' };
  }
  const response = await callMcpMethod(serverId, 'tools/list');
  if (response.error) {
    return { ok: false, error: response.error.message };
  }
  const tools = (response.result as { tools?: McpServerManifest['tools'] })?.tools || [];
  const handle = getMcpServer(serverId);
  if (handle) {
    const updated: McpServerManifest = {
      ...handle.manifest,
      tools,
    };
    registerMcpServer(updated);
    await updateInstalledServer(updated);
  }
  return { ok: true, tools };
}

export function stopServer(serverId: string): boolean {
  return stopMcpServer(serverId);
}

export async function removeServer(serverId: string): Promise<void> {
  unregisterMcpServer(serverId);
  await removeInstalledServer(serverId);
}

export async function listTools(serverId: string): Promise<McpServerManifest['tools']> {
  const handle = getMcpServer(serverId);
  return handle?.manifest.tools || [];
}

export function callTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const finalArgs = { ...args };
  if (serverId === 'time-wasm' && toolName === 'time.now' && !finalArgs.now) {
    finalArgs.now = new Date().toISOString();
  }
  return callMcpTool(serverId, toolName, finalArgs);
}
