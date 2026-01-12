/**
 * Curated Directory Handlers
 * 
 * Handles the curated list of MCP servers and installation from GitHub.
 */

import * as M from '../message-types.js';
import { HandlerContext, MessageHandler, withErrorHandling, requireFields, makeError, makeResult } from './context.js';
import { CatalogServer } from '../types.js';
import { log } from '../native-messaging.js';
import { CURATED_SERVERS, getCuratedServer, type CuratedServerFull } from '../directory/curated-servers.js';
import { resolveGitHubPackage } from '../installer/index.js';
import { fetchManifestFromGitHub } from '../installer/manifest.js';

// =============================================================================
// Curated List Handlers
// =============================================================================

/**
 * Get the curated list of MCP servers (simple version for sidebar).
 * Returns just the basic info needed for the UI.
 */
export const handleGetCuratedServers: MessageHandler = withErrorHandling(
  'get_curated_servers_result',
  'curated_error',
  async (_ctx) => {
    return { servers: CURATED_SERVERS };
  }
);

/**
 * Get the curated list of MCP servers with installation status.
 * This is a static, handpicked list that we know works well.
 */
export const handleGetCuratedList: MessageHandler = withErrorHandling(
  'get_curated_list_result',
  'curated_error',
  async (ctx) => {
    // Get installed server IDs to mark which ones are already installed
    const installedStatuses = ctx.installer.getAllStatus();
    const installedIds = new Set(
      installedStatuses
        .filter(s => s.installed && s.server)
        .map(s => s.server!.id)
    );
    
    // Return curated servers with installation status
    const servers = CURATED_SERVERS.map(server => ({
      ...server,
      isInstalled: installedIds.has(server.id),
    }));
    
    return { servers };
  }
);

// =============================================================================
// Curated Installation Handlers
// =============================================================================

/**
 * Install a server from the curated list (simple version for sidebar).
 * Uses server_id from the request.
 */
export const handleInstallCuratedServer: MessageHandler = requireFields(
  ['server_id'],
  async (ctx) => {
    const serverId = ctx.message.server_id as string;
    
    const curated = getCuratedServer(serverId) as CuratedServerFull | undefined;
    if (!curated) {
      return ctx.error('not_found', `Curated server not found: ${serverId}`);
    }
    
    try {
      log(`[handleInstallCuratedServer] Installing ${curated.name} (${curated.id})`);
      
      // Build a catalog entry from the curated server
      const catalogEntry: CatalogServer = {
        id: curated.id,
        name: curated.name,
        description: curated.description,
        endpointUrl: '',
        installableOnly: true,
        tags: curated.tags || [],
        source: 'curated',
        fetchedAt: Date.now(),
        homepageUrl: curated.homepage || curated.homepageUrl || '',
        repositoryUrl: curated.repository || '',
        packages: [],
      };
      
      // Determine package info based on install method
      const install = curated.install;
      let packages: Array<{ registryType: string; identifier: string; binaryUrl?: string }> = [];
      
      switch (install.type) {
        case 'npm':
          packages = [{ registryType: 'npm', identifier: (install as any).package }];
          break;
        case 'pypi':
          packages = [{ registryType: 'pypi', identifier: (install as any).package }];
          break;
        case 'binary':
          // For binary, we need to resolve from GitHub
          const resolved = await resolveGitHubPackage(`https://github.com/${(install as any).github}`);
          if (resolved && resolved.binaryUrl) {
            packages = [{ 
              registryType: 'binary', 
              identifier: (install as any).binaryName,
              binaryUrl: resolved.binaryUrl,
            }];
          } else {
            return ctx.error('resolve_error', 
              `Could not find binary release for ${(install as any).github}`);
          }
          break;
        case 'docker':
          packages = [{ registryType: 'oci', identifier: (install as any).image }];
          break;
      }
      
      // Add packages to catalog entry (no hardcoded env vars - user configures via UI)
      (catalogEntry as any).packages = packages.map(p => ({
        registryType: p.registryType,
        identifier: p.identifier,
        binaryUrl: p.binaryUrl,
        environmentVariables: [],
      }));
      
      // Install the server
      const server = await ctx.installer.install(catalogEntry, 0, { 
        noDocker: curated.noDocker,
      });
      
      return ctx.result('install_curated_server_result', { 
        success: true,
        server,
      });
    } catch (e) {
      log(`Failed to install curated server: ${e}`);
      return ctx.error('install_error', e instanceof Error ? e.message : String(e));
    }
  }
);

/**
 * Install a server from the curated list (with more options).
 */
