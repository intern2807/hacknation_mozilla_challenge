/**
 * Tests for agent.run() async iterator behavior
 * 
 * These tests verify that:
 * 1. Events are properly queued before iteration starts
 * 2. The async iterator yields all events
 * 3. The final event properly terminates iteration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Transport, StreamListener } from '../transport';
import type { RunEvent } from '../types';
import { createAgentApi } from '../api-core';
// Note: createInjectedTransport requires window, only used in browser tests

// Mock transport that captures the stream listener
function createMockTransport() {
  let capturedListener: StreamListener | null = null;
  let capturedRequestId: string | null = null;
  
  const transport: Transport = {
    async sendRequest<T>(_type: string, _payload?: unknown, _timeoutMs?: number): Promise<T> {
      return {} as T;
    },
    
    sendMessage(_type: string, _payload?: unknown): string {
      return 'mock-request-id';
    },
    
    sendMessageWithId(requestId: string, _type: string, _payload?: unknown): void {
      capturedRequestId = requestId;
    },
    
    addStreamListener(requestId: string, listener: StreamListener): void {
      capturedRequestId = requestId;
      capturedListener = listener;
    },
    
    removeStreamListener(_requestId: string): void {
      capturedListener = null;
    },
    
    async isConnected(): Promise<boolean> {
      return true;
    },
  };
  
  return {
    transport,
    getListener: () => capturedListener,
    getRequestId: () => capturedRequestId,
    // Simulate sending events from the "background"
    sendEvent: (event: RunEvent) => {
      if (capturedListener) {
        capturedListener.onEvent(event);
      }
    },
  };
}

describe('agent.run() async iterator', () => {
  let mockTransport: ReturnType<typeof createMockTransport>;
  let agent: ReturnType<typeof createAgentApi>;
  
  beforeEach(() => {
    mockTransport = createMockTransport();
    agent = createAgentApi(mockTransport.transport);
  });
  
  it('should register listener before sending message', () => {
    // Start the run
    const iterable = agent.run({ task: 'test task' });
    
    // Listener should be registered immediately
    expect(mockTransport.getListener()).not.toBeNull();
    expect(mockTransport.getRequestId()).toBeTruthy();
  });
  
  it('should yield events that arrive before iteration starts', async () => {
    const events: RunEvent[] = [];
    
    // Start run - this registers listener and sends message
    const iterable = agent.run({ task: 'test task' });
    
    // Simulate events arriving BEFORE we start iterating
    mockTransport.sendEvent({ type: 'status', message: 'Starting...' });
    mockTransport.sendEvent({ type: 'tool_call', tool: 'test_tool', args: {} });
    mockTransport.sendEvent({ type: 'final', output: 'Done!' });
    
    // NOW start iterating - should get all events
    for await (const event of iterable) {
      events.push(event);
    }
    
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('status');
    expect(events[1].type).toBe('tool_call');
    expect(events[2].type).toBe('final');
    expect((events[2] as { output?: string }).output).toBe('Done!');
  });
  
  it('should yield events that arrive during iteration', async () => {
    const events: RunEvent[] = [];
    
    const iterable = agent.run({ task: 'test task' });
    const iterator = iterable[Symbol.asyncIterator]();
    
    // Start iteration - should wait for first event
    const firstPromise = iterator.next();
    
    // Send first event
    mockTransport.sendEvent({ type: 'status', message: 'Starting...' });
    
    const first = await firstPromise;
    expect(first.done).toBe(false);
    expect(first.value.type).toBe('status');
    events.push(first.value);
    
    // Request next - should wait
    const secondPromise = iterator.next();
    
    // Send more events
    mockTransport.sendEvent({ type: 'tool_call', tool: 'test_tool', args: {} });
    
    const second = await secondPromise;
    expect(second.done).toBe(false);
    expect(second.value.type).toBe('tool_call');
    events.push(second.value);
    
    // Request next - should wait
    const thirdPromise = iterator.next();
    
    // Send final event
    mockTransport.sendEvent({ type: 'final', output: 'Complete!' });
    
    const third = await thirdPromise;
    expect(third.done).toBe(false);
    expect(third.value.type).toBe('final');
    events.push(third.value);
    
    // Request next - should be done
    const fourth = await iterator.next();
    expect(fourth.done).toBe(true);
    
    expect(events).toHaveLength(3);
  });
  
  it('should handle mixed timing - some events before, some during iteration', async () => {
    const events: RunEvent[] = [];
    
    const iterable = agent.run({ task: 'test task' });
    
    // Some events arrive before iteration
    mockTransport.sendEvent({ type: 'status', message: 'Starting...' });
    mockTransport.sendEvent({ type: 'status', message: 'Processing...' });
    
    // Start iteration
    const iterator = iterable[Symbol.asyncIterator]();
    
    // Get first two (already queued)
    const first = await iterator.next();
    events.push(first.value);
    
    const second = await iterator.next();
    events.push(second.value);
    
    // Request third - should wait
    const thirdPromise = iterator.next();
    
    // Send more events during iteration
    mockTransport.sendEvent({ type: 'tool_call', tool: 'test', args: {} });
    
    const third = await thirdPromise;
    events.push(third.value);
    
    // Send final
    const fourthPromise = iterator.next();
    mockTransport.sendEvent({ type: 'final', output: 'Done!' });
    
    const fourth = await fourthPromise;
    events.push(fourth.value);
    
    // Should be done now
    const fifth = await iterator.next();
    expect(fifth.done).toBe(true);
    
    expect(events).toHaveLength(4);
    expect(events.map(e => e.type)).toEqual(['status', 'status', 'tool_call', 'final']);
  });
  
  it('should handle error events and stop iteration', async () => {
    const events: RunEvent[] = [];
    
    const iterable = agent.run({ task: 'test task' });
    
    // Send error event
    mockTransport.sendEvent({ type: 'status', message: 'Starting...' });
    mockTransport.sendEvent({ type: 'error', error: { code: 'ERR_TEST', message: 'Test error' } });
    
    for await (const event of iterable) {
      events.push(event);
    }
    
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('error');
  });
  
  it('should include output in final event', async () => {
    const iterable = agent.run({ task: 'test task' });
    
    mockTransport.sendEvent({ type: 'final', output: 'The answer is 42', citations: [] });
    
    let finalEvent: RunEvent | null = null;
    for await (const event of iterable) {
      finalEvent = event;
    }
    
    expect(finalEvent).not.toBeNull();
    expect(finalEvent!.type).toBe('final');
    expect((finalEvent as { output?: string }).output).toBe('The answer is 42');
  });
  
  it('should handle token events', async () => {
    const events: RunEvent[] = [];
    
    const iterable = agent.run({ task: 'test task' });
    
    // Send token events like the real implementation does
    mockTransport.sendEvent({ type: 'status', message: 'Processing...' });
    mockTransport.sendEvent({ type: 'token', token: 'The ' });
    mockTransport.sendEvent({ type: 'token', token: 'answer ' });
    mockTransport.sendEvent({ type: 'token', token: 'is ' });
    mockTransport.sendEvent({ type: 'token', token: '42' });
    mockTransport.sendEvent({ type: 'final', output: 'The answer is 42' });
    
    for await (const event of iterable) {
      events.push(event);
    }
    
    expect(events).toHaveLength(6);
    expect(events.filter(e => e.type === 'token')).toHaveLength(4);
    expect(events[events.length - 1].type).toBe('final');
  });
  
  it('should work with manual while loop iteration (like demo)', async () => {
    const events: RunEvent[] = [];
    
    // This mimics exactly what the demo does
    const iterable = agent.run({ task: 'test task' });
    console.log('Got iterable:', iterable);
    
    const iterator = iterable[Symbol.asyncIterator]();
    console.log('Got iterator:', iterator);
    console.log('Iterator has next:', typeof iterator.next);
    
    // Send events BEFORE iteration starts (like in real scenario)
    mockTransport.sendEvent({ type: 'status', message: 'Initializing...' });
    mockTransport.sendEvent({ type: 'tool_call', tool: 'test_tool', args: { foo: 'bar' } });
    mockTransport.sendEvent({ type: 'tool_result', tool: 'test_tool', result: 'success' });
    mockTransport.sendEvent({ type: 'token', token: 'Hello ' });
    mockTransport.sendEvent({ type: 'token', token: 'world' });
    mockTransport.sendEvent({ type: 'final', output: 'Hello world', citations: [] });
    
    console.log('About to start iterating...');
    
    // Manual while loop - exactly like the demo
    let iterCount = 0;
    while (true) {
      console.log('Calling next() iteration:', ++iterCount);
      const result = await iterator.next();
      console.log('next() returned:', result.done, result.value?.type);
      
      if (result.done) {
        console.log('Iterator done, breaking');
        break;
      }
      
      const event = result.value;
      console.log('Got event:', event.type);
      events.push(event);
    }
    
    expect(events).toHaveLength(6);
    expect(events.map(e => e.type)).toEqual([
      'status', 'tool_call', 'tool_result', 'token', 'token', 'final'
    ]);
    
    const finalEvent = events[5] as { type: string; output?: string };
    expect(finalEvent.output).toBe('Hello world');
  });
  
  it('should handle events arriving during iteration', async () => {
    const events: RunEvent[] = [];
    
    const iterable = agent.run({ task: 'test task' });
    const iterator = iterable[Symbol.asyncIterator]();
    
    // Start iteration - will wait for first event
    const firstPromise = iterator.next();
    
    // Simulate event arriving after iterator.next() was called
    setTimeout(() => {
      mockTransport.sendEvent({ type: 'status', message: 'Starting...' });
    }, 10);
    
    const first = await firstPromise;
    expect(first.done).toBe(false);
    expect(first.value.type).toBe('status');
    events.push(first.value);
    
    // Now send remaining events
    mockTransport.sendEvent({ type: 'tool_call', tool: 'test', args: {} });
    mockTransport.sendEvent({ type: 'final', output: 'Done!' });
    
    // Continue iteration
    const second = await iterator.next();
    expect(second.value.type).toBe('tool_call');
    events.push(second.value);
    
    const third = await iterator.next();
    expect(third.value.type).toBe('final');
    events.push(third.value);
    
    const fourth = await iterator.next();
    expect(fourth.done).toBe(true);
    
    expect(events).toHaveLength(3);
  });
});

// Browser-specific tests removed - they require window which isn't available in Node
