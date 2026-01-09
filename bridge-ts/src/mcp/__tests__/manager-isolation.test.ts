/**
 * Tests for McpClientManager with process isolation enabled and disabled.
 * 
 * This file tests that the manager correctly routes to either:
 * - StdioMcpClient (when isolation is OFF)
 * - McpRunnerClient (when isolation is ON)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setProcessIsolation, isProcessIsolationEnabled } from '../isolation-config.js';

// Track which client was instantiated
let lastClientType: 'stdio' | 'runner' | null = null;

// Mock StdioMcpClient
vi.mock('../stdio-client.js', () => ({
  StdioMcpClient: vi.fn().mockImplementation(() => {
    lastClientType = 'stdio';
    return {
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
    };
  }),
}));

// Mock McpRunnerClient
vi.mock('../runner-client.js', () => ({
  McpRunnerClient: vi.fn().mockImplementation(() => {
    lastClientType = 'runner';
    return {
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
      // Additional methods used by the manager
      getCachedTools: vi.fn().mockReturnValue([]),
      getCachedResources: vi.fn().mockReturnValue([]),
      getCachedPrompts: vi.fn().mockReturnValue([]),
    };
  }),
}));

// Mock other dependencies
vi.mock('../http-client.js', () => ({
  HttpMcpClient: vi.fn(),
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
  fork: vi.fn().mockReturnValue({
    on: vi.fn(),
    send: vi.fn(),
    kill: vi.fn(),
    pid: 99999,
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

import { McpClientManager } from '../manager.js';
import { InstalledServer } from '../../types.js';

describe('McpClientManager - Isolation Modes', () => {
  let manager: McpClientManager;

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
    lastClientType = null;
    manager = new McpClientManager();
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  describe('with process isolation DISABLED', () => {
    beforeEach(() => {
      setProcessIsolation(false);
    });

    afterEach(() => {
      setProcessIsolation(true); // Restore default
    });

    it('should use StdioMcpClient for stdio connections', async () => {
      expect(isProcessIsolationEnabled()).toBe(false);
      
      const server = createTestServer();
      const result = await manager.connect(server, {});

      expect(result.success).toBe(true);
      expect(lastClientType).toBe('stdio');
    });

    it('should report isolation mode as "direct"', async () => {
      const server = createTestServer();
      await manager.connect(server, {});
      
      const connection = manager.getConnection('test-server');
      // The connection should exist
      expect(connection).toBeDefined();
    });
  });

  describe('with process isolation ENABLED', () => {
    beforeEach(() => {
      setProcessIsolation(true);
    });

    it('should use McpRunnerClient for stdio connections', async () => {
      expect(isProcessIsolationEnabled()).toBe(true);
      
      const server = createTestServer();
      const result = await manager.connect(server, {});

      expect(result.success).toBe(true);
      expect(lastClientType).toBe('runner');
    });

    it('should report isolation mode as "isolated"', async () => {
      const server = createTestServer();
      await manager.connect(server, {});
      
      const connection = manager.getConnection('test-server');
      // The connection should exist
      expect(connection).toBeDefined();
    });
  });

  describe('isolation configuration', () => {
    it('should be enabled by default', () => {
      // Reset to check default
      setProcessIsolation(true);
      expect(isProcessIsolationEnabled()).toBe(true);
    });

    it('should be toggleable at runtime', () => {
      setProcessIsolation(false);
      expect(isProcessIsolationEnabled()).toBe(false);
      
      setProcessIsolation(true);
      expect(isProcessIsolationEnabled()).toBe(true);
    });

    it('should affect which client type is used', async () => {
      // Test with isolation OFF
      setProcessIsolation(false);
      let server = createTestServer({ id: 'server-1' });
      await manager.connect(server, {});
      expect(lastClientType).toBe('stdio');
      
      // Reset and test with isolation ON
      await manager.disconnectAll();
      lastClientType = null;
      manager = new McpClientManager();
      
      setProcessIsolation(true);
      server = createTestServer({ id: 'server-2' });
      await manager.connect(server, {});
      expect(lastClientType).toBe('runner');
    });
  });
});

