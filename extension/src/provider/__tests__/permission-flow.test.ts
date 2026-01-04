/**
 * Permission Flow Tests
 * 
 * These tests verify the end-to-end permission flow, ensuring that:
 * 1. Permission requests are properly sent and handled
 * 2. Granted permissions enable API access
 * 3. Denied permissions block API access with proper errors
 * 4. Permission state is properly tracked
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Transport, StreamListener } from '../transport';
import type { PermissionScope, PermissionGrantResult, PermissionStatus, RunEvent } from '../types';
import { createAgentApi, createAiApi } from '../api-core';

// =============================================================================
// Mock Transport with Permission State
// =============================================================================

interface PermissionState {
  grantedScopes: Set<PermissionScope>;
  pendingRequest: {
    scopes: PermissionScope[];
    resolve: (result: PermissionGrantResult) => void;
  } | null;
  /** When true, permission requests will be denied */
  denyPermissionRequests: boolean;
}

function createPermissionAwareMockTransport() {
  const state: PermissionState = {
    grantedScopes: new Set(),
    pendingRequest: null,
    denyPermissionRequests: false,
  };
  
  const streamListeners = new Map<string, StreamListener>();
  let requestIdCounter = 0;
  
  const transport: Transport = {
    async sendRequest<T>(type: string, payload?: unknown): Promise<T> {
      switch (type) {
        case 'request_permissions': {
          const { scopes } = payload as { scopes: PermissionScope[] };
          
          // If configured to deny, return denied result
          if (state.denyPermissionRequests) {
            return {
              granted: false,
              grantedScopes: [],
            } as T;
          }
          
          // Simulate granting all requested scopes
          for (const scope of scopes) {
            state.grantedScopes.add(scope);
          }
          
          return {
            granted: true,
            grantedScopes: scopes,
          } as T;
        }
        
        case 'list_permissions': {
          const scopeStatus: Record<string, string> = {};
          for (const scope of state.grantedScopes) {
            scopeStatus[scope] = 'granted-always';
          }
          return {
            origin: 'http://test.com',
            scopes: scopeStatus,
          } as T;
        }
        
        case 'tools_list': {
          // Check if mcp:tools.list permission is granted
          if (!state.grantedScopes.has('mcp:tools.list')) {
            throw Object.assign(new Error('Permission required: mcp:tools.list'), {
              code: 'ERR_SCOPE_REQUIRED',
            });
          }
          return { tools: [{ name: 'test_tool', description: 'A test tool' }] } as T;
        }
        
        case 'tools_call': {
          if (!state.grantedScopes.has('mcp:tools.call')) {
            throw Object.assign(new Error('Permission required: mcp:tools.call'), {
              code: 'ERR_SCOPE_REQUIRED',
            });
          }
          return { success: true, result: 'tool result' } as T;
        }
        
        case 'active_tab_read': {
          if (!state.grantedScopes.has('browser:activeTab.read')) {
            throw Object.assign(new Error('Permission required: browser:activeTab.read'), {
              code: 'ERR_SCOPE_REQUIRED',
            });
          }
          return { title: 'Test', text: 'Content', url: 'http://test.com' } as T;
        }
        
        case 'create_text_session': {
          if (!state.grantedScopes.has('model:prompt')) {
            throw Object.assign(new Error('Permission required: model:prompt'), {
              code: 'ERR_SCOPE_REQUIRED',
            });
          }
          return { sessionId: 'session-123' } as T;
        }
        
        case 'text_session_prompt':
        case 'text_session_destroy':
          return {} as T;
        
        default:
          throw new Error(`Unknown request type: ${type}`);
      }
    },
    
    sendMessage(type: string, _payload?: unknown): string {
      return `req-${++requestIdCounter}`;
    },
    
    sendMessageWithId(requestId: string, type: string, payload?: unknown): void {
      // For agent_run, check model:tools permission
      if (type === 'agent_run') {
        if (!state.grantedScopes.has('model:tools')) {
          // Simulate error event
          setTimeout(() => {
            const listener = streamListeners.get(requestId);
            if (listener) {
              listener.onEvent({
                type: 'error',
                error: {
                  code: 'ERR_SCOPE_REQUIRED',
                  message: 'Permission required: model:tools',
                },
              });
            }
          }, 0);
          return;
        }
        
        // Simulate successful run
        setTimeout(() => {
          const listener = streamListeners.get(requestId);
          if (listener) {
            listener.onEvent({ type: 'status', message: 'Starting...' });
            listener.onEvent({ type: 'final', output: 'Task completed' });
          }
        }, 0);
      }
    },
    
    addStreamListener(requestId: string, listener: StreamListener): void {
      streamListeners.set(requestId, listener);
    },
    
    removeStreamListener(requestId: string): void {
      streamListeners.delete(requestId);
    },
    
    async isConnected(): Promise<boolean> {
      return true;
    },
  };
  
  return {
    transport,
    state,
    grantPermission: (scope: PermissionScope) => state.grantedScopes.add(scope),
    revokePermission: (scope: PermissionScope) => state.grantedScopes.delete(scope),
    clearPermissions: () => state.grantedScopes.clear(),
    setDenyPermissionRequests: (deny: boolean) => { state.denyPermissionRequests = deny; },
  };
}

