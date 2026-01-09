/**
 * MCP Server Runner - Isolated process for running MCP servers
 * 
 * This module runs as a separate process (forked from the main bridge)
 * to provide crash isolation for MCP servers. If a server misbehaves
 * or crashes, only this runner process is affected, not the main bridge.
 * 
 * Communication:
 * - Receives commands from parent via IPC (connect, callTool, disconnect, etc.)
 * - Sends responses and status updates back via IPC
 * - Manages a single MCP server connection
 * 
 * PKG COMPATIBILITY:
 * This module is invoked via main.ts with the --mcp-runner <serverId> flag,
 * allowing it to work in pkg-compiled binaries where we can't fork separate .js files.
 */

import { StdioMcpClient, StdioMcpClientOptions, McpConnectionInfo, McpTool, McpResource, McpPrompt, McpToolCallResult } from './stdio-client.js';
import { log } from '../native-messaging.js';

// ===========================================================================
// Types
// ===========================================================================

interface RunnerCommand {
  id: string;
  type: 'connect' | 'disconnect' | 'list_tools' | 'list_resources' | 'list_prompts' | 'call_tool' | 'read_resource' | 'get_prompt' | 'shutdown';
  // For connect
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // For call_tool
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  // For read_resource
  uri?: string;
  // For get_prompt
  promptName?: string;
  promptArgs?: Record<string, string>;
}