export const handleInstallCurated: MessageHandler = requireFields(
  ['curated_id'],
  async (ctx) => {
    const curatedId = ctx.message.curated_id as string;
    const useDocker = ctx.message.use_docker as boolean || false;
    
    const curated = getCuratedServer(curatedId) as CuratedServerFull | undefined;
    if (!curated) {
      return ctx.error('not_found', `Curated server not found: ${curatedId}`);
    }
    
    try {
      log(`[handleInstallCurated] Installing ${curated.name} (${curated.id})`);
      
      // Check if curated server has an embedded manifest
      let manifest = curated.manifest;
      
      // If no embedded manifest, try to fetch from the repo
      if (!manifest && curated.repository) {
        log(`[handleInstallCurated] No embedded manifest, trying to fetch from repo: ${curated.repository}`);
        const repoMatch = curated.repository.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (repoMatch) {
          const [, owner, repo] = repoMatch;
          const fetched = await fetchManifestFromGitHub(owner, repo.replace(/\.git$/, ''));
          if (fetched) {
            manifest = fetched;
            log(`[handleInstallCurated] Found manifest in repo for ${curated.name}`);
          }
        }
      }
      
      if (manifest) {
        log(`[handleInstallCurated] Using manifest for ${curated.name}`);
        const result = await ctx.installer.installFromManifest(manifest);
        
        return ctx.result('install_curated_result', {
          server: result.server,
          manifestFound: true,
          manifest: manifest,
          needsOAuth: result.needsOAuth,
          oauthMode: result.oauthMode,
        });
      }
      
      // No manifest available - use legacy flow
      log(`[handleInstallCurated] No manifest for ${curated.name}, using legacy flow`);
      
      // Build a catalog entry from the curated server
      const catalogEntry: CatalogServer = {
        id: curated.id,
        name: curated.name,
        description: curated.description,
        endpointUrl: '',
        installableOnly: true,
        tags: curated.tags || [],
        source: 'curated',
        fetchedAt: Date.now(),
        homepageUrl: curated.homepage || curated.homepageUrl || '',
        repositoryUrl: curated.repository || '',
        packages: [],
      };
      
      // Determine package info based on install method
      const install = curated.install;
      let packages: Array<{ registryType: string; identifier: string; binaryUrl?: string }> = [];
      
      // Check if user wants Docker and server has Docker alternative
      if (useDocker && curated.dockerAlternative) {
        packages = [{
          registryType: 'oci',
          identifier: curated.dockerAlternative.image,
        }];
      } else {
        switch (install.type) {
          case 'npm':
            packages = [{ registryType: 'npm', identifier: (install as any).package }];
            break;
          case 'pypi':
            packages = [{ registryType: 'pypi', identifier: (install as any).package }];
            break;
          case 'binary':
            // For binary, we need to resolve from GitHub
            const resolved = await resolveGitHubPackage(`https://github.com/${(install as any).github}`);
            if (resolved && resolved.binaryUrl) {
              packages = [{ 
                registryType: 'binary', 
                identifier: (install as any).binaryName,
                binaryUrl: resolved.binaryUrl,
              }];
            } else {
              return ctx.error('resolve_error', 
                `Could not find binary release for ${(install as any).github}`);
            }
            break;
          case 'docker':
            packages = [{ registryType: 'oci', identifier: (install as any).image }];
            break;
        }
      }
      
      // Add packages to catalog entry (no hardcoded env vars - user configures via UI)
      (catalogEntry as any).packages = packages.map(p => ({
        registryType: p.registryType,
        identifier: p.identifier,
        binaryUrl: p.binaryUrl,
        environmentVariables: [],
      }));
      
      // Install the server
      const server = await ctx.installer.install(catalogEntry, 0, { 
        noDocker: curated.noDocker,
      });
      
      return ctx.result('install_curated_result', { 
        server,
        manifestFound: false,
      });
    } catch (e) {
      log(`Failed to install curated server: ${e}`);
      return ctx.error('install_error', e instanceof Error ? e.message : String(e));
    }
  }
);

// =============================================================================
// GitHub Installation Handlers
// =============================================================================

/**
 * Install a server from a GitHub URL (from sidebar).
 */
