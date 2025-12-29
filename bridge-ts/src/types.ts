/**
 * Shared types for the Harbor bridge.
 */

// =============================================================================
// Server Store Types
// =============================================================================

export enum ServerStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
}

export interface ServerConfig {
  id: string;
  label: string;
  baseUrl: string;
  status: ServerStatus;
  lastError?: string;
  addedAt: number;
  lastConnectedAt?: number;
}

// =============================================================================
// Catalog Types
// =============================================================================

export interface PackageInfo {
  registryType: 'npm' | 'pypi' | 'oci';
  identifier: string;
  environmentVariables: Array<{
    name: string;
    description?: string;
    isSecret?: boolean;
  }>;
}

export interface CatalogServer {
  id: string;
  name: string;
  source: string;
  endpointUrl: string;
  installableOnly: boolean;
  packages: PackageInfo[];
  description: string;
  homepageUrl: string;
  repositoryUrl: string;
  tags: string[];
  fetchedAt: number;
  isRemoved?: boolean;
  isFeatured?: boolean;
  priorityScore?: number;
}

export interface ProviderStatus {
  id: string;
  name: string;
  ok: boolean;
  count: number | null;
  error: string | null;
  fetchedAt: number | null;
}

export interface CatalogResult {
  servers: CatalogServer[];
  providerStatus: ProviderStatus[];
  fetchedAt: number;
  isStale?: boolean;
  stats?: {
    total: number;
    remote: number;
    removed: number;
    featured: number;
  };
  changes?: Array<{
    serverId: string;
    type: 'added' | 'updated' | 'removed' | 'restored';
    source: string;
    fieldChanges?: Record<string, unknown>;
  }>;
}

// =============================================================================
// Installer Types
// =============================================================================

export enum RuntimeType {
  NODE = 'node',
  PYTHON = 'python',
  DOCKER = 'docker',
}

export interface Runtime {
  type: RuntimeType;
  available: boolean;
  version: string | null;
  path: string | null;
  runnerCmd: string | null;
  installHint: string | null;
}

export enum ProcessState {
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  CRASHED = 'crashed',
  ERROR = 'error',
}

export interface ServerProcess {
  serverId: string;
  packageType: string;
  packageId: string;
  state: ProcessState;
  pid: number | null;
  startedAt: number | null;
  stoppedAt: number | null;
  exitCode: number | null;
  errorMessage: string | null;
  recentLogs: string[];
}

export interface InstalledServer {
  id: string;
  name: string;
  packageType: string;
  packageId: string;
  autoStart: boolean;
  args: string[];
  requiredEnvVars: Array<{
    name: string;
    description?: string;
    isSecret?: boolean;
  }>;
  installedAt: number;
  catalogSource: string | null;
  homepageUrl: string | null;
  description: string | null;
}

// =============================================================================
// MCP Types
// =============================================================================

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpConnectionResult {
  success: boolean;
  message: string;
  serverInfo?: {
    name?: string;
    version?: string;
    protocolVersion?: string;
  };
}

export interface McpToolResult {
  success: boolean;
  content?: unknown;
  error?: string;
}

// =============================================================================
// Message Types
// =============================================================================

export interface Message {
  type: string;
  request_id?: string;
  [key: string]: unknown;
}

export interface ErrorResponse {
  type: 'error';
  request_id: string;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ResultResponse {
  type: string;
  request_id: string;
  [key: string]: unknown;
}


