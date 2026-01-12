/**
 * Installer Handlers
 * 
 * Handles server installation, lifecycle management, and package resolution.
 * Includes support for manifest-based installation, Docker, and runtime checks.
 */

import * as M from '../message-types.js';
import { HandlerContext, MessageHandler, withErrorHandling, requireFields } from './context.js';
import { CatalogServer } from '../types.js';
import { log } from '../native-messaging.js';
import { 
  resolveGitHubPackage, 
  parseMcpConfig, 
  parseVSCodeInstallUrl,
  ParsedServer,
} from '../installer/index.js';
import { fetchManifestFromGitHub } from '../installer/manifest.js';

// =============================================================================
// Runtime & Resolution Handlers
// =============================================================================

/**
 * Check available runtimes (Node.js, Python, etc).
 */
export const handleCheckRuntimes: MessageHandler = withErrorHandling(
  'check_runtimes_result',
  'runtime_error',
  async (ctx) => {
    const result = await ctx.installer.checkRuntimes();
    return result;
  }
);

/**
 * Resolve package info from a GitHub URL.
 */
export const handleResolveGitHub: MessageHandler = requireFields(
  ['github_url'],
  withErrorHandling('resolve_github_result', 'resolve_error', async (ctx) => {
    const githubUrl = ctx.message.github_url as string;
    
    const resolved = await resolveGitHubPackage(githubUrl);
    
    if (!resolved) {
      throw new Error('Could not resolve package info from GitHub URL');
    }

    return { 
      package: resolved,
      canInstall: !!resolved.name,
    };
  })
);

/**
 * Resolve package info for a server by ID and cache it in the database.
 */
export const handleResolveServerPackage: MessageHandler = requireFields(
  ['server_id'],
  async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const db = ctx.catalog.getDatabase();
    
    // Check if we already have resolved info
    const cached = db.getResolvedPackage(serverId);
    if (cached && cached.resolvedAt) {
      log(`[handleResolveServerPackage] Using cached package info for ${serverId}`);
      return ctx.result('resolve_server_package_result', {
        serverId,
        packageType: cached.packageType,
        packageId: cached.packageId,
        cached: true,
      });
    }

    // Get the server from catalog
    const servers = db.getAllServers({ includeRemoved: false });
    const server = servers.find((s: CatalogServer) => s.id === serverId);
    
    if (!server) {
      return ctx.error('not_found', 'Server not found');
    }

    // If server already has package info from registry, use that
    if (server.packages && server.packages.length > 0 && server.packages[0].identifier) {
      const pkg = server.packages[0];
      // We support npm, pypi, and binary - skip oci for now
      const pkgType = pkg.registryType === 'oci' ? null : pkg.registryType;
      db.updateResolvedPackage(serverId, pkgType, pkg.identifier);
      return ctx.result('resolve_server_package_result', {
        serverId,
        packageType: pkgType,
        packageId: pkg.identifier,
        cached: false,
      });
    }

    // Try to resolve from GitHub
    const githubUrl = server.homepageUrl || server.repositoryUrl;
    if (!githubUrl || !githubUrl.includes('github.com')) {
      // Can't resolve - no GitHub URL
      db.updateResolvedPackage(serverId, null, null);
      return ctx.result('resolve_server_package_result', {
        serverId,
        packageType: null,
        packageId: null,
        cached: false,
      });
    }

    try {
      log(`[handleResolveServerPackage] Resolving from GitHub: ${githubUrl}`);
      const resolved = await resolveGitHubPackage(githubUrl);
      
      if (resolved && resolved.name) {
        const packageType = resolved.type === 'python' ? 'pypi' : 'npm';
        db.updateResolvedPackage(serverId, packageType as 'npm' | 'pypi', resolved.name);
        return ctx.result('resolve_server_package_result', {
          serverId,
          packageType,
          packageId: resolved.name,
          cached: false,
        });
      }
      
      // Could not resolve
      db.updateResolvedPackage(serverId, null, null);
      return ctx.result('resolve_server_package_result', {
        serverId,
        packageType: null,
        packageId: null,
        cached: false,
      });
    } catch (e) {
      log(`[handleResolveServerPackage] Failed to resolve: ${e}`);
      return ctx.error('resolve_error', e instanceof Error ? e.message : String(e));
    }
  }
);

