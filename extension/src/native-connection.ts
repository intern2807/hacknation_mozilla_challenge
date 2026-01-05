/**
 * Native Connection - Shared native messaging connection to the Harbor bridge.
 * 
 * This module is the single source of truth for the native connection.
 * Both background.ts and bridge-api.ts use this shared connection.
 */

import browser from 'webextension-polyfill';

const NATIVE_HOST_NAME = 'harbor_bridge_host';
export const REQUEST_TIMEOUT_MS = 30000;
export const CHAT_TIMEOUT_MS = 180000; // 3 minutes for chat (LLM + tools can be slow)
export const DOCKER_TIMEOUT_MS = 300000; // 5 minutes for Docker

export interface HarborMessage {
  type: string;
  request_id: string;
  [key: string]: unknown;
}

export interface BridgeResponse {
  type: string;
  request_id?: string;
  error?: { code?: string; message: string };
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (response: BridgeResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ConnectionState {
  connected: boolean;
  lastMessage: BridgeResponse | null;
  error: string | null;
}

let port: browser.Runtime.Port | null = null;
let connectionState: ConnectionState = {
  connected: false,
  lastMessage: null,
  error: null,
};

const pendingRequests = new Map<string, PendingRequest>();

// Callbacks for external listeners
type MessageCallback = (message: BridgeResponse) => void;
type DisconnectCallback = (error: string) => void;
type StateCallback = (state: ConnectionState) => void;

let onMessageCallback: MessageCallback | null = null;
let onDisconnectCallback: DisconnectCallback | null = null;
let onStateChangeCallback: StateCallback | null = null;

export function setMessageCallback(callback: MessageCallback | null): void {
  onMessageCallback = callback;
}

export function setDisconnectCallback(callback: DisconnectCallback | null): void {
  onDisconnectCallback = callback;
}

export function setStateChangeCallback(callback: StateCallback | null): void {
  onStateChangeCallback = callback;
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

function updateState(updates: Partial<ConnectionState>): void {
  connectionState = { ...connectionState, ...updates };
  browser.storage.local.set({ connectionState });
  onStateChangeCallback?.(connectionState);
  
  // Broadcast to any listening sidebars
  browser.runtime
    .sendMessage({ type: 'state_update', state: connectionState })
    .catch(() => {
      // No listeners, that's fine
    });
}

export function getConnectionState(): ConnectionState {
  return connectionState;
}

function handleNativeMessage(message: unknown): void {
  console.log('Received from native:', message);
  const response = message as BridgeResponse;

  updateState({
    connected: true,
    lastMessage: response,
    error: null,
  });

  // Resolve pending request if this is a response
  const requestId = response.request_id;
  if (requestId && pendingRequests.has(requestId)) {
    const pending = pendingRequests.get(requestId)!;
    clearTimeout(pending.timeout);
    pendingRequests.delete(requestId);
    pending.resolve(response);
  }

  // Call external message handler for broadcasts, status updates, etc.
  onMessageCallback?.(response);
}

function handleNativeDisconnect(): void {
  const error = browser.runtime.lastError?.message ?? 'Connection closed';
  console.error('Native port disconnected:', error);
  port = null;

  // Reject all pending requests
  for (const [requestId, pending] of pendingRequests.entries()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(`Connection lost: ${error}`));
    pendingRequests.delete(requestId);
  }

  updateState({
    connected: false,
    error,
  });

  onDisconnectCallback?.(error);
}

export function connectToNative(): boolean {
  if (port) {
    return true;
  }

  try {
    port = browser.runtime.connectNative(NATIVE_HOST_NAME);
    port.onMessage.addListener(handleNativeMessage);
    port.onDisconnect.addListener(handleNativeDisconnect);
    updateState({ connected: true, error: null });
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Failed to connect';
    console.error('Failed to connect to native host:', error);
    updateState({
      connected: false,
      error,
    });
    return false;
  }
}

export function disconnectNative(): void {
  if (port) {
    port.disconnect();
    port = null;
  }
}

export function isConnected(): boolean {
  return port !== null;
}

export async function sendToBridge(message: HarborMessage, timeoutMs?: number): Promise<BridgeResponse> {
  if (!port && !connectToNative()) {
    throw new Error('Not connected to native bridge');
  }

  const effectiveTimeout = timeoutMs || REQUEST_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(message.request_id);
      reject(new Error(`Request timed out after ${effectiveTimeout / 1000}s`));
    }, effectiveTimeout);

    pendingRequests.set(message.request_id, { resolve, reject, timeout });

    console.log('Sending to native:', message);
    port!.postMessage(message);
  });
}

export function sendHello(): void {
  const message: HarborMessage = {
    type: 'hello',
    request_id: generateRequestId(),
  };
  sendToBridge(message).catch((err) => {
    console.error('Failed to send hello:', err);
  });
}


