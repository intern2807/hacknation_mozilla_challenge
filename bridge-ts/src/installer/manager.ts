/**
 * Installed Server Manager - tracks installed MCP servers and their configs.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../native-messaging.js';
import { InstalledServer, ServerProcess, ProcessState, CatalogServer } from '../types.js';
import { getRuntimeManager, RuntimeManager } from './runtime.js';
import { getPackageRunner, PackageRunner } from './runner.js';
import { getSecretStore, SecretStore } from './secrets.js';
import { downloadBinary, removeBinary, isBinaryDownloaded } from './binary-downloader.js';
import { getDockerRunner, DockerRunner } from './docker-runner.js';
import { getDockerExec } from './docker-exec.js';
import { 
  McpManifest, 
  getDockerRecommendation, 
  checkOAuthCapabilities,
  getOAuthEnvVars,
  OAuthSource,
} from './manifest.js';
import { 
  getHarborOAuthBroker, 
  HarborOAuthBroker,
  StoredServerTokens,
} from '../auth/harbor-oauth.js';
import { getTokenStore, TokenStore } from '../auth/token-store.js';

const CONFIG_DIR = join(homedir(), '.harbor');
const INSTALLED_FILE = join(CONFIG_DIR, 'installed_servers.json');

/**
 * Extended server info that includes manifest data.
 */
export interface InstalledServerWithManifest extends InstalledServer {
  /** The original manifest (if installed via manifest) */
  manifest?: McpManifest;
  /** OAuth mode used for this server */
  oauthMode?: OAuthSource;
  /** Provider name if OAuth is used */
  oauthProvider?: string;
}

/**
 * Result of manifest-based installation.
 */
export interface ManifestInstallResult {
  success: boolean;
  serverId?: string;
  server?: InstalledServerWithManifest;
  needsOAuth?: boolean;
  oauthMode?: OAuthSource;
  error?: string;
}

export class InstalledServerManager {
  private servers: Map<string, InstalledServer> = new Map();
  private manifests: Map<string, McpManifest> = new Map();
  private runtimeManager: RuntimeManager;
  private runner: PackageRunner;
  private dockerRunner: DockerRunner;
  private secrets: SecretStore;
  private oauthBroker: HarborOAuthBroker;
  private tokenStore: TokenStore;

  constructor() {
    mkdirSync(CONFIG_DIR, { recursive: true });
    this.runtimeManager = getRuntimeManager();
    this.runner = getPackageRunner();
    this.dockerRunner = getDockerRunner();
    this.secrets = getSecretStore();
    this.oauthBroker = getHarborOAuthBroker();
    this.tokenStore = getTokenStore();
    this.load();
    this.loadManifests();
    this.loadOAuthTokens();
  }

  private load(): void {
    if (existsSync(INSTALLED_FILE)) {
      try {
        const data = JSON.parse(readFileSync(INSTALLED_FILE, 'utf-8'));
        for (const serverData of data.servers || []) {
          const server: InstalledServer = {
            id: serverData.id,
            name: serverData.name,
            packageType: serverData.packageType,
            packageId: serverData.packageId,
            autoStart: serverData.autoStart || false,
            args: serverData.args || [],
            requiredEnvVars: serverData.requiredEnvVars || [],
            installedAt: serverData.installedAt || Date.now(),
            catalogSource: serverData.catalogSource || null,
            homepageUrl: serverData.homepageUrl || null,
            description: serverData.description || null,
            // Binary package fields
            binaryUrl: serverData.binaryUrl,
            binaryPath: serverData.binaryPath,
            // GitHub info for Linux binary downloads
            githubOwner: serverData.githubOwner,
            githubRepo: serverData.githubRepo,
            // Remote HTTP/SSE server fields
            remoteUrl: serverData.remoteUrl,
            remoteHeaders: serverData.remoteHeaders,
            // Docker fields
            useDocker: serverData.useDocker || false,
            dockerVolumes: serverData.dockerVolumes || [],
            // Server requires host access (no Docker)
            noDocker: serverData.noDocker || false,
          };
          this.servers.set(server.id, server);
        }
        log(`[InstalledServerManager] Loaded ${this.servers.size} installed servers`);
      } catch (e) {
        log(`[InstalledServerManager] Failed to load installed servers: ${e}`);
      }
    }
  }

