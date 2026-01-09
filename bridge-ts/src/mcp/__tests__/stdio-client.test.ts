/**
 * Unit tests for StdioMcpClient
 * 
 * These tests mock the MCP SDK to test our wrapper logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StdioMcpClient, StdioMcpClientOptions } from '../stdio-client.js';

// Mock the MCP SDK
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    close: vi.fn(),
    getServerVersion: vi.fn(),
    getServerCapabilities: vi.fn(),
    listTools: vi.fn(),
    listResources: vi.fn(),
    listPrompts: vi.fn(),
    callTool: vi.fn(),
    readResource: vi.fn(),
    getPrompt: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    stderr: null,
    onclose: null,
    onerror: null,
    pid: 12345,
    close: vi.fn(),
  })),
  getDefaultEnvironment: vi.fn().mockReturnValue({ PATH: '/usr/bin' }),
}));

// Mock our logging
vi.mock('../../native-messaging.js', () => ({
  log: vi.fn(),
}));

describe('StdioMcpClient', () => {
  let mockClient: {
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    getServerVersion: ReturnType<typeof vi.fn>;
    getServerCapabilities: ReturnType<typeof vi.fn>;
    listTools: ReturnType<typeof vi.fn>;
    listResources: ReturnType<typeof vi.fn>;
    listPrompts: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
    readResource: ReturnType<typeof vi.fn>;
    getPrompt: ReturnType<typeof vi.fn>;
  };
  
  let mockTransport: {
    stderr: { on: ReturnType<typeof vi.fn> } | null;
    onclose: (() => void) | null;
    onerror: ((error: Error) => void) | null;
    pid: number;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Get the mocked modules
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    
    // Create mock instances
    mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      getServerVersion: vi.fn().mockReturnValue({ name: 'test-server', version: '1.0.0' }),
      getServerCapabilities: vi.fn().mockReturnValue({ tools: true, resources: true, prompts: true }),
      listTools: vi.fn().mockResolvedValue({ tools: [] }),
      listResources: vi.fn().mockResolvedValue({ resources: [] }),
      listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
      readResource: vi.fn().mockResolvedValue({ contents: [{ text: 'content' }] }),
      getPrompt: vi.fn().mockResolvedValue({ description: 'test', messages: [] }),
    };
    
    mockTransport = {
      stderr: { on: vi.fn() },
      onclose: null,
      onerror: null,
      pid: 12345,
      close: vi.fn().mockResolvedValue(undefined),
    };
    
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockClient);
    (StdioClientTransport as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => mockTransport);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with default options', () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      
      expect(client).toBeDefined();
      expect(client.isConnected()).toBe(false);
      expect(client.getConnectionInfo()).toBeNull();
    });

    it('should accept custom environment variables', () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
        env: { API_KEY: 'secret' },
      };
      
      const client = new StdioMcpClient(options);
      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    it('should connect and return connection info', async () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      const connectionInfo = await client.connect();
      
      expect(connectionInfo).toEqual({
        serverName: 'test-server',
        serverVersion: '1.0.0',
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: true,
          resources: true,
          prompts: true,
        },
      });
      expect(client.isConnected()).toBe(true);
    });

    it('should return existing info if already connected', async () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      await client.connect();
      const info1 = client.getConnectionInfo();
      
      const info2 = await client.connect();
      
      expect(info2).toEqual(info1);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it('should throw on connection failure', async () => {
      mockClient.connect.mockRejectedValue(new Error('Connection refused'));
      
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      
      await expect(client.connect()).rejects.toThrow('Failed to connect to MCP server');
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should disconnect cleanly', async () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      await client.connect();
      await client.disconnect();
      
      expect(client.isConnected()).toBe(false);
      expect(client.getConnectionInfo()).toBeNull();
    });

    it('should be idempotent', async () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      await client.connect();
      await client.disconnect();
      await client.disconnect(); // Second call should not throw
      
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('listTools', () => {
    it('should list tools when connected', async () => {
      mockClient.listTools.mockResolvedValue({
        tools: [
          { name: 'tool1', description: 'First tool', inputSchema: { type: 'object' } },
          { name: 'tool2', description: 'Second tool' },
        ],
      });
      
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      await client.connect();
      const tools = await client.listTools();
      
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('tool1');
      expect(tools[1].name).toBe('tool2');
    });

    it('should throw when not connected', async () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      
      await expect(client.listTools()).rejects.toThrow('Not connected');
    });
  });

  describe('callTool', () => {
    it('should call tool and return result', async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello, world!' }],
      });
      
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      await client.connect();
      const result = await client.callTool('greet', { name: 'world' });
      
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe('Hello, world!');
    });

    it('should handle tool errors', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Tool execution failed'));
      
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      await client.connect();
      
      await expect(client.callTool('bad_tool', {})).rejects.toThrow('Failed to call tool');
    });
  });

  describe('crash handling', () => {
    it('should call onExit when transport closes unexpectedly', async () => {
      const onExit = vi.fn();
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
        onExit,
      };
      
      const client = new StdioMcpClient(options);
      await client.connect();
      
      // Simulate transport close
      mockTransport.onclose?.();
      
      expect(onExit).toHaveBeenCalledWith(null, null);
      expect(client.isConnected()).toBe(false);
    });

    it('should call onExit when transport errors', async () => {
      const onExit = vi.fn();
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
        onExit,
      };
      
      const client = new StdioMcpClient(options);
      await client.connect();
      
      // Simulate transport error
      mockTransport.onerror?.(new Error('Connection lost'));
      
      expect(onExit).toHaveBeenCalledWith(1, null);
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('getPid', () => {
    it('should return the process ID', () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      
      expect(client.getPid()).toBe(12345);
    });
  });

  describe('getStderrLog', () => {
    it('should return empty array initially', () => {
      const options: StdioMcpClientOptions = {
        command: 'npx',
        args: ['-y', 'test-server'],
      };
      
      const client = new StdioMcpClient(options);
      
      expect(client.getStderrLog()).toEqual([]);
    });
  });
});

