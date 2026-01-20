/**
 * Sandbox preamble for JS MCP servers running in Web Workers.
 *
 * This code is prepended to server code to:
 * 1. Remove/neuter dangerous globals (fetch, XMLHttpRequest, WebSocket, importScripts)
 * 2. Provide controlled fetch via postMessage proxy
 * 3. Provide MCP stdio interface (MCP.readLine, MCP.writeLine)
 * 4. Provide process.env for secrets injection
 */

/**
 * Generates the sandbox preamble code that wraps server code.
 * This is injected at the start of the worker script.
 */
export function generateSandboxPreamble(): string {
  return `
// ============================================================================
// HARBOR JS MCP SANDBOX PREAMBLE
// ============================================================================

(function() {
  'use strict';

  // -------------------------------------------------------------------------
  // 1. Capture and remove dangerous globals
  // -------------------------------------------------------------------------
  
  const _originalFetch = globalThis.fetch;
  const _originalXHR = globalThis.XMLHttpRequest;
  const _originalWebSocket = globalThis.WebSocket;
  const _originalImportScripts = globalThis.importScripts;
  
  delete globalThis.fetch;
  delete globalThis.XMLHttpRequest;
  delete globalThis.WebSocket;
  delete globalThis.importScripts;
  
  // Also remove from self (Worker global)
  if (typeof self !== 'undefined') {
    delete self.fetch;
    delete self.XMLHttpRequest;
    delete self.WebSocket;
    delete self.importScripts;
  }

  // -------------------------------------------------------------------------
  // 2. Controlled fetch via postMessage proxy
  // -------------------------------------------------------------------------
  
  const pendingFetchRequests = new Map();
  
  globalThis.fetch = async function sandboxedFetch(input, init) {
    const id = crypto.randomUUID();
    const url = typeof input === 'string' ? input : input.url;
    
    // Serialize headers if present
    let headers = undefined;
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        headers = Object.fromEntries(init.headers.entries());
      } else if (Array.isArray(init.headers)) {
        headers = Object.fromEntries(init.headers);
      } else {
        headers = init.headers;
      }
    }
    
    // Serialize body if present
    let body = undefined;
    if (init?.body) {
      if (typeof init.body === 'string') {
        body = init.body;
      } else if (init.body instanceof ArrayBuffer) {
        body = { type: 'arraybuffer', data: Array.from(new Uint8Array(init.body)) };
      } else if (init.body instanceof Uint8Array) {
        body = { type: 'uint8array', data: Array.from(init.body) };
      } else {
        // Try to convert to string
        body = String(init.body);
      }
    }
    
    return new Promise((resolve, reject) => {
      pendingFetchRequests.set(id, { resolve, reject });
      
      self.postMessage({
        type: 'fetch-request',
        id,
        url,
        options: {
          method: init?.method,
          headers,
          body,
          mode: init?.mode,
          credentials: init?.credentials,
          cache: init?.cache,
          redirect: init?.redirect,
          referrer: init?.referrer,
          integrity: init?.integrity,
        },
      });
    });
  };

  // -------------------------------------------------------------------------
  // 3. MCP stdio interface
  // -------------------------------------------------------------------------
  
  const stdinQueue = [];
  let stdinResolver = null;
  
  globalThis.MCP = {
    /**
     * Read the next line from stdin (JSON-RPC request).
     * Returns a promise that resolves with the raw JSON string.
     */
    readLine: function() {
      return new Promise((resolve) => {
        if (stdinQueue.length > 0) {
          resolve(stdinQueue.shift());
        } else {
          stdinResolver = resolve;
        }
      });
    },
    
    /**
     * Write a line to stdout (JSON-RPC response).
     * @param {string} json - The JSON string to write
     */
    writeLine: function(json) {
      self.postMessage({ type: 'stdout', data: json });
    },
  };

  // -------------------------------------------------------------------------
  // 4. Process environment for secrets
  // -------------------------------------------------------------------------
  
  globalThis.process = {
    env: {},
    // Minimal process shim
    nextTick: function(callback) {
      setTimeout(callback, 0);
    },
    platform: 'browser',
    version: 'v0.0.0',
  };

  // -------------------------------------------------------------------------
  // 5. Console forwarding (optional enhancement)
  // -------------------------------------------------------------------------
  
  const _originalConsole = globalThis.console;
  globalThis.console = {
    log: function(...args) {
      self.postMessage({ type: 'console', level: 'log', args: args.map(String) });
      _originalConsole.log('[MCP Server]', ...args);
    },
    warn: function(...args) {
      self.postMessage({ type: 'console', level: 'warn', args: args.map(String) });
      _originalConsole.warn('[MCP Server]', ...args);
    },
    error: function(...args) {
      self.postMessage({ type: 'console', level: 'error', args: args.map(String) });
      _originalConsole.error('[MCP Server]', ...args);
    },
    info: function(...args) {
      self.postMessage({ type: 'console', level: 'info', args: args.map(String) });
      _originalConsole.info('[MCP Server]', ...args);
    },
    debug: function(...args) {
      self.postMessage({ type: 'console', level: 'debug', args: args.map(String) });
      _originalConsole.debug('[MCP Server]', ...args);
    },
  };

  // -------------------------------------------------------------------------
  // 6. Message handler for host communication
  // -------------------------------------------------------------------------
  
  self.addEventListener('message', function(event) {
    const data = event.data;
    if (!data || !data.type) return;
    
    switch (data.type) {
      case 'stdin':
        // Incoming MCP request
        if (stdinResolver) {
          stdinResolver(data.data);
          stdinResolver = null;
        } else {
          stdinQueue.push(data.data);
        }
        break;
        
      case 'fetch-response':
        // Response from fetch proxy
        const pending = pendingFetchRequests.get(data.id);
        if (pending) {
          pendingFetchRequests.delete(data.id);
          if (data.error) {
            pending.reject(new Error(data.error));
          } else {
            // Reconstruct Response object
            const responseInit = {
              status: data.status,
              statusText: data.statusText,
              headers: data.headers,
            };
            const response = new Response(data.body, responseInit);
            pending.resolve(response);
          }
        }
        break;
        
      case 'init-env':
        // Initialize environment variables
        Object.assign(globalThis.process.env, data.env);
        break;
        
      case 'terminate':
        // Clean shutdown request
        self.close();
        break;
    }
  });

  // -------------------------------------------------------------------------
  // 7. Signal ready
  // -------------------------------------------------------------------------
  
  self.postMessage({ type: 'ready' });

})();

// ============================================================================
// END SANDBOX PREAMBLE - SERVER CODE FOLLOWS
// ============================================================================

`;
}

/**
 * Wraps server code with the sandbox preamble.
 */
export function wrapServerCode(serverCode: string): string {
  return generateSandboxPreamble() + serverCode;
}