// =============================================================================
// Installation Handlers
// =============================================================================

/**
 * Install a server from a catalog entry.
 * First checks for a manifest file (manifest-first approach),
 * then falls back to best-effort package resolution.
 */
export const handleInstallServer: MessageHandler = requireFields(
  ['catalog_entry'],
  async (ctx) => {
    const catalogEntry = ctx.message.catalog_entry as CatalogServer;
    const packageIndex = (ctx.message.package_index as number) || 0;

    try {
      // First, check if the repo has a manifest file (manifest-first approach)
      const repoUrl = catalogEntry.repositoryUrl || catalogEntry.homepageUrl || '';
      const githubMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\#\?]+)/);
      
      if (githubMatch) {
        const [, owner, repo] = githubMatch;
        const cleanRepo = repo.replace(/\.git$/, '');
        
        log(`[handleInstallServer] Checking for manifest in ${owner}/${cleanRepo}`);
        const manifest = await fetchManifestFromGitHub(owner, cleanRepo);
        
        if (manifest) {
          log(`[handleInstallServer] Found manifest, using manifest-based installation`);
          
          // Use manifest-based installation
          const result = await ctx.installer.installFromManifest(manifest);
          
          if (!result.success) {
            return ctx.error('install_error', result.error || 'Manifest installation failed');
          }
          
          return ctx.result('install_server_result', { 
            server: result.server,
            hasManifest: true,
            needsOAuth: result.needsOAuth,
            oauthMode: result.oauthMode,
          });
        }
        
        log(`[handleInstallServer] No manifest found, falling back to best-effort installation`);
      }

      // Fall back to best-effort installation (no manifest found)
      let entryWithPackage = catalogEntry;
      const hasPackageInfo = catalogEntry.packages && 
                             catalogEntry.packages.length > 0 && 
                             catalogEntry.packages[0].identifier;
      
      if (!hasPackageInfo && catalogEntry.homepageUrl?.includes('github.com')) {
        log(`[handleInstallServer] Resolving package info from GitHub: ${catalogEntry.homepageUrl}`);
        const resolved = await resolveGitHubPackage(catalogEntry.homepageUrl);
        
        if (resolved && resolved.name) {
          // Determine registry type and create package info
          let registryType: 'npm' | 'pypi' | 'oci' | 'binary';
          if (resolved.type === 'python') {
            registryType = 'pypi';
          } else if (resolved.type === 'binary') {
            registryType = 'binary';
          } else {
            registryType = 'npm';
          }
          
          // Create a copy with resolved package info
          log(`[handleInstallServer] Creating package entry: registryType=${registryType}, identifier=${resolved.name}, binaryUrl=${resolved.binaryUrl || 'none'}`);
          entryWithPackage = {
            ...catalogEntry,
            packages: [{
              registryType,
              identifier: resolved.name,
              environmentVariables: [],
              // Include binary URL if it's a binary package
              binaryUrl: resolved.binaryUrl,
            }],
          };
          log(`[handleInstallServer] Resolved: ${resolved.name} (${resolved.type})${resolved.binaryUrl ? ` from ${resolved.binaryUrl}` : ''}`);
        } else {
          // Could not resolve package info
          const url = catalogEntry.homepageUrl || '';
          return ctx.error('unsupported_server', 
            'Could not find a way to install this server.\n\n' +
            'Harbor supports servers that are:\n' +
            '• Published to npm (JavaScript/TypeScript)\n' +
            '• Published to PyPI (Python)\n' +
            '• Have pre-built binaries in GitHub Releases\n\n' +
            'This server may require manual compilation or installation.\n\n' +
            `Visit ${url} for installation instructions.`);
        }
      }

      const server = await ctx.installer.install(entryWithPackage, packageIndex);
      return ctx.result('install_server_result', { 
        server,
        hasManifest: false,
      });
    } catch (e) {
      log(`Failed to install server: ${e}`);
      return ctx.error('install_error', e instanceof Error ? e.message : String(e));
    }
  }
);

