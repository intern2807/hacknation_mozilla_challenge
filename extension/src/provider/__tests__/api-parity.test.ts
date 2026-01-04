/**
 * API Parity Tests
 * 
 * These tests ensure that the injected API (for web pages) and internal API
 * (for extension pages) behave identically. Both should use the shared
 * api-core.ts implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Transport, StreamListener } from '../transport';
import type { RunEvent, PermissionGrantResult, PermissionStatus, ToolDescriptor } from '../types';
import { createAiApi, createAgentApi } from '../api-core';

// =============================================================================
// Mock Transport Factory
// =============================================================================

interface MockTransportState {
  sentRequests: Array<{ type: string; payload: unknown }>;
  sentMessages: Array<{ type: string; payload: unknown; requestId: string }>;
  streamListeners: Map<string, StreamListener>;
  mockResponses: Map<string, unknown>;
}

function createMockTransport(): { transport: Transport; state: MockTransportState } {
  const state: MockTransportState = {
    sentRequests: [],
    sentMessages: [],
    streamListeners: new Map(),
    mockResponses: new Map(),
  };
  
  let requestIdCounter = 0;
  
  const transport: Transport = {
    async sendRequest<T>(type: string, payload?: unknown): Promise<T> {
      state.sentRequests.push({ type, payload });
      
      // Return mock response if configured
      if (state.mockResponses.has(type)) {
        return state.mockResponses.get(type) as T;
      }
      
      // Default responses for common types
      switch (type) {
        case 'request_permissions':
          return { granted: true, grantedScopes: (payload as { scopes: string[] })?.scopes } as T;
        case 'list_permissions':
          return { origin: 'test', scopes: {} } as T;
        case 'tools_list':
          return { tools: [] } as T;
        case 'tools_call':
          return { success: true, result: 'mock result' } as T;
        case 'active_tab_read':
          return { title: 'Test Page', text: 'Test content', url: 'http://test.com' } as T;
        case 'create_text_session':
          return { sessionId: 'test-session-id' } as T;
        case 'text_session_prompt':
          return { result: 'Mock response' } as T;
        case 'text_session_destroy':
          return {} as T;
        default:
          throw new Error(`No mock response for ${type}`);
      }
    },
    
    sendMessage(type: string, payload?: unknown): string {
      const requestId = `test-${++requestIdCounter}`;
      state.sentMessages.push({ type, payload, requestId });
      return requestId;
    },
    
    sendMessageWithId(requestId: string, type: string, payload?: unknown): void {
      state.sentMessages.push({ type, payload, requestId });
    },
    
    addStreamListener(requestId: string, listener: StreamListener): void {
      state.streamListeners.set(requestId, listener);
    },
    
    removeStreamListener(requestId: string): void {
      state.streamListeners.delete(requestId);
    },
    
    async isConnected(): Promise<boolean> {
      return true;
    },
  };
  
  return { transport, state };
}

// =============================================================================
// API Parity Tests
// =============================================================================

describe('API Parity - Both transports should behave identically', () => {
  let mock1: ReturnType<typeof createMockTransport>;
  let mock2: ReturnType<typeof createMockTransport>;
  let aiApi1: ReturnType<typeof createAiApi>;
  let aiApi2: ReturnType<typeof createAiApi>;
  let agentApi1: ReturnType<typeof createAgentApi>;
  let agentApi2: ReturnType<typeof createAgentApi>;
  
  beforeEach(() => {
    mock1 = createMockTransport();
    mock2 = createMockTransport();
    aiApi1 = createAiApi(mock1.transport);
    aiApi2 = createAiApi(mock2.transport);
    agentApi1 = createAgentApi(mock1.transport);
    agentApi2 = createAgentApi(mock2.transport);
  });
  
  describe('window.ai API', () => {
    it('createTextSession should send same request structure', async () => {
      await aiApi1.createTextSession({ systemPrompt: 'Test prompt' });
      await aiApi2.createTextSession({ systemPrompt: 'Test prompt' });
      
      expect(mock1.state.sentRequests[0].type).toBe(mock2.state.sentRequests[0].type);
      expect(mock1.state.sentRequests[0].payload).toEqual(mock2.state.sentRequests[0].payload);
    });
    
    it('canCreateTextSession should return same result', async () => {
      const result1 = await aiApi1.canCreateTextSession();
      const result2 = await aiApi2.canCreateTextSession();
      
      expect(result1).toBe(result2);
      expect(result1).toBe('readily'); // Default when connected
    });
    
    it('languageModel.capabilities should return same structure', async () => {
      const caps1 = await aiApi1.languageModel.capabilities();
      const caps2 = await aiApi2.languageModel.capabilities();
      
      expect(caps1).toEqual(caps2);
      expect(caps1.available).toBe('readily');
    });
    
    it('languageModel.create should work identically', async () => {
      const session1 = await aiApi1.languageModel.create({ systemPrompt: 'Test' });
      const session2 = await aiApi2.languageModel.create({ systemPrompt: 'Test' });
      
      expect(typeof session1.prompt).toBe('function');
      expect(typeof session2.prompt).toBe('function');
      expect(typeof session1.promptStreaming).toBe('function');
      expect(typeof session2.promptStreaming).toBe('function');
    });
  });
  
  describe('window.agent API', () => {
    it('requestPermissions should send same request structure', async () => {
      const options = {
        scopes: ['model:prompt', 'model:tools'] as const,
        reason: 'Test reason',
      };
      
      await agentApi1.requestPermissions(options);
      await agentApi2.requestPermissions(options);
      
      expect(mock1.state.sentRequests[0].type).toBe('request_permissions');
      expect(mock2.state.sentRequests[0].type).toBe('request_permissions');
      expect(mock1.state.sentRequests[0].payload).toEqual(mock2.state.sentRequests[0].payload);
    });
    
    it('permissions.list should send same request', async () => {
      await agentApi1.permissions.list();
      await agentApi2.permissions.list();
      
      expect(mock1.state.sentRequests[0].type).toBe('list_permissions');
      expect(mock2.state.sentRequests[0].type).toBe('list_permissions');
    });
    
    it('tools.list should send same request', async () => {
      await agentApi1.tools.list();
      await agentApi2.tools.list();
      
      expect(mock1.state.sentRequests[0].type).toBe('tools_list');
      expect(mock2.state.sentRequests[0].type).toBe('tools_list');
    });
    
    it('tools.call should send same request structure', async () => {
      const callOptions = { tool: 'test_tool', args: { param: 'value' } };
      
      await agentApi1.tools.call(callOptions);
      await agentApi2.tools.call(callOptions);
      
      expect(mock1.state.sentRequests[0].type).toBe('tools_call');
      expect(mock2.state.sentRequests[0].type).toBe('tools_call');
      expect(mock1.state.sentRequests[0].payload).toEqual(mock2.state.sentRequests[0].payload);
    });
    
    it('browser.activeTab.readability should send same request', async () => {
      await agentApi1.browser.activeTab.readability();
      await agentApi2.browser.activeTab.readability();
      
      expect(mock1.state.sentRequests[0].type).toBe('active_tab_read');
      expect(mock2.state.sentRequests[0].type).toBe('active_tab_read');
    });
    
    it('run should register listener before sending message', () => {
      const runOptions = { task: 'Test task', maxToolCalls: 5 };
      
      // Start runs
      agentApi1.run(runOptions);
      agentApi2.run(runOptions);
      
      // Both should have sent agent_run message
      expect(mock1.state.sentMessages[0].type).toBe('agent_run');
      expect(mock2.state.sentMessages[0].type).toBe('agent_run');
      
      // Both should have registered stream listeners
      expect(mock1.state.streamListeners.size).toBe(1);
      expect(mock2.state.streamListeners.size).toBe(1);
      
      // Payloads should be identical
      expect(mock1.state.sentMessages[0].payload).toEqual(mock2.state.sentMessages[0].payload);
    });
    
    it('run should yield events in same order', async () => {
      const runOptions = { task: 'Test task' };
      
      const iterable1 = agentApi1.run(runOptions);
      const iterable2 = agentApi2.run(runOptions);
      
      // Get request IDs
      const requestId1 = mock1.state.sentMessages[0].requestId;
      const requestId2 = mock2.state.sentMessages[0].requestId;
      
      // Send same events to both
      const events: RunEvent[] = [
        { type: 'status', message: 'Starting...' },
        { type: 'tool_call', tool: 'test_tool', args: { a: 1 } },
        { type: 'tool_result', tool: 'test_tool', result: 'result' },
        { type: 'final', output: 'Done!' },
      ];
      
      for (const event of events) {
        mock1.state.streamListeners.get(requestId1)?.onEvent(event);
        mock2.state.streamListeners.get(requestId2)?.onEvent(event);
      }
      
      // Collect events from both
      const collected1: RunEvent[] = [];
      const collected2: RunEvent[] = [];
      
      for await (const event of iterable1) {
        collected1.push(event);
      }
      for await (const event of iterable2) {
        collected2.push(event);
      }
      
      // Should receive same events in same order
      expect(collected1).toEqual(collected2);
      expect(collected1.map(e => e.type)).toEqual(['status', 'tool_call', 'tool_result', 'final']);
    });
  });
});

// =============================================================================
// Session API Parity Tests
// =============================================================================

describe('TextSession API Parity', () => {
  let mock: ReturnType<typeof createMockTransport>;
  let aiApi: ReturnType<typeof createAiApi>;
  
  beforeEach(() => {
    mock = createMockTransport();
    aiApi = createAiApi(mock.transport);
  });
  
  it('session.prompt should send correct request', async () => {
    const session = await aiApi.createTextSession();
    await session.prompt('Hello');
    
    const promptRequest = mock.state.sentRequests.find(r => r.type === 'text_session_prompt');
    expect(promptRequest).toBeDefined();
    expect(promptRequest?.payload).toMatchObject({ input: 'Hello' });
  });
  
  it('session.destroy should send correct request', async () => {
    const session = await aiApi.createTextSession();
    await session.destroy();
    
    const destroyRequest = mock.state.sentRequests.find(r => r.type === 'text_session_destroy');
    expect(destroyRequest).toBeDefined();
  });
  
  it('session should have all required methods', async () => {
    const session = await aiApi.createTextSession();
    
    expect(typeof session.prompt).toBe('function');
    expect(typeof session.promptStreaming).toBe('function');
    expect(typeof session.destroy).toBe('function');
    expect(typeof session.clone).toBe('function');
  });
  
  it('session.clone should create independent session', async () => {
    const session1 = await aiApi.createTextSession({ systemPrompt: 'Original' });
    const session2 = await session1.clone();
    
    // Both should be able to prompt independently
    expect(typeof session2.prompt).toBe('function');
    expect(typeof session2.destroy).toBe('function');
  });
});

