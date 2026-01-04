/**
 * Harbor Provider - Injected Transport
 * 
 * Transport implementation for web pages that use window.postMessage to communicate
 * with the content script, which then relays to the background.
 */

import type { Transport, StreamListener } from './transport';
import { generateRequestId } from './transport';
import type { RunEvent, StreamToken, ProviderMessage, PROVIDER_MESSAGE_NAMESPACE } from './types';

// =============================================================================
// Constants
// =============================================================================

const NAMESPACE = 'harbor-provider';

// =============================================================================
// Injected Transport Implementation
// =============================================================================

export function createInjectedTransport(): Transport {
  const pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  
  const streamListeners = new Map<string, StreamListener>();
  
  // Listen for responses from content script
  window.addEventListener('message', (event) => {
    // Only accept messages from same window
    if (event.source !== window) return;
    
    const data = event.data;
    if (!data || data.namespace !== NAMESPACE) return;
    
    // Only handle response types - ignore our own outgoing requests
    const isResponse = data.type.endsWith('_result') || 
                       data.type === 'error' ||
                       data.type === 'pong' ||
                       data.type.startsWith('text_session_stream_') ||
                       data.type === 'agent_run_event';
    
    if (!isResponse) {
      return;
    }
    
    console.log('[InjectedTransport] Received response:', data.type, data.requestId);
    if (data.type === 'error') {
      console.error('[InjectedTransport] ERROR RECEIVED:', data.payload?.error);
    }
    
    // Check if this is a response to a pending request
    const pending = pendingRequests.get(data.requestId);
    if (pending) {
      // Ignore responses with undefined payload (likely from stale content scripts)
      if (data.payload === undefined && data.type !== 'error') {
        console.log('[InjectedTransport] Ignoring response with undefined payload:', data.requestId);
        return;
      }
      
      clearTimeout(pending.timeout);
      pendingRequests.delete(data.requestId);
      
      if (data.type === 'error') {
        const err = new Error(data.payload?.error?.message || 'Unknown error') as Error & { code?: string };
        err.code = data.payload?.error?.code;
        pending.reject(err);
      } else {
        pending.resolve(data.payload);
      }
      return;
    }
    
    // Check for streaming events
    // Try both payload.requestId and data.requestId (error responses use data.requestId)
    const streamRequestId = data.payload?.requestId || data.requestId;
    const listener = streamListeners.get(streamRequestId);
    
    if (listener) {
      console.log('[InjectedTransport] Found stream listener, processing:', data.type);
      
      if (data.type === 'text_session_stream_token') {
        listener.onToken(data.payload.token as StreamToken);
      } else if (data.type === 'text_session_stream_done') {
        listener.onToken({ type: 'done' });
        streamListeners.delete(streamRequestId);
      } else if (data.type === 'agent_run_event') {
        const event = data.payload.event as RunEvent;
        listener.onEvent(event);
        if (event?.type === 'final' || event?.type === 'error') {
          streamListeners.delete(streamRequestId);
        }
      } else if (data.type === 'error') {
        // Handle error responses for streaming requests
        console.error('[InjectedTransport] Error for streaming request:', data.payload?.error);
        listener.onEvent({ 
          type: 'error', 
          error: { 
            code: data.payload?.error?.code || 'ERR_INTERNAL', 
            message: data.payload?.error?.message || 'Unknown error' 
          } 
        });
        streamListeners.delete(streamRequestId);
      }
    } else if (data.type === 'error') {
      // Error for unknown request - log it
      console.error('[InjectedTransport] Error for unknown request:', data.requestId, data.payload?.error);
    }
  });
  
  function postMessage(type: string, requestId: string, payload?: unknown): void {
    const message: ProviderMessage = {
      namespace: NAMESPACE as typeof PROVIDER_MESSAGE_NAMESPACE,
      type: type as ProviderMessage['type'],
      requestId,
      payload,
    };
    window.postMessage(message, '*');
  }
  
  return {
    async sendRequest<T>(type: string, payload?: unknown, timeoutMs = 30000): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const requestId = generateRequestId();
        
        const timeout = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error(`Request ${type} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        
        pendingRequests.set(requestId, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timeout,
        });
        
        postMessage(type, requestId, payload);
      });
    },
    
    sendMessage(type: string, payload?: unknown): string {
      const requestId = generateRequestId();
      postMessage(type, requestId, payload);
      return requestId;
    },
    
    sendMessageWithId(requestId: string, type: string, payload?: unknown): void {
      postMessage(type, requestId, payload);
    },
    
    addStreamListener(requestId: string, listener: StreamListener): void {
      console.log('[InjectedTransport] Adding stream listener for:', requestId);
      streamListeners.set(requestId, listener);
    },
    
    removeStreamListener(requestId: string): void {
      streamListeners.delete(requestId);
    },
    
    async isConnected(): Promise<boolean> {
      try {
        await this.sendRequest('ping', undefined, 5000);
        return true;
      } catch {
        return false;
      }
    },
  };
}

