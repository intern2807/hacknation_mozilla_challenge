/**
 * Harbor Provider Transport Layer
 * 
 * Abstract interface for communication between the provider API and the background.
 * This allows the same API implementation to work in both:
 * - Extension pages (using browser.runtime.sendMessage)
 * - Web pages (using window.postMessage via content script)
 */

import type { RunEvent, StreamToken } from './types';

// =============================================================================
// Stream Listener Types
// =============================================================================

export interface StreamListener {
  onToken: (token: StreamToken) => void;
  onEvent: (event: RunEvent) => void;
}

// =============================================================================
// Transport Interface
// =============================================================================

export interface Transport {
  /**
   * Send a message and wait for a response.
   * @param type - Message type
   * @param payload - Message payload
   * @param timeoutMs - Timeout in milliseconds (default: 30000)
   * @returns Promise resolving to the response payload
   */
  sendRequest<T>(type: string, payload?: unknown, timeoutMs?: number): Promise<T>;
  
  /**
   * Send a message without waiting for a response (fire and forget).
   * Returns the request ID for tracking.
   * @param type - Message type
   * @param payload - Message payload
   * @returns The request ID
   */
  sendMessage(type: string, payload?: unknown): string;
  
  /**
   * Send a message with a pre-generated request ID.
   * Used when you need to register listeners before sending.
   * @param requestId - The pre-generated request ID
   * @param type - Message type
   * @param payload - Message payload
   */
  sendMessageWithId(requestId: string, type: string, payload?: unknown): void;
  
  /**
   * Register a stream listener for receiving streaming events.
   * @param requestId - The request ID to listen for
   * @param listener - The listener callbacks
   */
  addStreamListener(requestId: string, listener: StreamListener): void;
  
  /**
   * Remove a stream listener.
   * @param requestId - The request ID to stop listening for
   */
  removeStreamListener(requestId: string): void;
  
  /**
   * Check if the transport is connected/available.
   * @returns Promise resolving to true if connected
   */
  isConnected(): Promise<boolean>;
}

// =============================================================================
// Transport Factory
// =============================================================================

export type TransportFactory = () => Transport;

// =============================================================================
// Shared Request ID Generator
// =============================================================================

let requestIdCounter = 0;

export function generateRequestId(): string {
  return `${Date.now()}-${++requestIdCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

