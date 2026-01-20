/**
 * JS MCP Server session management.
 *
 * Creates and manages sandboxed Web Worker sessions for JS MCP servers.
 * This mirrors the WASM session (wasm/session.ts) but uses Web Workers
 * instead of WASI.
 */

import type { StdioEndpoint } from '../mcp/stdio-transport';
import type { McpServerManifest } from '../wasm/types';
import { wrapServerCode } from './sandbox';
import { setupFetchProxy } from './fetch-proxy';

export type JsSession = {
  endpoint: StdioEndpoint;
  close: () => void;
};

/**
 * Loads the server code from the manifest.
 * Supports loading from URL or inline base64.
 */
async function loadServerCode(manifest: McpServerManifest): Promise<string> {
  if (manifest.scriptBase64) {
    return atob(manifest.scriptBase64);
  }

  if (manifest.scriptUrl) {
    const response = await fetch(manifest.scriptUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch JS server: ${response.status}`);
    }
    return response.text();
  }

  throw new Error('JS server manifest must have scriptUrl or scriptBase64');
}

/**
 * Creates a stdio endpoint for communication with the worker.
 */
function createWorkerStdioEndpoint(): {
  endpoint: StdioEndpoint;
  sendToWorker: (data: string) => void;
  attachWorker: (worker: Worker) => void;
  close: () => void;
} {
  let handler: ((data: Uint8Array) => void) | null = null;
  let worker: Worker | null = null;
  const encoder = new TextEncoder();

  const endpoint: StdioEndpoint = {
    write(data: Uint8Array) {
      // Convert Uint8Array to string and send to worker
      const decoder = new TextDecoder();
      const jsonString = decoder.decode(data);
      if (worker) {
        worker.postMessage({ type: 'stdin', data: jsonString });
      }
    },
    onData(nextHandler: (data: Uint8Array) => void) {
      handler = nextHandler;
    },
  };

  const sendToWorker = (data: string) => {
    if (worker) {
      worker.postMessage({ type: 'stdin', data });
    }
  };

  const attachWorker = (w: Worker) => {
    worker = w;

    // Listen for stdout from worker
    worker.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'stdout') {
        // Convert string to Uint8Array and send to handler
        const encoded = encoder.encode(data.data + '\n');
        handler?.(encoded);
      } else if (data.type === 'console') {
        // Forward console messages
        const level = data.level as 'log' | 'warn' | 'error' | 'info' | 'debug';
        const args = data.args || [];
        console[level]?.('[JS MCP]', ...args);
      }
    });
  };

  return {
    endpoint,
    sendToWorker,
    attachWorker,
    close: () => {
      handler = null;
      worker = null;
    },
  };
}

/**
 * Creates a JS MCP server session in a sandboxed Web Worker.
 *
 * @param manifest - The server manifest with JS-specific fields
 * @returns A session with stdio endpoint and close function
 */
export async function createJsSession(
  manifest: McpServerManifest,
): Promise<JsSession> {
  // Validate that this is a JS server
  if (manifest.runtime !== 'js') {
    throw new Error(`Expected JS server, got runtime: ${manifest.runtime}`);
  }

  // Load and wrap server code with sandbox preamble
  const serverCode = await loadServerCode(manifest);
  const wrappedCode = wrapServerCode(serverCode);

  // Create worker from blob URL
  const blob = new Blob([wrappedCode], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);

  let worker: Worker;
  try {
    worker = new Worker(blobUrl);
  } finally {
    // Clean up blob URL after worker is created
    URL.revokeObjectURL(blobUrl);
  }

  // Create stdio endpoint
  const { endpoint, attachWorker, close: closeEndpoint } =
    createWorkerStdioEndpoint();
  attachWorker(worker);

  // Set up fetch proxy with capability enforcement
  const allowedHosts = manifest.capabilities?.network?.hosts || [];
  setupFetchProxy(worker, allowedHosts, (url, allowed) => {
    if (!allowed) {
      console.warn(
        `[Harbor] JS MCP server "${manifest.id}" attempted blocked fetch:`,
        url,
      );
    }
  });

  // Wait for worker to signal ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('JS server failed to initialize within timeout'));
    }, 5000);

    const readyHandler = (event: MessageEvent) => {
      if (event.data?.type === 'ready') {
        clearTimeout(timeout);
        worker.removeEventListener('message', readyHandler);
        resolve();
      }
    };

    worker.addEventListener('message', readyHandler);

    // Also handle errors during initialization
    worker.addEventListener('error', (event) => {
      clearTimeout(timeout);
      reject(
        new Error(`JS server error during initialization: ${event.message}`),
      );
    });
  });

  // Inject secrets as environment variables
  if (manifest.secrets && Object.keys(manifest.secrets).length > 0) {
    worker.postMessage({ type: 'init-env', env: manifest.secrets });
  }

  console.log('[Harbor] JS MCP server session started:', manifest.id);

  return {
    endpoint,
    close: () => {
      // Request clean shutdown
      worker.postMessage({ type: 'terminate' });

      // Force terminate after a short delay
      setTimeout(() => {
        worker.terminate();
      }, 100);

      closeEndpoint();
      console.log('[Harbor] JS MCP server session closed:', manifest.id);
    },
  };
}

/**
 * Creates a stub session for testing without actual server code.
 * Returns an endpoint that echoes tools/list with empty tools.
 */
export function createJsStubSession(manifest: McpServerManifest): JsSession {
  let handler: ((data: Uint8Array) => void) | null = null;
  const encoder = new TextEncoder();

  const endpoint: StdioEndpoint = {
    write(data: Uint8Array) {
      const decoder = new TextDecoder();
      const json = decoder.decode(data);
      try {
        const request = JSON.parse(json.trim());
        let response;

        if (request.method === 'tools/list') {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: { tools: manifest.tools || [] },
          };
        } else if (request.method === 'tools/call') {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [
                { type: 'text', text: 'Stub response from JS MCP server' },
              ],
            },
          };
        } else {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: 'Method not found' },
          };
        }

        // Send response back
        const responseData = encoder.encode(JSON.stringify(response) + '\n');
        setTimeout(() => handler?.(responseData), 0);
      } catch (e) {
        console.error('[Harbor] Stub session parse error:', e);
      }
    },
    onData(nextHandler: (data: Uint8Array) => void) {
      handler = nextHandler;
    },
  };

  return {
    endpoint,
    close: () => {
      handler = null;
      console.log('[Harbor] Closing JS stub session:', manifest.id);
    },
  };
}
