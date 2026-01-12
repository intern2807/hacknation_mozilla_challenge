/**
 * Message Handlers
 * 
 * This module organizes all message handlers into domain-specific files.
 * During migration, handlers are being moved from the monolithic handlers.ts
 * into separate files here.
 * 
 * Structure:
 * - context.ts: Handler types and response helpers
 * - catalog.ts: Catalog browsing and search
 * - (more to come: mcp.ts, llm.ts, auth.ts, chat.ts, installer.ts, host.ts)
 */

// Re-export types and helpers
export {
  // Types
  HandlerContext,
  MessageHandler,
  LegacyMessageHandler,
  
  // Response helpers
  makeError,
  makeResult,
  
  // Handler wrappers (reduce boilerplate)
  createContext,
  wrapHandler,
  withErrorHandling,
  requireFields,
  compose,
} from './context.js';

// Re-export catalog handlers
export {
  handleCatalogGet,
  handleCatalogRefresh,
  handleCatalogEnrich,
  handleCatalogSearch,
  setCatalogClient,
  getCatalogClientRef,
} from './catalog.js';

// Re-export MCP handlers
export {
  handleMcpDisconnect,
  handleMcpListConnections,
  handleMcpListTools,
  handleMcpListResources,
  handleMcpListPrompts,
  handleMcpCallTool,
  handleMcpReadResource,
  handleMcpGetPrompt,
  handleMcpGetLogs,
} from './mcp.js';

// Re-export LLM handlers
export {
  handleLlmDetect,
  handleLlmListProviders,
  handleLlmGetActive,
  handleLlmGetSupportedProviders,
  handleLlmGetConfig,
  handleLlmSetActive,
  handleLlmSetModel,
  handleLlmListModels,
  handleLlmListModelsFor,
  handleLlmSetApiKey,
  handleLlmRemoveApiKey,
  handleLlmChat,
  handleLlmSetupStatus,
  handleLlmDownloadModel,
  handleLlmDeleteModel,
  handleLlmStartLocal,
  handleLlmStopLocal,
} from './llm.js';

// Re-export auth handlers
export {
  // Credential handlers
  handleSetCredential,
  handleGetCredentialStatus,
  handleValidateCredentials,
  handleDeleteCredential,
  handleListCredentials,
  // OAuth handlers
  handleOAuthStart,
  handleOAuthCancel,
  handleOAuthRevoke,
  handleOAuthStatus,
  handleListOAuthProviders,
  // Manifest OAuth handlers
  handleCheckManifestOAuth,
  handleManifestOAuthStart,
  handleManifestOAuthStatus,
  handleGetOAuthCapabilities,
} from './auth.js';

// Re-export chat handlers
export {
  handleChatCreateSession,
  handleChatSendMessage,
  handleChatGetSession,
  handleChatListSessions,
  handleChatDeleteSession,
  handleChatUpdateSession,
  handleChatClearMessages,
} from './chat.js';

// Re-export host API handlers
export {
  handleHostGrantPermission,
  handleHostRevokePermission,
  handleHostCheckPermission,
  handleHostGetPermissions,
  handleHostExpireTabGrants,
  handleHostListTools,
  handleHostCallTool,
  handleHostGetStats,
} from './host.js';

// Re-export installer handlers
export {
  handleCheckRuntimes,
  handleResolveGitHub,
  handleResolveServerPackage,
  handleInstallServer,
  handleUninstallServer,
  handleAddRemoteServer,
  handleImportConfig,
  handleListInstalled,
  handleStartInstalled,
  handleStopInstalled,
  handleSetServerSecrets,
  handleUpdateServerArgs,
  handleGetServerStatus,
} from './installer.js';

// Re-export Docker handlers
export {
  handleCheckDocker,
  handleBuildDockerImages,
  handleSetDockerMode,
  handleShouldPreferDocker,
  handleReconnectOrphanedContainers,
} from './docker.js';

// Re-export curated directory handlers
export {
  handleGetCuratedServers,
  handleGetCuratedList,
  handleInstallCuratedServer,
  handleInstallCurated,
  handleInstallGithubRepo,
  handleInstallFromGitHub,
} from './curated.js';

