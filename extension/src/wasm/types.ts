/**
 * Runtime type for MCP servers.
 * - 'wasm': WebAssembly module running in WASI sandbox
 * - 'js': JavaScript running in sandboxed Web Worker
 */
export type McpServerRuntime = 'wasm' | 'js';

/**
 * Network capability configuration.
 * Defines which hosts the server is allowed to connect to.
 */
export type NetworkCapability = {
  /** Allowed host patterns, e.g., ["api.github.com", "*.googleapis.com", "*"] */
  hosts: string[];
};

/**
 * Capability configuration for MCP servers.
 */
export type McpServerCapabilities = {
  /** Network access configuration */
  network?: NetworkCapability;
};

/**
 * Tool definition for MCP servers.
 */
export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

/**
 * Unified manifest type for both WASM and JS MCP servers.
 */
export type McpServerManifest = {
  id: string;
  name: string;
  version: string;

  /**
   * Runtime type. Defaults to 'wasm' for backward compatibility.
   */
  runtime?: McpServerRuntime;

  // WASM-specific fields
  /** Entry point filename for WASM modules */
  entrypoint?: string;
  /** URL to fetch WASM module from */
  moduleUrl?: string;
  /** Base64-encoded WASM module bytes */
  moduleBytesBase64?: string;

  // JS-specific fields
  /** URL to fetch JS bundle from */
  scriptUrl?: string;
  /** Base64-encoded JS bundle */
  scriptBase64?: string;

  // Capability configuration
  /** Legacy permissions array (kept for compatibility) */
  permissions: string[];
  /** Structured capability configuration */
  capabilities?: McpServerCapabilities;

  // Environment configuration
  /** Environment variable names to pass through */
  env?: string[];
  /** Secret values to inject as process.env (name -> value) */
  secrets?: Record<string, string>;

  /** Tool definitions exposed by this server */
  tools?: McpToolDefinition[];
};

/**
 * Handle to a registered MCP server.
 */
export type McpServerHandle = {
  id: string;
  manifest: McpServerManifest;
};

// Legacy type aliases for backward compatibility
/** @deprecated Use McpServerManifest instead */
export type WasmServerManifest = McpServerManifest;
/** @deprecated Use McpServerHandle instead */
export type WasmServerHandle = McpServerHandle;