// =============================================================================
// Permission Request Tests
// =============================================================================

describe('Permission Request Flow', () => {
  let mock: ReturnType<typeof createPermissionAwareMockTransport>;
  let agent: ReturnType<typeof createAgentApi>;
  let ai: ReturnType<typeof createAiApi>;
  
  beforeEach(() => {
    mock = createPermissionAwareMockTransport();
    agent = createAgentApi(mock.transport);
    ai = createAiApi(mock.transport);
  });
  
  it('should request and grant permissions', async () => {
    const result = await agent.requestPermissions({
      scopes: ['model:prompt', 'model:tools'],
      reason: 'Test reason',
    });
    
    expect(result.granted).toBe(true);
    expect(result.grantedScopes).toContain('model:prompt');
    expect(result.grantedScopes).toContain('model:tools');
  });
  
  it('should track granted permissions', async () => {
    await agent.requestPermissions({
      scopes: ['mcp:tools.list'],
    });
    
    // Permission should now be granted
    expect(mock.state.grantedScopes.has('mcp:tools.list')).toBe(true);
  });
  
  it('should list granted permissions', async () => {
    // Grant some permissions
    mock.grantPermission('model:prompt');
    mock.grantPermission('mcp:tools.list');
    
    const status = await agent.permissions.list();
    
    expect(status.scopes['model:prompt']).toBe('granted-always');
    expect(status.scopes['mcp:tools.list']).toBe('granted-always');
  });
});

// =============================================================================
// Permission Enforcement Tests
// =============================================================================

describe('Permission Enforcement', () => {
  let mock: ReturnType<typeof createPermissionAwareMockTransport>;
  let agent: ReturnType<typeof createAgentApi>;
  let ai: ReturnType<typeof createAiApi>;
  
  beforeEach(() => {
    mock = createPermissionAwareMockTransport();
    agent = createAgentApi(mock.transport);
    ai = createAiApi(mock.transport);
  });
  
  describe('tools.list', () => {
    it('should fail without mcp:tools.list permission', async () => {
      await expect(agent.tools.list()).rejects.toThrow('Permission required: mcp:tools.list');
    });
    
    it('should succeed with mcp:tools.list permission', async () => {
      mock.grantPermission('mcp:tools.list');
      
      const tools = await agent.tools.list();
      expect(tools).toBeDefined();
      expect(tools.length).toBeGreaterThan(0);
    });
  });
  
  describe('tools.call', () => {
    it('should fail without mcp:tools.call permission', async () => {
      await expect(agent.tools.call({ tool: 'test', args: {} }))
        .rejects.toThrow('Permission required: mcp:tools.call');
    });
    
    it('should succeed with mcp:tools.call permission', async () => {
      mock.grantPermission('mcp:tools.call');
      
      const result = await agent.tools.call({ tool: 'test', args: {} });
      expect(result).toBeDefined();
    });
  });
  
  describe('browser.activeTab.readability', () => {
    it('should fail without browser:activeTab.read permission', async () => {
      await expect(agent.browser.activeTab.readability())
        .rejects.toThrow('Permission required: browser:activeTab.read');
    });
    
    it('should succeed with browser:activeTab.read permission', async () => {
      mock.grantPermission('browser:activeTab.read');
      
      const tab = await agent.browser.activeTab.readability();
      expect(tab).toBeDefined();
      expect(tab.title).toBe('Test');
    });
  });
  
  describe('createTextSession', () => {
    it('should fail when permission request is denied', async () => {
      // Set the mock to deny all permission requests
      mock.setDenyPermissionRequests(true);
      
      await expect(ai.createTextSession())
        .rejects.toThrow('User denied AI permission');
    });
    
    it('should succeed with model:prompt permission', async () => {
      mock.grantPermission('model:prompt');
      
      const session = await ai.createTextSession();
      expect(session).toBeDefined();
      expect(typeof session.prompt).toBe('function');
    });
    
    it('should auto-request permission if not already granted', async () => {
      // Don't pre-grant permission - the API should request it
      const session = await ai.createTextSession();
      
      // Should have auto-requested and received permission
      expect(session).toBeDefined();
      expect(mock.state.grantedScopes.has('model:prompt')).toBe(true);
    });
  });
  
  describe('agent.run', () => {
    it('should fail without model:tools permission', async () => {
      const events: RunEvent[] = [];
      
      for await (const event of agent.run({ task: 'test' })) {
        events.push(event);
      }
      
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0].error?.code).toBe('ERR_SCOPE_REQUIRED');
    });
    
    it('should succeed with model:tools permission', async () => {
      mock.grantPermission('model:tools');
      
      const events: RunEvent[] = [];
      
      for await (const event of agent.run({ task: 'test' })) {
        events.push(event);
      }
      
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1].type).toBe('final');
    });
  });
});

