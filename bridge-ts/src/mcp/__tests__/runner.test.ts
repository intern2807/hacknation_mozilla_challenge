/**
 * Unit tests for MCP Runner process
 * 
 * Tests the isolated runner that hosts a single MCP server connection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the MCP client before importing runner
const mockClient = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn().mockReturnValue(true),
  listTools: vi.fn(),
  listResources: vi.fn(),
  listPrompts: vi.fn(),
  callTool: vi.fn(),
  readResource: vi.fn(),
  getPrompt: vi.fn(),
  getTransport: vi.fn(() => ({
    _process: { pid: 12345 },
  })),
  _connectionInfo: null as {
    serverName: string;
    serverVersion: string;
    protocolVersion: string;
    capabilities: Record<string, boolean>;
  } | null,
};

vi.mock('../stdio-client.js', () => ({
  StdioMcpClient: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock('../../native-messaging.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../installer/secrets.js', () => ({
  SecretStore: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockReturnValue(undefined),
    getSecretsForServer: vi.fn().mockReturnValue({}),
  })),
}));

describe('MCP Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset mock client state
    mockClient._connectionInfo = null;
    mockClient.isConnected.mockReturnValue(true);
    mockClient.connect.mockReset();
    mockClient.disconnect.mockReset();
    mockClient.listTools.mockResolvedValue([]);
    mockClient.listResources.mockResolvedValue([]);
    mockClient.listPrompts.mockResolvedValue([]);
    mockClient.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Success' }],
    });
    mockClient.readResource.mockResolvedValue([{ uri: 'test://resource', text: 'Content' }]);
    mockClient.getPrompt.mockResolvedValue([{ role: 'user', content: { type: 'text', text: 'Prompt' } }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runMcpRunner', () => {
    it('should be importable', async () => {
      const { runMcpRunner } = await import('../runner.js');
      expect(runMcpRunner).toBeDefined();
      expect(typeof runMcpRunner).toBe('function');
    });
  });

  describe('handleRunnerCommand', () => {
    it('should handle connect command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.connect.mockImplementation(async () => {
        mockClient._connectionInfo = {
          serverName: 'test-server',
          serverVersion: '1.0.0',
          protocolVersion: '2024-11-05',
          capabilities: { tools: true },
        };
      });
      mockClient.listTools.mockResolvedValue([{ name: 'tool1', description: 'Test' }]);

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '1',
        type: 'connect',
        command: 'npx',
        args: ['-y', 'test-server'],
        env: {},
      });

      expect(result.success).toBe(true);
      expect((result.data as { connectionInfo: { serverName: string } })?.connectionInfo?.serverName).toBe('test-server');
    });

    it('should handle disconnect command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '2',
        type: 'disconnect',
      });

      expect(result.success).toBe(true);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should handle list_tools command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.listTools.mockResolvedValue([
        { name: 'tool1', description: 'First' },
        { name: 'tool2', description: 'Second' },
      ]);

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '3',
        type: 'list_tools',
      });

      expect(result.success).toBe(true);
      expect((result.data as { tools: unknown[] })?.tools).toHaveLength(2);
    });

    it('should handle call_tool command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello, World!' }],
      });

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '4',
        type: 'call_tool',
        toolName: 'greet',
        toolArgs: { name: 'World' },
      });

      expect(result.success).toBe(true);
      expect((result.data as { result: { content: Array<{ text: string }> } })?.result?.content[0]?.text).toBe('Hello, World!');
      expect(mockClient.callTool).toHaveBeenCalledWith('greet', { name: 'World' });
    });

    it('should handle list_resources command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.listResources.mockResolvedValue([{ uri: 'test://resource', name: 'Test Resource' }]);

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '5',
        type: 'list_resources',
      });

      expect(result.success).toBe(true);
      expect((result.data as { resources: unknown[] })?.resources).toHaveLength(1);
    });

    it('should handle read_resource command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.readResource.mockResolvedValue([{ uri: 'test://resource', text: 'Content' }]);

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '6',
        type: 'read_resource',
        uri: 'test://resource',
      });

      expect(result.success).toBe(true);
      expect(mockClient.readResource).toHaveBeenCalledWith('test://resource');
    });

    it('should handle list_prompts command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.listPrompts.mockResolvedValue([{ name: 'prompt1', description: 'Test prompt' }]);

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '7',
        type: 'list_prompts',
      });

      expect(result.success).toBe(true);
      expect((result.data as { prompts: unknown[] })?.prompts).toHaveLength(1);
    });

    it('should handle get_prompt command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.getPrompt.mockResolvedValue([{ role: 'user', content: { type: 'text', text: 'Prompt' } }]);

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '8',
        type: 'get_prompt',
        promptName: 'prompt1',
        promptArgs: { context: 'test' },
      });

      expect(result.success).toBe(true);
      expect(mockClient.getPrompt).toHaveBeenCalledWith('prompt1', { context: 'test' });
    });

    it('should handle shutdown command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '9',
        type: 'shutdown',
      });

      expect(result.success).toBe(true);
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('should handle unknown command', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '10',
        type: 'unknown_command' as 'connect',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown command');
    });

    it('should handle errors in commands', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.callTool.mockRejectedValue(new Error('Tool execution failed'));

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '11',
        type: 'call_tool',
        toolName: 'failing_tool',
        toolArgs: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Tool execution failed');
    });

    it('should return not connected error when client not connected', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.isConnected.mockReturnValue(false);

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '12',
        type: 'list_tools',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not connected');
    });
  });

  describe('Crash Detection', () => {
    it('should detect client errors', async () => {
      const { handleRunnerCommand } = await import('../runner.js');

      mockClient.connect.mockRejectedValue(new Error('Connection refused'));

      const result = await handleRunnerCommand(mockClient as unknown as import('../stdio-client.js').StdioMcpClient, {
        id: '12',
        type: 'connect',
        command: 'npx',
        args: [],
        env: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });
  });
});
