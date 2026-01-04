/**
 * Harbor Provider - Internal Transport
 * 
 * Transport implementation for extension pages that can use the provider-bridge port.
 * This allows extension pages to use the same provider router as injected pages.
 */

import browser from 'webextension-polyfill';
import type { Transport, StreamListener } from './transport';
import { generateRequestId } from './transport';

// =============================================================================
// Constants
// =============================================================================

const NAMESPACE = 'harbor-provider';

// =============================================================================
// Internal Transport Implementation
// =============================================================================

export function createInternalTransport(): Transport {
  const pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  
  const streamListeners = new Map<string, StreamListener>();
  
  // Use the same port as the content script so we go through the provider router
  let port: browser.Runtime.Port | null = null;
  
  function ensurePort(): browser.Runtime.Port {
    if (port) return port;
    
    port = browser.runtime.connect({ name: 'provider-bridge' });
    
    port.onMessage.addListener((message: { 
      namespace?: string;
      type: string; 
      requestId?: string; 
      payload?: { requestId?: string; event?: unknown; token?: unknown; error?: { code?: string; message?: string } };
    }) => {
      console.log('[InternalTransport] Received:', message.type, message.requestId);
      
      // Handle responses to pending requests
      const pending = pendingRequests.get(message.requestId || '');
      if (pending) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(message.requestId || '');
        
        if (message.type === 'error') {
          const err = new Error(message.payload?.error?.message || 'Unknown error') as Error & { code?: string };
          err.code = message.payload?.error?.code;
          pending.reject(err);
        } else {
          pending.resolve(message.payload);
        }
        return;
      }
      
      // Handle streaming events
      const streamRequestId = message.payload?.requestId || message.requestId;
      const listener = streamListeners.get(streamRequestId || '');
      
      if (listener) {
        if (message.type === 'text_session_stream_token') {
          listener.onToken(message.payload?.token as import('./types').StreamToken);
        } else if (message.type === 'text_session_stream_done') {
          listener.onToken({ type: 'done' });
          streamListeners.delete(streamRequestId || '');
        } else if (message.type === 'agent_run_event') {
          const event = message.payload?.event as import('./types').RunEvent;
          console.log('[InternalTransport] Received agent_run_event:', event?.type);
          listener.onEvent(event);
          if (event?.type === 'final' || event?.type === 'error') {
            streamListeners.delete(streamRequestId || '');
          }
        }
      }
    });
    
    port.onDisconnect.addListener(() => {
      console.log('[InternalTransport] Port disconnected');
      port = null;
      
      // Reject all pending requests
      for (const [requestId, pending] of pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Port disconnected'));
        pendingRequests.delete(requestId);
      }
    });
    
    return port;
  }
  
  return {
    async sendRequest<T>(type: string, payload?: unknown, timeoutMs = 30000): Promise<T> {
      const requestId = generateRequestId();
      
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error(`Request ${type} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        
        pendingRequests.set(requestId, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeout,
        });
        
        // Send through the port to go through provider router
        const p = ensurePort();
        p.postMessage({
          namespace: NAMESPACE,
          type,
          requestId,
          payload,
          origin: 'extension', // Mark as extension origin for permission handling
        });
      });
    },
    
    sendMessage(type: string, payload?: unknown): string {
      const requestId = generateRequestId();
      
      const p = ensurePort();
      p.postMessage({
        namespace: NAMESPACE,
        type,
        requestId,
        payload,
        origin: 'extension',
      });
      
      return requestId;
    },
    
    sendMessageWithId(requestId: string, type: string, payload?: unknown): void {
      const p = ensurePort();
      p.postMessage({
        namespace: NAMESPACE,
        type,
        requestId,
        payload,
        origin: 'extension',
      });
    },
    
    addStreamListener(requestId: string, listener: StreamListener): void {
      console.log('[InternalTransport] Adding stream listener for:', requestId);
      streamListeners.set(requestId, listener);
      ensurePort();
    },
    
    removeStreamListener(requestId: string): void {
      streamListeners.delete(requestId);
    },
    
    async isConnected(): Promise<boolean> {
      try {
        // Try a ping through the port
        const result = await this.sendRequest<{ type: string }>('ping', undefined, 5000);
        return result?.type === 'pong';
      } catch {
        return false;
      }
    },
  };
}