  private save(): void {
    try {
      const data = {
        version: 1,
        servers: Array.from(this.servers.values()),
      };
      writeFileSync(INSTALLED_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      log(`[InstalledServerManager] Failed to save installed servers: ${e}`);
    }
  }

  async install(
    catalogEntry: CatalogServer,
    packageIndex: number = 0,
    options?: { 
      noDocker?: boolean;
    }
  ): Promise<InstalledServer> {
    const serverId = catalogEntry.id;
    const name = catalogEntry.name || serverId;

    // Get package info
    const packages = catalogEntry.packages || [];
    let packageType = 'npm';
    let packageId = name;
    let requiredEnvVars: InstalledServer['requiredEnvVars'] = [];
    let binaryUrl: string | undefined;
    let binaryPath: string | undefined;

    if (packages.length > 0 && packageIndex < packages.length) {
      const pkg = packages[packageIndex];
      packageType = pkg.registryType || 'npm';
      // Use identifier if it's a non-empty string, otherwise fall back to name
      packageId = (pkg.identifier && typeof pkg.identifier === 'string' && pkg.identifier.trim()) 
        ? pkg.identifier.trim() 
        : name;
      requiredEnvVars = pkg.environmentVariables || [];
      
      // Check for binary URL in package info
      if (packageType === 'binary' && pkg.binaryUrl) {
        binaryUrl = pkg.binaryUrl;
      }
      
      log(`[InstalledServerManager] Package info: type=${packageType}, identifier="${pkg.identifier}", using="${packageId}"`);
    } else {
      log(`[InstalledServerManager] No package info found, using name as packageId: ${packageId}`);
    }

    // For binary packages, download the binary now
    if (packageType === 'binary') {
      if (!binaryUrl) {
        log(`[InstalledServerManager] ERROR: Binary package but no binaryUrl provided!`);
        throw new Error('Binary package requires a download URL. The GitHub release may not have been found.');
      }
      log(`[InstalledServerManager] Downloading binary from: ${binaryUrl}`);
      try {
        binaryPath = await downloadBinary(serverId, binaryUrl, {
          expectedBinaryName: name,
        });
        // For binaries, packageId is the serverId (we run the local binary)
        packageId = serverId;
        log(`[InstalledServerManager] Binary downloaded to: ${binaryPath}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`[InstalledServerManager] Binary download failed: ${msg}`);
        throw new Error(`Failed to download binary: ${msg}`);
      }
    }

    // Try to extract GitHub owner/repo from homepage or repository URL (for binary Linux downloads)
    let githubOwner: string | undefined;
    let githubRepo: string | undefined;
    const repoUrl = catalogEntry.repositoryUrl || catalogEntry.homepageUrl || '';
    const githubMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (githubMatch) {
      githubOwner = githubMatch[1];
      githubRepo = githubMatch[2].replace(/\.git$/, '').split('/')[0]; // Handle paths like /tree/main/...
      log(`[InstalledServerManager] Extracted GitHub info: ${githubOwner}/${githubRepo}`);
    }

    const server: InstalledServer = {
      id: serverId,
      name,
      packageType,
      packageId,
      autoStart: false,
      args: [],
      requiredEnvVars,
      installedAt: Date.now(),
      catalogSource: catalogEntry.source || null,
      homepageUrl: catalogEntry.homepageUrl || null,
      description: catalogEntry.description || null,
      binaryUrl,
      binaryPath,
      githubOwner,
      githubRepo,
      // If noDocker is true, this server requires host filesystem access
      noDocker: options?.noDocker,
    };

    this.servers.set(serverId, server);
    this.save();

    log(`[InstalledServerManager] Installed server: ${name} (${packageType}:${packageId})${options?.noDocker ? ' [noDocker]' : ''}`);
    return server;
  }

  /**
   * Add a remote HTTP/SSE MCP server.
   * 
   * @param name Display name for the server
   * @param url The URL of the remote MCP server
   * @param type Transport type: 'http' for StreamableHTTP, 'sse' for SSE
   * @param headers Optional HTTP headers to include with requests
   * @returns The installed server configuration
   */
  addRemoteServer(
    name: string,
    url: string,
    type: 'http' | 'sse' = 'http',
    headers?: Record<string, string>
  ): InstalledServer {
    // Generate a human-readable ID from the URL hostname
    // e.g., "https://api.github.com/mcp" -> "github" or "github-mcp"
    const urlObj = new URL(url);
    let serverId = urlObj.hostname
      .replace(/^(www|api)\./, '') // Remove www. or api. prefix
      .replace(/\.(com|org|net|io|dev|ai)$/, '') // Remove common TLDs
      .replace(/[^a-zA-Z0-9-]/g, '-') // Replace special chars with hyphens
      .toLowerCase();
    
    // Add a short hash if there's a path to differentiate multiple endpoints on same host
    if (urlObj.pathname && urlObj.pathname !== '/' && urlObj.pathname !== '/mcp') {
      const pathPart = urlObj.pathname.split('/').filter(Boolean)[0];
      if (pathPart && pathPart !== 'mcp') {
        serverId = `${serverId}-${pathPart}`;
      }
    }
    
    // Ensure uniqueness by adding a suffix if this ID already exists
    let finalId = serverId;
    let counter = 2;
    while (this.servers.has(finalId)) {
      finalId = `${serverId}-${counter}`;
      counter++;
    }

    const server: InstalledServer = {
      id: finalId,
      name,
      packageType: type,
      packageId: url, // Store URL as packageId for display
      autoStart: false,
      args: [],
      requiredEnvVars: [],
      installedAt: Date.now(),
      catalogSource: 'remote',
      homepageUrl: null,
      description: `Remote ${type.toUpperCase()} server`,
      remoteUrl: url,
      remoteHeaders: headers,
    };

    this.servers.set(finalId, server);
    this.save();

    log(`[InstalledServerManager] Added remote server: ${name} as ${finalId} (${type}:${url})`);
    return server;
  }

  uninstall(serverId: string): boolean {
    const server = this.servers.get(serverId);
    if (!server) {
      return false;
    }

    // Stop if running
    const proc = this.runner.getProcess(serverId);
    if (proc && proc.state === ProcessState.RUNNING) {
      this.runner.stopServer(serverId);
    }

    // If it's a binary package, remove the downloaded binary
    if (server.packageType === 'binary') {
      removeBinary(serverId);
    }

    // Remove config and secrets
    this.servers.delete(serverId);
    this.secrets.delete(serverId);
    this.save();

    log(`[InstalledServerManager] Uninstalled server: ${serverId}`);
    return true;
  }

  getServer(serverId: string): InstalledServer | undefined {
    return this.servers.get(serverId);
  }

  /**
   * Update configuration for an installed server.
   * Used to remember learned preferences (e.g., needs Docker).
   */
  async updateServerConfig(
    serverId: string, 
    updates: Partial<Pick<InstalledServer, 'useDocker' | 'noDocker' | 'args'>>
  ): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not installed: ${serverId}`);
    }
    
    // Apply updates
    if (updates.useDocker !== undefined) {
      server.useDocker = updates.useDocker;
    }
    if (updates.noDocker !== undefined) {
      server.noDocker = updates.noDocker;
    }
    if (updates.args !== undefined) {
      server.args = updates.args;
    }
    
    this.servers.set(serverId, server);
    this.save();
    
    log(`[InstalledServerManager] Updated config for ${serverId}: ${JSON.stringify(updates)}`);
  }

  getAllServers(): InstalledServer[] {
    return Array.from(this.servers.values());
  }

  isInstalled(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  async start(
    serverId: string,
    options?: { 
      useDocker?: boolean; 
      onProgress?: (message: string) => void;
    }
  ): Promise<ServerProcess> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not installed: ${serverId}`);
    }

    // Check for required secrets
    const missing = this.secrets.getMissingSecrets(
      serverId,
      server.requiredEnvVars
    );
    if (missing.length > 0) {
      const names = missing.map(m => m.name);
      throw new Error(`Missing required secrets: ${names.join(', ')}`);
    }

    // Get secrets as env vars
    const envVars = this.secrets.getAll(serverId);

    // Determine if we should use Docker
    // OCI (Docker image) servers MUST use Docker
    const useDocker = server.packageType === 'oci' || (options?.useDocker ?? server.useDocker ?? false);
    
    if (useDocker) {
      log(`[InstalledServerManager] Starting ${serverId} in Docker mode`);
      return this.dockerRunner.startServer(
        serverId,
        server.packageType,
        server.packageId,
        {
          env: envVars,
          args: server.args.length > 0 ? server.args : undefined,
          volumes: server.dockerVolumes,
          onProgress: options?.onProgress,
        }
      );
    }

    // Start the server natively
    return this.runner.startServer(
      serverId,
      server.packageType,
      server.packageId,
      envVars,
      server.args.length > 0 ? server.args : undefined
    );
  }

  async stop(serverId: string): Promise<boolean> {
    // Try to stop Docker container first
    if (this.dockerRunner.isRunning(serverId)) {
      return this.dockerRunner.stopServer(serverId);
    }
    // Fall back to native runner
    return this.runner.stopServer(serverId);
  }

  async restart(
    serverId: string,
    options?: { useDocker?: boolean; onProgress?: (message: string) => void }
  ): Promise<ServerProcess> {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not installed: ${serverId}`);
    }

    await this.stop(serverId);
    return this.start(serverId, options);
  }