export const handleInstallGithubRepo: MessageHandler = requireFields(
  ['github_url'],
  async (ctx) => {
    let githubUrl = ctx.message.github_url as string;
    
    // Normalize: support owner/repo format
    if (!githubUrl.includes('github.com') && githubUrl.match(/^[\w-]+\/[\w.-]+$/)) {
      githubUrl = `https://github.com/${githubUrl}`;
    }
    
    // Validate it's a GitHub URL
    if (!githubUrl.includes('github.com')) {
      return ctx.error('invalid_request', 'Not a valid GitHub URL');
    }
    
    try {
      log(`[handleInstallGithubRepo] Resolving: ${githubUrl}`);
      
      // Resolve package info from GitHub
      const resolved = await resolveGitHubPackage(githubUrl);
      
      if (!resolved || !resolved.name) {
        return ctx.error('resolve_error', 
          'Could not determine how to install this repository.\n\n' +
          'Supported formats:\n' +
          '• npm packages (package.json)\n' +
          '• Python packages (pyproject.toml)\n' +
          '• Go binaries (GitHub releases)\n\n' +
          'Check the repository for manual installation instructions.');
      }
      
      // Build catalog entry
      const repoName = githubUrl.match(/github\.com\/[^/]+\/([^/]+)/)?.[1] || resolved.name;
      
      // Determine package type
      let registryType: string;
      if (resolved.type === 'python') {
        registryType = 'pypi';
      } else if (resolved.type === 'binary') {
        registryType = 'binary';
      } else {
        registryType = 'npm';
      }
      
      const catalogEntry: CatalogServer = {
        id: `github-${repoName}-${Date.now()}`,
        name: resolved.name,
        description: `Installed from ${githubUrl}`,
        endpointUrl: '',
        installableOnly: true,
        tags: ['custom', 'github'],
        source: 'github',
        fetchedAt: Date.now(),
        homepageUrl: githubUrl,
        repositoryUrl: githubUrl,
        packages: [{
          registryType: registryType as 'npm' | 'pypi' | 'oci' | 'binary',
          identifier: resolved.name,
          binaryUrl: resolved.binaryUrl,
          environmentVariables: [],
        }],
      };
      
      // Install
      const server = await ctx.installer.install(catalogEntry, 0);
      
      return ctx.result('install_github_repo_result', {
        success: true,
        server_id: server.id,
        package_type: registryType,
        needs_config: false, // TODO: detect if server needs config
      });
    } catch (e) {
      log(`Failed to install from GitHub: ${e}`);
      return ctx.error('install_error', e instanceof Error ? e.message : String(e));
    }
  }
);

/**
 * Install a server from a GitHub URL (with more options).
 */
export const handleInstallFromGitHub: MessageHandler = requireFields(
  ['github_url'],
  async (ctx) => {
    const githubUrl = ctx.message.github_url as string;
    const useDocker = ctx.message.use_docker as boolean || false;
    
    // Validate it's a GitHub URL
    if (!githubUrl.includes('github.com')) {
      return ctx.error('invalid_request', 'Not a valid GitHub URL');
    }
    
    try {
      log(`[handleInstallFromGitHub] Resolving: ${githubUrl}`);
      
      // Resolve package info from GitHub
      const resolved = await resolveGitHubPackage(githubUrl);
      
      if (!resolved || !resolved.name) {
        return ctx.error('resolve_error', 
          'Could not determine how to install this repository.\n\n' +
          'Supported formats:\n' +
          '• npm packages (package.json)\n' +
          '• Python packages (pyproject.toml)\n' +
          '• Go binaries (GitHub releases)\n\n' +
          'Check the repository for manual installation instructions.');
      }
      
      // Build catalog entry
      const repoName = githubUrl.match(/github\.com\/[^/]+\/([^/]+)/)?.[1] || resolved.name;
      
      // Determine package type
      let registryType: string;
      if (resolved.type === 'python') {
        registryType = 'pypi';
      } else if (resolved.type === 'binary') {
        registryType = 'binary';
      } else {
        registryType = 'npm';
      }
      
      const catalogEntry: CatalogServer = {
        id: `github-${repoName}-${Date.now()}`,
        name: resolved.name,
        description: `Installed from ${githubUrl}`,
        endpointUrl: '',
        installableOnly: true,
        tags: ['custom', 'github'],
        source: 'github',
        fetchedAt: Date.now(),
        homepageUrl: githubUrl,
        repositoryUrl: githubUrl,
        packages: [{
          registryType: registryType as 'npm' | 'pypi' | 'oci' | 'binary',
          identifier: resolved.name,
          binaryUrl: resolved.binaryUrl,
          environmentVariables: [],
        }],
      };
      
      // Install
      const server = await ctx.installer.install(catalogEntry, 0);
      
      return ctx.result('install_from_github_result', {
        server,
        resolved: {
          name: resolved.name,
          type: resolved.type,
          version: resolved.version,
        },
      });
    } catch (e) {
      log(`Failed to install from GitHub: ${e}`);
      return ctx.error('install_error', e instanceof Error ? e.message : String(e));
    }
  }
);