// =============================================================================
// Permission Revocation Tests
// =============================================================================

describe('Permission Revocation', () => {
  let mock: ReturnType<typeof createPermissionAwareMockTransport>;
  let agent: ReturnType<typeof createAgentApi>;
  
  beforeEach(() => {
    mock = createPermissionAwareMockTransport();
    agent = createAgentApi(mock.transport);
  });
  
  it('should fail after permission is revoked', async () => {
    // Grant permission
    mock.grantPermission('mcp:tools.list');
    
    // Should succeed
    const tools = await agent.tools.list();
    expect(tools.length).toBeGreaterThan(0);
    
    // Revoke permission
    mock.revokePermission('mcp:tools.list');
    
    // Should fail now
    await expect(agent.tools.list()).rejects.toThrow();
  });
  
  it('should handle clearing all permissions', async () => {
    // Grant multiple permissions
    mock.grantPermission('model:prompt');
    mock.grantPermission('mcp:tools.list');
    mock.grantPermission('mcp:tools.call');
    
    // Clear all
    mock.clearPermissions();
    
    // All should fail
    await expect(agent.tools.list()).rejects.toThrow();
    await expect(agent.tools.call({ tool: 'test', args: {} })).rejects.toThrow();
  });
});

// =============================================================================
// Multiple Scope Request Tests
// =============================================================================

describe('Multiple Scope Requests', () => {
  let mock: ReturnType<typeof createPermissionAwareMockTransport>;
  let agent: ReturnType<typeof createAgentApi>;
  
  beforeEach(() => {
    mock = createPermissionAwareMockTransport();
    agent = createAgentApi(mock.transport);
  });
  
  it('should grant all requested scopes at once', async () => {
    const result = await agent.requestPermissions({
      scopes: ['model:prompt', 'model:tools', 'mcp:tools.list', 'mcp:tools.call'],
    });
    
    expect(result.granted).toBe(true);
    expect(result.grantedScopes).toHaveLength(4);
    
    // All permissions should now work
    expect(mock.state.grantedScopes.has('model:prompt')).toBe(true);
    expect(mock.state.grantedScopes.has('model:tools')).toBe(true);
    expect(mock.state.grantedScopes.has('mcp:tools.list')).toBe(true);
    expect(mock.state.grantedScopes.has('mcp:tools.call')).toBe(true);
  });
  
  it('should include reason in permission request', async () => {
    // This tests that the reason is passed through
    // (the mock doesn't do anything with it, but we verify the API accepts it)
    const result = await agent.requestPermissions({
      scopes: ['model:prompt'],
      reason: 'Need to access the LLM for chat functionality',
    });
    
    expect(result.granted).toBe(true);
  });
});