  /**
   * Check if Docker is available for running MCP servers.
   */
  async checkDockerAvailable(): Promise<{ 
    available: boolean; 
    version?: string; 
    error?: string;
  }> {
    const dockerExec = getDockerExec();
    return dockerExec.checkDocker();
  }

  /**
   * Check if Docker should be preferred for a given server.
   * Returns recommendation based on package type and platform.
   * 
   * For binary servers:
   * - We download the native binary (macOS) for native execution
   * - We download the Linux binary on-demand for Docker execution
   * - Docker is recommended on macOS to bypass Gatekeeper
   */
  async shouldPreferDocker(serverId: string): Promise<{
    prefer: boolean;
    reason?: string;
    dockerAvailable: boolean;
  }> {
    const server = this.servers.get(serverId);
    if (!server) {
      return { prefer: false, dockerAvailable: false };
    }

    const dockerInfo = await this.checkDockerAvailable();
    
    if (!dockerInfo.available) {
      return { 
        prefer: false, 
        dockerAvailable: false,
        reason: dockerInfo.error || 'Docker not available'
      };
    }

    // Recommend Docker for binaries on macOS (Gatekeeper bypass)
    // We'll download the Linux binary on-demand for Docker
    if (server.packageType === 'binary' && process.platform === 'darwin') {
      // Only recommend if we have GitHub info to download Linux binary
      if (server.githubOwner && server.githubRepo) {
        return {
          prefer: true,
          dockerAvailable: true,
          reason: 'Docker bypasses macOS Gatekeeper (Linux binary will be downloaded)'
        };
      }
      // No GitHub info - can't download Linux binary
      return {
        prefer: false,
        dockerAvailable: true,
        reason: 'Docker not available for this binary (missing GitHub repository info for Linux binary download)'
      };
    }

    return { prefer: false, dockerAvailable: true };
  }