/**
 * Uninstall a server.
 */
export const handleUninstallServer: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('uninstall_server_result', 'uninstall_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const success = ctx.installer.uninstall(serverId);
    return { success };
  })
);

// =============================================================================
// Remote Server Handlers
// =============================================================================

/**
 * Add a remote HTTP/SSE MCP server.
 */
export const handleAddRemoteServer: MessageHandler = requireFields(
  ['name', 'url'],
  async (ctx) => {
    const name = ctx.message.name as string;
    const url = ctx.message.url as string;
    const type = (ctx.message.transport_type as 'http' | 'sse') || 'http';
    const headers = ctx.message.headers as Record<string, string> | undefined;

    try {
      // Validate URL
      new URL(url);
    } catch {
      return ctx.error('invalid_request', 'Invalid server URL');
    }

    try {
      const server = ctx.installer.addRemoteServer(name, url, type, headers);
      return ctx.result('add_remote_server_result', { server });
    } catch (e) {
      log(`Failed to add remote server: ${e}`);
      return ctx.error('add_error', e instanceof Error ? e.message : String(e));
    }
  }
);

/**
 * Import MCP configuration (Claude Desktop or VS Code format).
 */
export const handleImportConfig: MessageHandler = async (ctx) => {
  const configJson = ctx.message.config_json as string || '';
  const installUrl = ctx.message.install_url as string || '';

  try {
    let servers: ParsedServer[] = [];
    let format = 'unknown';

    if (installUrl) {
      // Parse VS Code install URL
      const server = parseVSCodeInstallUrl(installUrl);
      if (server) {
        servers = [server];
        format = 'vscode_url';
      } else {
        return ctx.error('parse_error', 'Invalid VS Code install URL');
      }
    } else if (configJson) {
      // Parse JSON config
      const parsed = parseMcpConfig(configJson);
      servers = parsed.servers;
      format = parsed.format;
    } else {
      return ctx.error('invalid_request', 'Missing config_json or install_url');
    }

    // Import each server
    const imported = [];
    const errors = [];

    for (const server of servers) {
      try {
        let installedServer;

        if (server.type === 'http' || server.type === 'sse') {
          // Remote server
          installedServer = ctx.installer.addRemoteServer(
            server.name,
            server.url!,
            server.type,
            server.headers
          );
        } else {
          // Stdio server - create a minimal catalog entry to install
          // This is a simplified approach; full support would need package resolution
          log(`[handleImportConfig] Stdio server import not fully supported yet: ${server.name}`);
          errors.push({
            name: server.name,
            error: 'Stdio server import from config requires package resolution. Please install from the directory instead.',
          });
          continue;
        }

        // Record required inputs for the UI to prompt for
        imported.push({
          server: installedServer,
          requiredInputs: server.requiredInputs,
        });
      } catch (e) {
        errors.push({
          name: server.name,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return ctx.result('import_config_result', {
      format,
      imported,
      errors,
      totalParsed: servers.length,
    });
  } catch (e) {
    log(`Failed to import config: ${e}`);
    return ctx.error('import_error', e instanceof Error ? e.message : String(e));
  }
};

// =============================================================================
// Server Status & Lifecycle Handlers
// =============================================================================

/**
 * List all installed servers.
 */
export const handleListInstalled: MessageHandler = withErrorHandling(
  'list_installed_result',
  'list_error',
  async (ctx) => {
    const statuses = ctx.installer.getAllStatus();
    
    // Enhance statuses with MCP connection info
    const enhancedStatuses = statuses.map(status => {
      if (status.server && ctx.mcpManager.isConnected(status.server.id)) {
        return {
          ...status,
          process: {
            state: 'running',
            pid: ctx.mcpManager.getPid(status.server.id) || undefined,
          },
        };
      }
      return status;
    });
    
    return { servers: enhancedStatuses };
  }
);

/**
 * Start an installed server.
 */
export const handleStartInstalled: MessageHandler = requireFields(
  ['server_id'],
  async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const useDocker = ctx.message.use_docker as boolean || false;

    try {
      const proc = await ctx.installer.start(serverId, { useDocker });
      return ctx.result('start_installed_result', { process: proc });
    } catch (e) {
      const errorMsg = String(e);
      log(`Failed to start server: ${errorMsg}`);
      
      // Check if this is a macOS Gatekeeper/security issue for a binary server
      const server = ctx.installer.getServer(serverId);
      const isBinary = server?.packageType === 'binary';
      const isSecurityError = errorMsg.includes('permission denied') || 
                             errorMsg.includes('not permitted') ||
                             errorMsg.includes('cannot be opened') ||
                             errorMsg.includes('quarantine') ||
                             errorMsg.includes('EPERM') ||
                             errorMsg.includes('spawn') ||
                             errorMsg.includes('EACCES');
      const isMacOS = process.platform === 'darwin';
      
      // For binary servers that fail with security errors, offer Docker as alternative
      // Docker will download and use the Linux binary from GitHub releases
      if (isBinary && isMacOS && isSecurityError && !useDocker && !server.noDocker) {
        const dockerInfo = await ctx.installer.checkDockerAvailable();
        const hasGitHubInfo = server.githubOwner && server.githubRepo;
        
        if (dockerInfo.available && hasGitHubInfo) {
          log(`[handleStartInstalled] Binary server failed with security error, Docker available with Linux binary`);
          return ctx.result('start_installed_result', {
            process: null,
            error: errorMsg,
            docker_available: true,
            docker_recommended: true,
            suggestion: 'This binary was blocked by macOS Gatekeeper. Would you like to run in Docker instead? (The Linux binary will be downloaded automatically)'
          });
        } else {
          log(`[handleStartInstalled] Binary server failed with security error, Docker not available or no GitHub info`);
          return ctx.result('start_installed_result', {
            process: null,
            error: errorMsg,
            docker_available: false,
            docker_recommended: false,
            suggestion: 'This binary was blocked by macOS Gatekeeper. Go to System Settings → Privacy & Security and click "Allow Anyway".'
          });
        }
      }
      
      return ctx.error('start_error', errorMsg);
    }
  }
);

/**
 * Stop an installed server.
 */
export const handleStopInstalled: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('stop_installed_result', 'stop_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const success = await ctx.installer.stop(serverId);
    return { success };
  })
);

/**
 * Set server secrets (API keys, etc).
 */
export const handleSetServerSecrets: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('set_server_secrets_result', 'secrets_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const secrets = (ctx.message.secrets || {}) as Record<string, string>;

    ctx.installer.setSecrets(serverId, secrets);
    const status = ctx.installer.getStatus(serverId);
    return { status };
  })
);

/**
 * Update server args (e.g., directory paths for filesystem server).
 */
export const handleUpdateServerArgs: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('update_server_args_result', 'update_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;
    const args = (ctx.message.args || []) as string[];

    log(`[handleUpdateServerArgs] Updating args for ${serverId}: ${args.join(', ')}`);
    ctx.installer.configure(serverId, { args });
    const status = ctx.installer.getStatus(serverId);
    return { success: true, status };
  })
);

/**
 * Get status of a specific server.
 */
export const handleGetServerStatus: MessageHandler = requireFields(
  ['server_id'],
  withErrorHandling('get_server_status_result', 'status_error', async (ctx) => {
    const serverId = ctx.message.server_id as string;

    const status = ctx.installer.getStatus(serverId);
    
    // Enhance with MCP connection info
    if (status.server && ctx.mcpManager.isConnected(status.server.id)) {
      return {
        ...status,
        process: {
          state: 'running',
          pid: ctx.mcpManager.getPid(status.server.id) || undefined,
        },
      };
    }
    
    return status;
  })
);

