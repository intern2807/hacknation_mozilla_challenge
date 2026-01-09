/**
 * Unit tests for McpClientManager
 * 
 * Tests connection management, command building, and crash recovery.
 * 
 * Note: These tests run with process isolation DISABLED to test the
 * direct StdioMcpClient path. Process isolation (McpRunnerClient) is
 * tested separately in runner-client.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { McpClientManager, ConnectionResult } from '../manager.js';
import { InstalledServer } from '../../types.js';
import { setProcessIsolation } from '../index.js';

// Mock dependencies
vi.mock('../stdio-client.js', () => ({
  StdioMcpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({
      serverName: 'test-server',
      serverVersion: '1.0.0',
      protocolVersion: '2024-11-05',
      capabilities: { tools: true, resources: true, prompts: false },
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    listTools: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    listPrompts: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
    getStderrLog: vi.fn().mockReturnValue([]),
    getPid: vi.fn().mockReturnValue(12345),
  })),
}));

vi.mock('../http-client.js', () => ({
  HttpMcpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({
      serverName: 'http-server',
      serverVersion: '1.0.0',
      protocolVersion: '2024-11-05',
      capabilities: { tools: true, resources: false, prompts: false },
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    listTools: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    listPrompts: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
  })),
}));

vi.mock('../../native-messaging.js', () => ({
  log: vi.fn(),
}));

vi.mock('../../utils/resolve-executable.js', () => ({
  resolveExecutable: vi.fn((cmd: string) => `/usr/bin/${cmd}`),
  getEnhancedPath: vi.fn().mockReturnValue('/usr/bin:/usr/local/bin'),
}));

vi.mock('../../installer/binary-downloader.js', () => ({
  getBinaryPath: vi.fn().mockReturnValue('/home/user/.harbor/bin/test-server'),
  isLinuxBinaryDownloaded: vi.fn().mockReturnValue(false),
  downloadLinuxBinary: vi.fn().mockResolvedValue('/home/user/.harbor/bin/linux/test-server'),
}));

vi.mock('../../installer/github-resolver.js', () => ({
  getLinuxBinaryUrl: vi.fn().mockResolvedValue('https://github.com/test/test/releases/download/v1.0.0/test-linux'),
}));

vi.mock('../../installer/docker-images.js', () => ({
  getDockerImageManager: vi.fn().mockReturnValue({
    getImageTypeForPackage: vi.fn().mockReturnValue('node'),
    imageExists: vi.fn().mockResolvedValue(true),
    ensureImage: vi.fn().mockResolvedValue('harbor-mcp-node:latest'),
  }),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
      if (event === 'close') {
        setTimeout(() => cb(0), 10);
      }
    }),
  }),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/user'),
}));

describe('McpClientManager', () => {
  let manager: McpClientManager;

  // Disable process isolation for these tests - we're testing the direct StdioMcpClient path
  // Process isolation (McpRunnerClient) is tested separately in runner-client.test.ts
  beforeAll(() => {
    setProcessIsolation(false);
  });

  afterAll(() => {
    // Restore default (enabled)
    setProcessIsolation(true);
  });

  const createTestServer = (overrides: Partial<InstalledServer> = {}): InstalledServer => ({
    id: 'test-server',
    name: 'Test Server',
    packageType: 'npm',
    packageId: '@test/server',
    autoStart: false,
    args: [],
    requiredEnvVars: [],
    installedAt: Date.now(),
    catalogSource: null,
    homepageUrl: null,
    description: 'A test server',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new McpClientManager();
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  describe('connect', () => {
    it('should connect to npm package server', async () => {
      const server = createTestServer({
        packageType: 'npm',
        packageId: '@modelcontextprotocol/server-memory',
      });

      const result = await manager.connect(server, {});

      expect(result.success).toBe(true);
      expect(result.serverId).toBe('test-server');
      expect(result.connectionInfo?.serverName).toBe('test-server');
      expect(manager.isConnected('test-server')).toBe(true);
    });

    it('should connect to pypi package server', async () => {
      const server = createTestServer({
        packageType: 'pypi',
        packageId: 'mcp-server-test',
      });

      const result = await manager.connect(server, {});

      expect(result.success).toBe(true);
      expect(manager.isConnected('test-server')).toBe(true);
    });

    it('should connect to HTTP server', async () => {
      const server = createTestServer({
        packageType: 'http',
        packageId: 'http-server',
        remoteUrl: 'https://api.example.com/mcp',
      });

      const result = await manager.connect(server, {});

      expect(result.success).toBe(true);
      expect(result.connectionInfo?.serverName).toBe('http-server');
    });

    it('should return existing connection if already connected', async () => {
      const server = createTestServer();
      
      const result1 = await manager.connect(server, {});
      const result2 = await manager.connect(server, {});

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.connectionInfo).toEqual(result2.connectionInfo);
    });

    it('should fail for HTTP server without URL', async () => {
      const server = createTestServer({
        packageType: 'http',
        packageId: 'http-server',
        remoteUrl: undefined,
      });

      const result = await manager.connect(server, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('URL is not configured');
    });

    it('should pass secrets as environment variables', async () => {
      const { StdioMcpClient } = await import('../stdio-client.js');
      const server = createTestServer();
      const secrets = { API_KEY: 'secret123', DATABASE_URL: 'postgres://...' };

      await manager.connect(server, secrets);

      expect(StdioMcpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining(secrets),
        })
      );
    });
  });

  describe('disconnect', () => {
    it('should disconnect a connected server', async () => {
      const server = createTestServer();
      await manager.connect(server, {});
      
      const result = await manager.disconnect('test-server');

      expect(result).toBe(true);
      expect(manager.isConnected('test-server')).toBe(false);
    });

    it('should return false for unknown server', async () => {
      const result = await manager.disconnect('unknown-server');
      expect(result).toBe(false);
    });

    it('should handle disconnect errors gracefully', async () => {
      const { StdioMcpClient } = await import('../stdio-client.js');
      (StdioMcpClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue({
          serverName: 'test',
          serverVersion: '1.0.0',
          protocolVersion: '2024-11-05',
          capabilities: { tools: true, resources: false, prompts: false },
        }),
        disconnect: vi.fn().mockRejectedValue(new Error('Disconnect failed')),
        isConnected: vi.fn().mockReturnValue(true),
        listTools: vi.fn().mockResolvedValue([]),
        listResources: vi.fn().mockResolvedValue([]),
        listPrompts: vi.fn().mockResolvedValue([]),
        getStderrLog: vi.fn().mockReturnValue([]),
        getPid: vi.fn().mockReturnValue(12345),
      }));

      const server = createTestServer();
      await manager.connect(server, {});
      
      const result = await manager.disconnect('test-server');

      expect(result).toBe(true); // Should still return true
      expect(manager.isConnected('test-server')).toBe(false);
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect all servers', async () => {
      const server1 = createTestServer({ id: 'server1' });
      const server2 = createTestServer({ id: 'server2' });
      
      await manager.connect(server1, {});
      await manager.connect(server2, {});
      
      expect(manager.getConnectedServerIds()).toHaveLength(2);
      
      await manager.disconnectAll();

      expect(manager.getConnectedServerIds()).toHaveLength(0);
    });
  });

  describe('getConnection', () => {
    it('should return connection info', async () => {
      const server = createTestServer();
      await manager.connect(server, {});

      const connection = manager.getConnection('test-server');

      expect(connection).toBeDefined();
      expect(connection?.serverId).toBe('test-server');
      expect(connection?.installedServer).toEqual(server);
    });

    it('should return undefined for unknown server', () => {
      const connection = manager.getConnection('unknown');
      expect(connection).toBeUndefined();
    });
  });

  describe('getAllConnections', () => {
    it('should return all connections', async () => {
      const server1 = createTestServer({ id: 'server1' });
      const server2 = createTestServer({ id: 'server2' });
      
      await manager.connect(server1, {});
      await manager.connect(server2, {});

      const connections = manager.getAllConnections();

      expect(connections).toHaveLength(2);
      expect(connections.map(c => c.serverId)).toContain('server1');
      expect(connections.map(c => c.serverId)).toContain('server2');
    });
  });

  describe('crash handling', () => {
    it('should call onServerCrash callback', async () => {
      const onCrash = vi.fn();
      manager.setOnServerCrash(onCrash);

      const { StdioMcpClient } = await import('../stdio-client.js');
      let onExitCallback: ((code: number | null, signal: string | null) => void) | undefined;
      
      (StdioMcpClient as unknown as ReturnType<typeof vi.fn>).mockImplementation((options: { onExit?: (code: number | null, signal: string | null) => void }) => {
        onExitCallback = options.onExit;
        return {
          connect: vi.fn().mockResolvedValue({
            serverName: 'test',
            serverVersion: '1.0.0',
            protocolVersion: '2024-11-05',
            capabilities: { tools: true, resources: false, prompts: false },
          }),
          disconnect: vi.fn().mockResolvedValue(undefined),
          isConnected: vi.fn().mockReturnValue(true),
          listTools: vi.fn().mockResolvedValue([]),
          listResources: vi.fn().mockResolvedValue([]),
          listPrompts: vi.fn().mockResolvedValue([]),
          getStderrLog: vi.fn().mockReturnValue([]),
          getPid: vi.fn().mockReturnValue(12345),
        };
      });

      const server = createTestServer();
      await manager.connect(server, {});

      // Simulate crash
      onExitCallback?.(1, null);

      // Wait for async crash handling
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onCrash).toHaveBeenCalledWith('test-server', 1, 3);
    });

    it('should track crash status', async () => {
      const server = createTestServer();
      
      const status = manager.getCrashStatus('test-server');
      
      expect(status.restartCount).toBe(0);
      expect(status.lastCrashAt).toBeNull();
      expect(status.isRestarting).toBe(false);
    });

    it('should reset crash tracker', async () => {
      const server = createTestServer();
      await manager.connect(server, {});
      
      manager.resetCrashTracker('test-server');
      
      const status = manager.getCrashStatus('test-server');
      expect(status.restartCount).toBe(0);
    });
  });

  describe('tool operations', () => {
    it('should list tools from connected server', async () => {
      const { StdioMcpClient } = await import('../stdio-client.js');
      const mockTools = [
        { name: 'tool1', description: 'First tool' },
        { name: 'tool2', description: 'Second tool' },
      ];
      
      (StdioMcpClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue({
          serverName: 'test',
          serverVersion: '1.0.0',
          protocolVersion: '2024-11-05',
          capabilities: { tools: true, resources: false, prompts: false },
        }),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        listTools: vi.fn().mockResolvedValue(mockTools),
        listResources: vi.fn().mockResolvedValue([]),
        listPrompts: vi.fn().mockResolvedValue([]),
        getStderrLog: vi.fn().mockReturnValue([]),
        getPid: vi.fn().mockReturnValue(12345),
      }));

      const server = createTestServer();
      await manager.connect(server, {});

      const tools = await manager.listTools('test-server');

      expect(tools).toEqual(mockTools);
    });

    it('should throw for unconnected server', async () => {
      await expect(manager.listTools('unknown')).rejects.toThrow('Not connected');
    });

    it('should call tool on connected server', async () => {
      const mockResult = { content: [{ type: 'text', text: 'Hello!' }] };
      const { StdioMcpClient } = await import('../stdio-client.js');
      
      (StdioMcpClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue({
          serverName: 'test',
          serverVersion: '1.0.0',
          protocolVersion: '2024-11-05',
          capabilities: { tools: true, resources: false, prompts: false },
        }),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        listTools: vi.fn().mockResolvedValue([]),
        listResources: vi.fn().mockResolvedValue([]),
        listPrompts: vi.fn().mockResolvedValue([]),
        callTool: vi.fn().mockResolvedValue(mockResult),
        getStderrLog: vi.fn().mockReturnValue([]),
        getPid: vi.fn().mockReturnValue(12345),
      }));

      const server = createTestServer();
      await manager.connect(server, {});

      const result = await manager.callTool('test-server', 'greet', { name: 'World' });

      expect(result).toEqual(mockResult);
    });
  });

  describe('connection history', () => {
    it('should track successful connections', async () => {
      const server = createTestServer();
      
      expect(manager.hasConnectedBefore('test-server')).toBe(false);
      
      await manager.connect(server, {});
      
      expect(manager.hasConnectedBefore('test-server')).toBe(true);
    });
  });

  describe('getPid', () => {
    it('should return PID for connected server', async () => {
      const server = createTestServer();
      await manager.connect(server, {});

      const pid = manager.getPid('test-server');

      expect(pid).toBe(12345);
    });

    it('should return null for unknown server', () => {
      const pid = manager.getPid('unknown');
      expect(pid).toBeNull();
    });
  });

  describe('getStderrLog', () => {
    it('should return stderr log for connected server', async () => {
      const { StdioMcpClient } = await import('../stdio-client.js');
      
      (StdioMcpClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue({
          serverName: 'test',
          serverVersion: '1.0.0',
          protocolVersion: '2024-11-05',
          capabilities: { tools: true, resources: false, prompts: false },
        }),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        listTools: vi.fn().mockResolvedValue([]),
        listResources: vi.fn().mockResolvedValue([]),
        listPrompts: vi.fn().mockResolvedValue([]),
        getStderrLog: vi.fn().mockReturnValue(['Error: Something went wrong']),
        getPid: vi.fn().mockReturnValue(12345),
      }));

      const server = createTestServer();
      await manager.connect(server, {});

      const log = manager.getStderrLog('test-server');

      expect(log).toEqual(['Error: Something went wrong']);
    });

    it('should return empty array for unknown server', () => {
      const log = manager.getStderrLog('unknown');
      expect(log).toEqual([]);
    });
  });
});

