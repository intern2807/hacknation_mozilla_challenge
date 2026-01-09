/**
 * Unit tests for McpRunnerClient
 * 
 * Tests the IPC communication layer between the main bridge and isolated MCP runners.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpRunnerClient } from '../runner-client.js';

// Track handlers for simulating messages
let messageHandlers: Array<(message: unknown) => void> = [];
let exitHandlers: Array<(code: number | null) => void> = [];

// Mock child_process.fork
const mockChildProcess = {
  send: vi.fn(),
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (event === 'message') {
      messageHandlers.push(handler as (message: unknown) => void);
    } else if (event === 'exit') {
      exitHandlers.push(handler as (code: number | null) => void);
    }
    return mockChildProcess;
  }),
  off: vi.fn().mockReturnThis(),
  kill: vi.fn(),
  stdout: {
    on: vi.fn(),
  },
  stderr: {
    on: vi.fn(),
  },
};

vi.mock('child_process', () => ({
  fork: vi.fn(() => {
    // Immediately schedule the ready message after fork
    queueMicrotask(() => {
      // Emit ready to all handlers
      for (const handler of messageHandlers) {
        handler({ type: 'status', status: 'ready' });
      }
    });
    return mockChildProcess;
  }),
}));

vi.mock('../../native-messaging.js', () => ({
  log: vi.fn(),
}));

// Helper to simulate a message from the runner
function simulateMessage(message: unknown): void {
  for (const handler of messageHandlers) {
    handler(message);
  }
}

// Helper to simulate runner exit
function simulateExit(code: number | null): void {
  for (const handler of exitHandlers) {
    handler(code);
  }
}

describe('McpRunnerClient', () => {
  let client: McpRunnerClient;

  beforeEach(() => {
    vi.clearAllMocks();
    messageHandlers = [];
    exitHandlers = [];

    client = new McpRunnerClient({
      serverId: 'test-server',
    });
  });

  afterEach(async () => {
    try {
      // Skip the actual stopRunner since it will timeout
      // Just reset state
      vi.clearAllMocks();
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    it('should create client with serverId', () => {
      expect(client).toBeDefined();
      expect(client.isRunnerAlive()).toBe(false);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('startRunner', () => {
    it('should fork a new process with correct arguments', async () => {
      const { fork } = await import('child_process');

      await client.startRunner();

      expect(fork).toHaveBeenCalledWith(
        process.argv[1],
        ['--mcp-runner', 'test-server'],
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        })
      );
      expect(client.isRunnerAlive()).toBe(true);
    });

    it('should not fork if already running', async () => {
      const { fork } = await import('child_process');

      await client.startRunner();
      await client.startRunner();

      expect(fork).toHaveBeenCalledTimes(1);
    });
  });

  describe('connect', () => {
    beforeEach(async () => {
      await client.startRunner();
    });

    it('should send connect command and return connection info', async () => {
      const connectPromise = client.connect({
        command: 'npx',
        args: ['-y', 'test-server'],
        env: { API_KEY: 'secret' },
      });

      // Simulate response
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: {
              serverName: 'test-server',
              serverVersion: '1.0.0',
              protocolVersion: '2024-11-05',
              capabilities: { tools: true, resources: false, prompts: false },
            },
            tools: [{ name: 'tool1', description: 'Test tool' }],
            resources: [],
            prompts: [],
            pid: 12345,
          },
        });
      });

      const result = await connectPromise;

      expect(result).toEqual({
        serverName: 'test-server',
        serverVersion: '1.0.0',
        protocolVersion: '2024-11-05',
        capabilities: { tools: true, resources: false, prompts: false },
      });
      expect(client.isConnected()).toBe(true);
      expect(client.getCachedTools()).toHaveLength(1);
      expect(client.getPid()).toBe(12345);
    });

    it('should return cached connection info if already connected', async () => {
      // First connect
      const connectPromise1 = client.connect({
        command: 'npx',
        args: ['-y', 'test-server'],
      });

      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: {
              serverName: 'test-server',
              serverVersion: '1.0.0',
              protocolVersion: '2024-11-05',
              capabilities: { tools: true, resources: false, prompts: false },
            },
            tools: [],
            resources: [],
            prompts: [],
            pid: 12345,
          },
        });
      });

      await connectPromise1;

      // Second connect should return cached info without sending
      mockChildProcess.send.mockClear();
      const result2 = await client.connect({
        command: 'npx',
        args: ['-y', 'test-server'],
      });

      expect(result2.serverName).toBe('test-server');
      expect(mockChildProcess.send).not.toHaveBeenCalled();
    });

    it('should reject on connect failure', async () => {
      const connectPromise = client.connect({
        command: 'npx',
        args: ['-y', 'bad-server'],
      });

      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: false,
          error: 'Connection failed',
        });
      });

      await expect(connectPromise).rejects.toThrow('Connection failed');
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('disconnect', () => {
    beforeEach(async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: {} },
            tools: [],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;
    });

    it('should disconnect and update state', async () => {
      expect(client.isConnected()).toBe(true);

      const disconnectPromise = client.disconnect();
      queueMicrotask(() => {
        simulateMessage({ id: '2', type: 'disconnect', success: true });
      });
      await disconnectPromise;

      expect(client.isConnected()).toBe(false);
    });
  });

  describe('callTool', () => {
    beforeEach(async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: { tools: true } },
            tools: [{ name: 'greet', description: 'Say hello' }],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;
    });

    it('should call tool and return result', async () => {
      const callPromise = client.callTool('greet', { name: 'World' });

      queueMicrotask(() => {
        simulateMessage({
          id: '2',
          type: 'call_tool',
          success: true,
          data: {
            result: {
              content: [{ type: 'text', text: 'Hello, World!' }],
            },
          },
        });
      });

      const result = await callPromise;
      expect(result.content[0].text).toBe('Hello, World!');
    });

    it('should reject on tool failure', async () => {
      const callPromise = client.callTool('unknown_tool', {});

      queueMicrotask(() => {
        simulateMessage({
          id: '2',
          type: 'call_tool',
          success: false,
          error: 'Tool not found',
        });
      });

      await expect(callPromise).rejects.toThrow('Tool not found');
    });
  });

  describe('listTools', () => {
    beforeEach(async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: { tools: true } },
            tools: [],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;
    });

    it('should list tools from runner', async () => {
      const listPromise = client.listTools();

      queueMicrotask(() => {
        simulateMessage({
          id: '2',
          type: 'list_tools',
          success: true,
          data: {
            tools: [
              { name: 'tool1', description: 'First tool' },
              { name: 'tool2', description: 'Second tool' },
            ],
          },
        });
      });

      const tools = await listPromise;
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('tool1');
    });
  });

  describe('listResources', () => {
    beforeEach(async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: { resources: true } },
            tools: [],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;
    });

    it('should list resources from runner', async () => {
      const listPromise = client.listResources();

      queueMicrotask(() => {
        simulateMessage({
          id: '2',
          type: 'list_resources',
          success: true,
          data: {
            resources: [
              { uri: 'file://test.txt', name: 'Test File' },
            ],
          },
        });
      });

      const resources = await listPromise;
      expect(resources).toHaveLength(1);
      expect(resources[0].name).toBe('Test File');
    });
  });

  describe('listPrompts', () => {
    beforeEach(async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: { prompts: true } },
            tools: [],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;
    });

    it('should list prompts from runner', async () => {
      const listPromise = client.listPrompts();

      queueMicrotask(() => {
        simulateMessage({
          id: '2',
          type: 'list_prompts',
          success: true,
          data: {
            prompts: [
              { name: 'summarize', description: 'Summarize text' },
            ],
          },
        });
      });

      const prompts = await listPromise;
      expect(prompts).toHaveLength(1);
      expect(prompts[0].name).toBe('summarize');
    });
  });

  describe('crash handling', () => {
    it('should call onCrash when runner exits', async () => {
      const onCrash = vi.fn();
      const crashClient = new McpRunnerClient({
        serverId: 'crash-test',
        onCrash,
      });

      await crashClient.startRunner();

      // Simulate crash
      simulateExit(1);

      expect(onCrash).toHaveBeenCalledWith('Runner exited with code 1');
      expect(crashClient.isRunnerAlive()).toBe(false);
    });

    it('should reject pending requests on crash', async () => {
      await client.startRunner();

      // Start a request but don't respond
      const connectPromise = client.connect({ command: 'npx', args: [] });

      // Crash before response
      simulateExit(1);

      await expect(connectPromise).rejects.toThrow('Runner exited');
    });

    it('should update connected state on crash status', async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: {} },
            tools: [],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;

      expect(client.isConnected()).toBe(true);

      // Server crashes inside runner
      simulateMessage({ type: 'status', status: 'crashed' });

      expect(client.isConnected()).toBe(false);
    });

    it('should call onCrash on crash status message', async () => {
      const onCrash = vi.fn();
      const crashClient = new McpRunnerClient({
        serverId: 'crash-test-2',
        onCrash,
      });

      await crashClient.startRunner();

      // Server crashes inside runner (but runner is still alive)
      simulateMessage({ type: 'status', status: 'crashed' });

      expect(onCrash).toHaveBeenCalledWith('Server crashed');
    });
  });

  describe('stopRunner', () => {
    it('should send shutdown command', async () => {
      await client.startRunner();

      const stopPromise = client.stopRunner();
      queueMicrotask(() => {
        simulateMessage({ id: '1', type: 'shutdown', success: true });
      });

      await stopPromise;

      expect(mockChildProcess.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'shutdown' })
      );
    });

    it('should be idempotent when not running', async () => {
      // Client was never started
      await client.stopRunner();
      // Should not throw
    });
  });

  describe('getStderrLog', () => {
    it('should return empty array (logs forwarded through runner)', () => {
      expect(client.getStderrLog()).toEqual([]);
    });
  });

  describe('getCachedResources', () => {
    it('should return cached resources after connect', async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: { resources: true } },
            tools: [],
            resources: [{ uri: 'file://test', name: 'Test' }],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;

      expect(client.getCachedResources()).toHaveLength(1);
    });
  });

  describe('getCachedPrompts', () => {
    it('should return cached prompts after connect', async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: { prompts: true } },
            tools: [],
            resources: [],
            prompts: [{ name: 'greet', description: 'Greet someone' }],
            pid: 123,
          },
        });
      });
      await connectPromise;

      expect(client.getCachedPrompts()).toHaveLength(1);
    });
  });

  describe('getConnectionInfo', () => {
    it('should return null before connect', () => {
      expect(client.getConnectionInfo()).toBeNull();
    });

    it('should return connection info after connect', async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'my-server', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: {} },
            tools: [],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;

      const info = client.getConnectionInfo();
      expect(info?.serverName).toBe('my-server');
    });
  });

  describe('readResource', () => {
    beforeEach(async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: { resources: true } },
            tools: [],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;
    });

    it('should read a resource from the runner', async () => {
      const readPromise = client.readResource('file://test.txt');

      queueMicrotask(() => {
        simulateMessage({
          id: '2',
          type: 'read_resource',
          success: true,
          data: {
            result: {
              content: 'Hello World',
              mimeType: 'text/plain',
            },
          },
        });
      });

      const result = await readPromise;
      expect(result.content).toBe('Hello World');
      expect(result.mimeType).toBe('text/plain');
    });
  });

  describe('getPrompt', () => {
    beforeEach(async () => {
      await client.startRunner();

      const connectPromise = client.connect({ command: 'npx', args: [] });
      queueMicrotask(() => {
        simulateMessage({
          id: '1',
          type: 'connect',
          success: true,
          data: {
            connectionInfo: { serverName: 'test', serverVersion: '1.0', protocolVersion: '2024-11-05', capabilities: { prompts: true } },
            tools: [],
            resources: [],
            prompts: [],
            pid: 123,
          },
        });
      });
      await connectPromise;
    });

    it('should get a prompt from the runner', async () => {
      const getPromise = client.getPrompt('summarize', { text: 'Hello' });

      queueMicrotask(() => {
        simulateMessage({
          id: '2',
          type: 'get_prompt',
          success: true,
          data: {
            result: {
              description: 'Summarizes text',
              messages: [
                { role: 'user', content: 'Summarize: Hello' },
              ],
            },
          },
        });
      });

      const result = await getPromise;
      expect(result.description).toBe('Summarizes text');
      expect(result.messages).toHaveLength(1);
    });
  });
});