interface RunnerResponse {
  id: string;
  type: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface RunnerStatus {
  type: 'status';
  status: 'ready' | 'connected' | 'disconnected' | 'crashed' | 'error';
  data?: Record<string, unknown>;
}

// ===========================================================================
// Runner State
// ===========================================================================

let client: StdioMcpClient | null = null;
let serverId: string = '';
let connectionInfo: McpConnectionInfo | null = null;

// ===========================================================================
// IPC Communication
// ===========================================================================

function sendToParent(message: RunnerResponse | RunnerStatus): void {
  if (process.send) {
    process.send(message);
  }
}

function sendResponse(id: string, type: string, success: boolean, data?: unknown, error?: string): void {
  sendToParent({ id, type, success, data, error });
}

function sendStatus(status: RunnerStatus['status'], data?: Record<string, unknown>): void {
  sendToParent({ type: 'status', status, data });
}

// ===========================================================================
// Command Handlers
// ===========================================================================

async function handleConnect(command: RunnerCommand): Promise<void> {
  if (client?.isConnected()) {
    sendResponse(command.id, 'connect', true, {
      connectionInfo,
      alreadyConnected: true,
    });
    return;
  }

  try {
    log(`[McpRunner:${serverId}] Connecting...`);
    
    const options: StdioMcpClientOptions = {
      command: command.command!,
      args: command.args,
      env: command.env,
      cwd: command.cwd,
      onExit: (code, signal) => {
        log(`[McpRunner:${serverId}] Server process exited (code=${code}, signal=${signal})`);
        connectionInfo = null;
        sendStatus('crashed', { code, signal });
      },
    };

    client = new StdioMcpClient(options);
    connectionInfo = await client.connect();

    // Fetch capabilities
    const [tools, resources, prompts] = await Promise.all([
      connectionInfo.capabilities.tools ? client.listTools() : Promise.resolve([]),
      connectionInfo.capabilities.resources ? client.listResources() : Promise.resolve([]),
      connectionInfo.capabilities.prompts ? client.listPrompts() : Promise.resolve([]),
    ]);

    sendStatus('connected', { serverId });
    sendResponse(command.id, 'connect', true, {
      connectionInfo,
      tools,
      resources,
      prompts,
      pid: client.getPid(),
    });
    
    log(`[McpRunner:${serverId}] Connected: ${tools.length} tools, ${resources.length} resources`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[McpRunner:${serverId}] Connect failed: ${message}`);
    
    // Include stderr log for debugging
    const stderrLog = client?.getStderrLog() || [];
    
    sendResponse(command.id, 'connect', false, { stderrLog }, message);
  }
}

async function handleDisconnect(command: RunnerCommand): Promise<void> {
  try {
    if (client) {
      await client.disconnect();
      client = null;
      connectionInfo = null;
    }
    sendStatus('disconnected');
    sendResponse(command.id, 'disconnect', true);
    log(`[McpRunner:${serverId}] Disconnected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse(command.id, 'disconnect', false, undefined, message);
  }
}

async function handleListTools(command: RunnerCommand): Promise<void> {
  try {
    if (!client?.isConnected()) {
      sendResponse(command.id, 'list_tools', false, undefined, 'Not connected');
      return;
    }
    const tools = await client.listTools();
    sendResponse(command.id, 'list_tools', true, { tools });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse(command.id, 'list_tools', false, undefined, message);
  }
}

async function handleListResources(command: RunnerCommand): Promise<void> {
  try {
    if (!client?.isConnected()) {
      sendResponse(command.id, 'list_resources', false, undefined, 'Not connected');
      return;
    }
    const resources = await client.listResources();
    sendResponse(command.id, 'list_resources', true, { resources });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse(command.id, 'list_resources', false, undefined, message);
  }
}

async function handleListPrompts(command: RunnerCommand): Promise<void> {
  try {
    if (!client?.isConnected()) {
      sendResponse(command.id, 'list_prompts', false, undefined, 'Not connected');
      return;
    }
    const prompts = await client.listPrompts();
    sendResponse(command.id, 'list_prompts', true, { prompts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse(command.id, 'list_prompts', false, undefined, message);
  }
}

async function handleCallTool(command: RunnerCommand): Promise<void> {
  try {
    if (!client?.isConnected()) {
      sendResponse(command.id, 'call_tool', false, undefined, 'Not connected');
      return;
    }
    if (!command.toolName) {
      sendResponse(command.id, 'call_tool', false, undefined, 'Tool name required');
      return;
    }
    
    log(`[McpRunner:${serverId}] Calling tool: ${command.toolName}`);
    const result = await client.callTool(command.toolName, command.toolArgs || {});
    sendResponse(command.id, 'call_tool', true, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[McpRunner:${serverId}] Tool call failed: ${message}`);
    sendResponse(command.id, 'call_tool', false, undefined, message);
  }
}

async function handleReadResource(command: RunnerCommand): Promise<void> {
  try {
    if (!client?.isConnected()) {
      sendResponse(command.id, 'read_resource', false, undefined, 'Not connected');
      return;
    }
    if (!command.uri) {
      sendResponse(command.id, 'read_resource', false, undefined, 'URI required');
      return;
    }
    
    const result = await client.readResource(command.uri);
    sendResponse(command.id, 'read_resource', true, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse(command.id, 'read_resource', false, undefined, message);
  }
}

async function handleGetPrompt(command: RunnerCommand): Promise<void> {
  try {
    if (!client?.isConnected()) {
      sendResponse(command.id, 'get_prompt', false, undefined, 'Not connected');
      return;
    }
    if (!command.promptName) {
      sendResponse(command.id, 'get_prompt', false, undefined, 'Prompt name required');
      return;
    }
    
    const result = await client.getPrompt(command.promptName, command.promptArgs);
    sendResponse(command.id, 'get_prompt', true, { result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendResponse(command.id, 'get_prompt', false, undefined, message);
  }
}

/**
 * Handle a command from the parent process.
 * Exported for testing purposes.
 */
export async function handleRunnerCommand(
  clientArg: StdioMcpClient | null,
  command: RunnerCommand
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  // For testing - use the provided client or the global one
  const useClient = clientArg || client;
  
  try {
    switch (command.type) {
      case 'connect': {
        if (clientArg) {
          // Test mode - use provided client
          await clientArg.connect();
          const connInfo = (clientArg as unknown as { _connectionInfo: McpConnectionInfo })._connectionInfo;
          const [tools, resources, prompts] = await Promise.all([
            connInfo?.capabilities?.tools ? clientArg.listTools() : Promise.resolve([]),
            connInfo?.capabilities?.resources ? clientArg.listResources() : Promise.resolve([]),
            connInfo?.capabilities?.prompts ? clientArg.listPrompts() : Promise.resolve([]),
          ]);
          return {
            success: true,
            data: {
              connectionInfo: connInfo,
              tools,
              resources,
              prompts,
              pid: clientArg.getPid?.() || 12345,
            },
          };
        }
        // Normal mode - handled by internal handleConnect
        return { success: true };
      }
      case 'disconnect':
        if (useClient) {
          await useClient.disconnect();
        }
        return { success: true };
      case 'list_tools': {
        if (!useClient?.isConnected?.()) {
          return { success: false, error: 'Not connected' };
        }
        const tools = await useClient.listTools();
        return { success: true, data: { tools } };
      }
      case 'list_resources': {
        if (!useClient?.isConnected?.()) {
          return { success: false, error: 'Not connected' };
        }
        const resources = await useClient.listResources();
        return { success: true, data: { resources } };
      }
      case 'list_prompts': {
        if (!useClient?.isConnected?.()) {
          return { success: false, error: 'Not connected' };
        }
        const prompts = await useClient.listPrompts();
        return { success: true, data: { prompts } };
      }
      case 'call_tool': {
        if (!useClient?.isConnected?.()) {
          return { success: false, error: 'Not connected' };
        }
        const result = await useClient.callTool(command.toolName!, command.toolArgs || {});
        return { success: true, data: { result } };
      }
      case 'read_resource': {
        if (!useClient?.isConnected?.()) {
          return { success: false, error: 'Not connected' };
        }
        const contents = await useClient.readResource(command.uri!);
        return { success: true, data: { contents } };
      }
      case 'get_prompt': {
        if (!useClient?.isConnected?.()) {
          return { success: false, error: 'Not connected' };
        }
        const messages = await useClient.getPrompt(command.promptName!, command.promptArgs);
        return { success: true, data: { messages } };
      }
      case 'shutdown':
        if (useClient) {
          await useClient.disconnect();
        }
        return { success: true };
      default:
        return { success: false, error: `Unknown command: ${command.type}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

async function handleCommand(command: RunnerCommand): Promise<void> {
  try {
    switch (command.type) {
      case 'connect':
        await handleConnect(command);
        break;
      case 'disconnect':
        await handleDisconnect(command);
        break;
      case 'list_tools':
        await handleListTools(command);
        break;
      case 'list_resources':
        await handleListResources(command);
        break;
      case 'list_prompts':
        await handleListPrompts(command);
        break;
      case 'call_tool':
        await handleCallTool(command);
        break;
      case 'read_resource':
        await handleReadResource(command);
        break;
      case 'get_prompt':
        await handleGetPrompt(command);
        break;
      case 'shutdown':
        log(`[McpRunner:${serverId}] Shutting down...`);
        if (client) {
          await client.disconnect();
        }
        process.exit(0);
        break;
      default:
        sendResponse(command.id, command.type, false, undefined, `Unknown command: ${command.type}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[McpRunner:${serverId}] Command error: ${message}`);
    sendResponse(command.id, command.type, false, undefined, message);
  }
}

// ===========================================================================
// Entry Point
// ===========================================================================

/**
 * Run the MCP runner.
 * This is called from main.ts when the --mcp-runner <serverId> flag is passed.
 * 
 * @param serverIdArg The ID of the server this runner manages
 */
export async function runMcpRunner(serverIdArg: string): Promise<void> {
  serverId = serverIdArg;
  log(`[McpRunner:${serverId}] Starting MCP runner process...`);
  
  // Listen for commands from parent
  process.on('message', (command: RunnerCommand) => {
    handleCommand(command).catch(err => {
      log(`[McpRunner:${serverId}] Command handler error: ${err}`);
    });
  });
  
  // Handle parent disconnect
  process.on('disconnect', async () => {
    log(`[McpRunner:${serverId}] Parent disconnected, shutting down`);
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore errors during cleanup
      }
    }
    process.exit(0);
  });
  
  // Handle uncaught errors - log but don't crash immediately
  process.on('uncaughtException', (error) => {
    log(`[McpRunner:${serverId}] Uncaught exception: ${error.message}`);
    sendStatus('error', { error: error.message });
    // Give time for the error status to be sent before exiting
    setTimeout(() => process.exit(1), 100);
  });
  
  process.on('unhandledRejection', (reason) => {
    log(`[McpRunner:${serverId}] Unhandled rejection: ${reason}`);
    sendStatus('error', { error: String(reason) });
  });
  
  // Signal ready
  sendStatus('ready', { serverId });
  log(`[McpRunner:${serverId}] Runner ready`);
  
  // Keep the process alive - wait for parent to disconnect
  await new Promise<void>(() => {
    // This promise never resolves - we exit via the disconnect handler
  });
}

