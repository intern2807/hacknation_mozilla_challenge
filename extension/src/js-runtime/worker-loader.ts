/**
 * Generic worker loader script.
 * This is compiled to a static file that can be loaded as a worker,
 * then receives the actual code to execute via postMessage.
 */

// Make this a module to avoid global scope conflicts
export {};

// In worker context, use globalThis which is already the worker scope

// Wait for code injection
globalThis.addEventListener('message', function initHandler(event: MessageEvent) {
  if (event.data?.type === 'load-code') {
    globalThis.removeEventListener('message', initHandler);
    
    const code = event.data.code;
    
    try {
      // Execute the sandboxed code
      // Using Function constructor instead of eval for slightly better scoping
      const fn = new Function(code);
      fn();
    } catch (e) {
      postMessage({ 
        type: 'error', 
        message: e instanceof Error ? e.message : String(e) 
      });
    }
  }
});

// Signal that loader is ready for code
postMessage({ type: 'loader-ready' });