  /**
   * Enable or disable Docker mode for a server.
   */
  setDockerMode(serverId: string, useDocker: boolean, volumes?: string[]): void {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not installed: ${serverId}`);
    }

    server.useDocker = useDocker;
    if (volumes !== undefined) {
      server.dockerVolumes = volumes;
    }

    this.save();
    log(`[InstalledServerManager] Docker mode ${useDocker ? 'enabled' : 'disabled'} for ${serverId}`);
  }

  getStatus(serverId: string): {
    installed: boolean;
    server?: InstalledServer;
    process?: ServerProcess | null;
    missingSecrets?: string[];
    canStart?: boolean;
    runningInDocker?: boolean;
  } {
    const server = this.servers.get(serverId);
    if (!server) {
      return { installed: false };
    }

    // Check both native and Docker runners
    let proc = this.runner.getProcess(serverId);
    let runningInDocker = false;
    
    if (!proc || proc.state !== ProcessState.RUNNING) {
      const dockerProc = this.dockerRunner.getProcess(serverId);
      if (dockerProc) {
        proc = dockerProc;
        runningInDocker = dockerProc.state === ProcessState.RUNNING;
      }
    }
    
    const missingSecrets = this.secrets.getMissingSecrets(
      serverId,
      server.requiredEnvVars
    );

    return {
      installed: true,
      server,
      process: proc,
      missingSecrets: missingSecrets.map(m => m.name),
      canStart: missingSecrets.length === 0,
      runningInDocker,
    };
  }

  getAllStatus(): Array<ReturnType<InstalledServerManager['getStatus']>> {
    return Array.from(this.servers.keys()).map(id => this.getStatus(id));
  }

  setSecret(serverId: string, key: string, value: string): void {
    this.secrets.set(serverId, key, value);
  }

  setSecrets(serverId: string, secrets: Record<string, string>): void {
    this.secrets.setAll(serverId, secrets);
  }

  configure(
    serverId: string,
    options: { 
      autoStart?: boolean; 
      args?: string[];
      useDocker?: boolean;
      dockerVolumes?: string[];
    }
  ): void {
    const server = this.servers.get(serverId);
    if (!server) {
      throw new Error(`Server not installed: ${serverId}`);
    }

    if (options.autoStart !== undefined) {
      server.autoStart = options.autoStart;
    }
    if (options.args !== undefined) {
      server.args = options.args;
    }
    if (options.useDocker !== undefined) {
      server.useDocker = options.useDocker;
    }
    if (options.dockerVolumes !== undefined) {
      server.dockerVolumes = options.dockerVolumes;
    }

    this.save();
  }

  async startAutoStartServers(): Promise<void> {
    for (const server of this.servers.values()) {
      if (server.autoStart) {
        try {
          await this.start(server.id);
        } catch (e) {
          log(`[InstalledServerManager] Failed to auto-start ${server.id}: ${e}`);
        }
      }
    }
  }

  async checkRuntimes(): Promise<{
    runtimes: Array<{
      type: string;
      available: boolean;
      version: string | null;
      path: string | null;
      runnerCmd: string | null;
      installHint: string | null;
    }>;
    canInstall: {
      npm: boolean;
      pypi: boolean;
      oci: boolean;
    };
  }> {
    const runtimes = await this.runtimeManager.detectAll();
    return {
      runtimes: runtimes.map(r => ({
        type: r.type,
        available: r.available,
        version: r.version,
        path: r.path,
        runnerCmd: r.runnerCmd,
        installHint: r.installHint,
      })),
      canInstall: {
        npm: runtimes.some(r => r.available && r.type === 'node'),
        pypi: runtimes.some(r => r.available && r.type === 'python'),
        oci: runtimes.some(r => r.available && r.type === 'docker'),
      },
    };
  }

  // ===========================================================================
  // Manifest-based Installation
  // ===========================================================================

  /**
   * Load stored manifests from disk.
   */
  private loadManifests(): void {
    const manifestFile = join(CONFIG_DIR, 'manifests.json');
    if (existsSync(manifestFile)) {
      try {
        const data = JSON.parse(readFileSync(manifestFile, 'utf-8'));
        for (const [serverId, manifest] of Object.entries(data.manifests || {})) {
          this.manifests.set(serverId, manifest as McpManifest);
        }
        log(`[InstalledServerManager] Loaded ${this.manifests.size} manifests`);
      } catch (e) {
        log(`[InstalledServerManager] Failed to load manifests: ${e}`);
      }
    }
  }

  /**
   * Save manifests to disk.
   */
  private saveManifests(): void {
    const manifestFile = join(CONFIG_DIR, 'manifests.json');
    try {
      const data = {
        version: 1,
        manifests: Object.fromEntries(this.manifests),
      };
      writeFileSync(manifestFile, JSON.stringify(data, null, 2));
    } catch (e) {
      log(`[InstalledServerManager] Failed to save manifests: ${e}`);
    }
  }

  /**
   * Load OAuth tokens into the broker.
   */
  private loadOAuthTokens(): void {
    const tokens = this.tokenStore.getAllTokens();
    if (tokens.length > 0) {
      this.oauthBroker.loadTokens(tokens);
    }
  }

  /**
   * Install a server from a manifest.
   * This is the main entry point for manifest-based installation.
   */
  async installFromManifest(manifest: McpManifest): Promise<ManifestInstallResult> {
    const serverId = this.generateServerId(manifest);
    log(`[InstalledServerManager] Installing from manifest: ${manifest.name} (${serverId})`);

    try {
      // 1. Determine Docker mode
      const dockerRec = getDockerRecommendation(manifest);
      const useDocker = dockerRec.shouldUseDocker;

      // 2. Check OAuth requirements
      let oauthMode: OAuthSource | undefined;
      let needsOAuth = false;
      
      if (manifest.oauth) {
        const capabilities = this.oauthBroker.getCapabilities();
        const oauthCheck = checkOAuthCapabilities(manifest.oauth, capabilities);
        oauthMode = oauthCheck.recommendedSource;
        
        if (oauthMode === 'host') {
          // Check if we already have tokens
          if (!this.oauthBroker.hasValidTokens(serverId)) {
            needsOAuth = true;
          }
        } else if (oauthMode === 'user') {
          // For user mode, we'll need to prompt for credentials
          needsOAuth = true; // We'll handle this separately
        }
        
        log(`[InstalledServerManager] OAuth mode: ${oauthMode}, needsOAuth: ${needsOAuth}`);
      }

      // 3. Create the installed server record
      // For git packages, use URL; for others use name
      const packageId = manifest.package.type === 'git' 
        ? manifest.package.url 
        : manifest.package.name;
        
      const server: InstalledServerWithManifest = {
        id: serverId,
        name: manifest.name,
        packageType: manifest.package.type,
        packageId: packageId || serverId,
        autoStart: false,
        args: [],
        requiredEnvVars: [
          ...(manifest.environment || []).map(e => ({
            name: e.name,
            description: e.description,
            isSecret: false,
          })),
          ...(manifest.secrets || []).map(s => ({
            name: s.name,
            description: s.description,
            isSecret: true,
          })),
        ],
        installedAt: Date.now(),
        catalogSource: 'manifest',
        homepageUrl: manifest.repository || null,
        description: manifest.description || null,
        useDocker,
        noDocker: false, // Determined at runtime if needed
        manifest,
        oauthMode,
        oauthProvider: manifest.oauth?.provider,
      };

      // 4. Store manifest and server
      this.manifests.set(serverId, manifest);
      this.servers.set(serverId, server);
      this.save();
      this.saveManifests();

      log(`[InstalledServerManager] Manifest installation complete: ${serverId}`);

      return {
        success: true,
        serverId,
        server,
        needsOAuth,
        oauthMode,
      };

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log(`[InstalledServerManager] Manifest installation failed: ${error}`);
      return {
        success: false,
        error,
      };
    }
  }

  /**
   * Generate a server ID from a manifest.
   */
  private generateServerId(manifest: McpManifest): string {
    // Use package name or URL as base, cleaned up
    let source: string;
    if (manifest.package.type === 'git' && manifest.package.url) {
      // Extract repo name from git URL (e.g., "https://github.com/user/repo.git" -> "user-repo")
      source = manifest.package.url
        .replace(/\.git$/, '')
        .replace(/^https?:\/\//, '')
        .replace(/github\.com\//, '');
    } else {
      source = manifest.package.name || manifest.name;
    }
    
    let baseId = source
      .replace(/^@/, '') // Remove @ prefix
      .replace(/\//g, '-') // Replace / with -
      .replace(/[^a-zA-Z0-9-]/g, '-') // Clean special chars
      .toLowerCase();

    // Ensure uniqueness
    let id = baseId;
    let counter = 2;
    while (this.servers.has(id)) {
      id = `${baseId}-${counter}`;
      counter++;
    }

    return id;
  }

  /**
   * Start OAuth flow for a server that needs it.
   * Returns the auth URL to open in browser.
   */
  async startOAuthFlow(serverId: string): Promise<{ authUrl: string; state: string } | { error: string }> {
    const manifest = this.manifests.get(serverId);
    if (!manifest?.oauth) {
      return { error: 'Server does not require OAuth' };
    }

    const result = await this.oauthBroker.startAuthFlow(serverId, manifest.oauth);
    
    if ('error' in result) {
      log(`[InstalledServerManager] OAuth flow start failed: ${result.error}`);
    } else {
      log(`[InstalledServerManager] OAuth flow started for ${serverId}`);
    }

    return result;
  }

  /**
   * Check OAuth status for a server.
   */
  getOAuthStatus(serverId: string): {
    required: boolean;
    mode?: OAuthSource;
    hasTokens: boolean;
    tokensValid: boolean;
    needsRefresh: boolean;
  } {
    const manifest = this.manifests.get(serverId);
    if (!manifest?.oauth) {
      return {
        required: false,
        hasTokens: false,
        tokensValid: false,
        needsRefresh: false,
      };
    }

    const capabilities = this.oauthBroker.getCapabilities();
    const check = checkOAuthCapabilities(manifest.oauth, capabilities);

    return {
      required: true,
      mode: check.recommendedSource,
      hasTokens: this.oauthBroker.hasValidTokens(serverId),
      tokensValid: this.oauthBroker.hasValidTokens(serverId),
      needsRefresh: this.tokenStore.needsRefresh(serverId),
    };
  }

  /**
   * Get the manifest for an installed server.
   */
  getManifest(serverId: string): McpManifest | undefined {
    return this.manifests.get(serverId);
  }

  /**
   * Store a manifest for an existing server.
   * Used when associating a curated server's embedded manifest with an already-installed server.
   */
  storeManifest(serverId: string, manifest: McpManifest): void {
    this.manifests.set(serverId, manifest);
    this.saveManifests();
    log(`[InstalledServerManager] Stored manifest for ${serverId}`);
  }

  /**
   * Start a server installed via manifest.
   * Automatically handles OAuth token injection.
   */
  async startWithManifest(
    serverId: string,
    options?: { useDocker?: boolean; onProgress?: (message: string) => void }
  ): Promise<ServerProcess> {
    const server = this.servers.get(serverId);
    const manifest = this.manifests.get(serverId);

    if (!server) {
      throw new Error(`Server not installed: ${serverId}`);
    }

    // Build environment variables
    const envVars: Record<string, string> = { ...this.secrets.getAll(serverId) };

    // If we have a manifest with OAuth in host mode, inject tokens
    if (manifest?.oauth) {
      const oauthStatus = this.getOAuthStatus(serverId);
      
      if (oauthStatus.mode === 'host') {
        // Refresh tokens if needed
        if (oauthStatus.needsRefresh) {
          await this.oauthBroker.refreshIfNeeded(serverId, manifest.oauth);
        }

        // Get tokens and inject as env vars
        const tokens = this.oauthBroker.getEnvVarsForServer(serverId, manifest.oauth);
        if (tokens) {
          Object.assign(envVars, tokens);
          log(`[InstalledServerManager] Injected OAuth tokens for ${serverId}`);
          log(`[InstalledServerManager] Env vars being injected: ${Object.keys(tokens).join(', ')}`);
        } else {
          throw new Error('OAuth tokens not available. Please authenticate first.');
        }
      } else if (oauthStatus.mode === 'user' && manifest.oauth.userMode) {
        // For user mode, inject the paths as env vars
        const userModeEnv = getOAuthEnvVars(manifest.oauth, 'user');
        Object.assign(envVars, userModeEnv);
      }
    }

    // Check required secrets
    const missing = this.secrets.getMissingSecrets(serverId, server.requiredEnvVars);
    if (missing.length > 0) {
      const names = missing.map(m => m.name);
      throw new Error(`Missing required secrets: ${names.join(', ')}`);
    }

    // Determine Docker usage
    const useDocker = options?.useDocker ?? server.useDocker ?? false;

    if (useDocker) {
      log(`[InstalledServerManager] Starting ${serverId} with manifest in Docker mode`);
      return this.dockerRunner.startServer(
        serverId,
        server.packageType,
        server.packageId,
        {
          env: envVars,
          args: server.args.length > 0 ? server.args : undefined,
          volumes: server.dockerVolumes,
          onProgress: options?.onProgress,
        }
      );
    }

    log(`[InstalledServerManager] Starting ${serverId} with manifest natively`);
    return this.runner.startServer(
      serverId,
      server.packageType,
      server.packageId,
      envVars,
      server.args.length > 0 ? server.args : undefined
    );
  }

  /**
   * Check if Harbor can handle OAuth for a manifest.
   */
  canHandleOAuth(manifest: McpManifest): boolean {
    if (!manifest.oauth) return true; // No OAuth needed
    return this.oauthBroker.canHandle(manifest.oauth);
  }

  /**
   * Get Harbor's OAuth capabilities.
   */
  getOAuthCapabilities() {
    return this.oauthBroker.getCapabilities();
  }

  /**
   * Get OAuth environment variables for a server.
   * Returns the tokens formatted for injection into the server's environment.
   */
  getOAuthEnvVars(serverId: string): Record<string, string> | null {
    const manifest = this.getManifest(serverId);
    if (!manifest?.oauth) return null;
    
    return this.oauthBroker.getEnvVarsForServer(serverId, manifest.oauth);
  }

  /**
   * Clean up OAuth tokens for a server when uninstalling.
   */
  private cleanupOAuth(serverId: string): void {
    this.oauthBroker.removeTokens(serverId);
    this.tokenStore.deleteTokens(serverId);
  }

  /**
   * Uninstall a server that was installed via manifest.
   */
  uninstallWithManifest(serverId: string): boolean {
    const result = this.uninstall(serverId);
    if (result) {
      this.manifests.delete(serverId);
      this.saveManifests();
      this.cleanupOAuth(serverId);
    }
    return result;
  }
}

// Singleton
let _manager: InstalledServerManager | null = null;

export function getInstalledServerManager(): InstalledServerManager {
  if (!_manager) {
    _manager = new InstalledServerManager();
  }
  return _manager;
}

/**
 * Reset the singleton instance. FOR TESTING ONLY.
 */
export function __resetInstalledServerManagerForTesting(): void {
  _manager = null;
}





