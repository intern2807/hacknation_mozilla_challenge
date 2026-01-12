/**
 * LLM Setup - Downloads and manages local LLM models.
 * 
 * Supports Ollama (native or Docker) for local model execution.
 * Uses any-llm-ts for Ollama API interactions where possible.
 * 
 * Flow:
 * 1. Check status (is Ollama available? model downloaded?)
 * 2. If model not downloaded, user clicks "Download"
 * 3. Download progress is streamed back
 * 4. Once downloaded, can start/stop the server
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import { spawn, execSync, spawnSync, ChildProcess } from 'node:child_process';
import { log } from '../native-messaging.js';
import { getDockerExec } from '../installer/docker-exec.js';
import { AnyLLM } from '../any-llm-ts/src/index.js';

// =============================================================================
// Types
// =============================================================================

export interface LLMModel {
  /** Unique identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Size in bytes */
  size: number;
  
  /** Human-readable size */
  sizeHuman: string;
  
  /** Download URL */
  url: string;
  
  /** Description */
  description: string;
  
  /** Whether this model supports tool calling */
  supportsTools: boolean;
  
  /** Recommended for most users */
  recommended?: boolean;
}

export interface LLMSetupStatus {
  /** Is any LLM currently running and accessible? */
  available: boolean;
  
  /** What's running (if anything) */
  runningProvider: 'llamafile' | 'ollama' | 'external' | null;
  
  /** URL of running LLM */
  runningUrl: string | null;
  
  /** Downloaded model IDs */
  downloadedModels: string[];
  
  /** Currently running model (if we started it) */
  activeModel: string | null;
  
  /** Available models to download */
  availableModels: LLMModel[];
  
  /** Ollama-specific info (when Ollama is the provider) */
  ollamaInfo?: {
    version: string | null;
    supportsTools: boolean;
    minimumToolVersion: string;
    recommendedVersion: string;
    warning?: string;
  };
}

export interface DownloadProgress {
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  status: 'downloading' | 'complete' | 'error';
  error?: string;
}

// =============================================================================
// Available Models
// =============================================================================

/**
 * Available llamafile models.
 * 
 * These are hosted on HuggingFace by Mozilla.
 * We pick models that work well for tool calling.
 */
const AVAILABLE_MODELS: LLMModel[] = [
  {
    id: 'llama-3.2-3b',
    name: 'Llama 3.2 3B Instruct',
    size: 2_000_000_000, // ~2 GB
    sizeHuman: '2.0 GB',
    url: 'https://huggingface.co/Mozilla/Llama-3.2-3B-Instruct-llamafile/resolve/main/Llama-3.2-3B-Instruct.Q6_K.llamafile',
    description: 'Best for tool calling. Native tool support with great instruction following.',
    supportsTools: true,
    recommended: true,
  },
  {
    id: 'mistral-nemo',
    name: 'Mistral NeMo 12B',
    size: 7_000_000_000, // ~7 GB  
    sizeHuman: '7.0 GB',
    url: '', // Ollama-only, no llamafile available
    description: 'Larger and more capable. Native tool calling support.',
    supportsTools: true,
  },
  {
    id: 'qwen-2.5-7b',
    name: 'Qwen 2.5 7B Instruct',
    size: 4_400_000_000, // ~4.4 GB
    sizeHuman: '4.4 GB',
    url: '', // Ollama-only
    description: 'Excellent multilingual model with native tool calling.',
    supportsTools: true,
  },
  {
    id: 'tinyllama-1.1b',
    name: 'TinyLlama 1.1B (No Tools)',
    size: 670_000_000, // ~670 MB
    sizeHuman: '670 MB',
    url: 'https://huggingface.co/Mozilla/TinyLlama-1.1B-Chat-v1.0-llamafile/resolve/main/TinyLlama-1.1B-Chat-v1.0.Q5_K_M.llamafile',
    description: 'Fastest download. Limited capability, NO tool support.',
    supportsTools: false,
  },
];

// =============================================================================
// Paths
// =============================================================================

function getLLMDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  return path.join(homeDir, '.harbor', 'llm');
}

function getModelPath(modelId: string): string {
  return path.join(getLLMDir(), `${modelId}.llamafile`);
}

/**
 * Get the path to the marker file indicating a model was downloaded via Ollama.
 * We use a marker file instead of the actual model since Ollama stores models in its own directory.
 */
function getOllamaMarkerPath(modelId: string): string {
  return path.join(getLLMDir(), `${modelId}.ollama`);
}

/**
 * Map of model IDs to Ollama model names.
 * 
 * IMPORTANT: Only use Ollama models that support native tool calling!
 * - llama3.1, llama3.2, llama3.3 (8B+) - YES
 * - mistral-nemo, mistral-large - YES  
 * - qwen2.5 - YES
 * - mistral:7b-instruct - NO (old model, no tool support)
 */
const OLLAMA_MODEL_MAP: Record<string, string> = {
  'llama-3.2-3b': 'llama3.2:3b',
  'mistral-nemo': 'mistral-nemo',
  'qwen-2.5-7b': 'qwen2.5:7b',
  'tinyllama-1.1b': 'tinyllama',
};

function getPidFilePath(): string {
  return path.join(getLLMDir(), 'running.json');
}

function ensureLLMDir(): void {
  const dir = getLLMDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

interface RunningProcessInfo {
  pid: number;
  modelId: string;
  port: number;
  startedAt: string;
  /** Docker container ID (if running in Docker) */
  dockerContainerId?: string;
}

/**
 * Save running process info to disk so we can recover after bridge restart.
 */
function saveRunningProcess(info: RunningProcessInfo): void {
  try {
    ensureLLMDir();
    fs.writeFileSync(getPidFilePath(), JSON.stringify(info, null, 2));
    log(`[LLMSetup] Saved PID file: ${info.pid} for ${info.modelId}`);
  } catch (err) {
    log(`[LLMSetup] Failed to save PID file: ${err}`);
  }
}

/**
 * Load running process info from disk.
 */
function loadRunningProcess(): RunningProcessInfo | null {
  try {
    const pidFile = getPidFilePath();
    if (!fs.existsSync(pidFile)) {
      return null;
    }
    const content = fs.readFileSync(pidFile, 'utf-8');
    return JSON.parse(content) as RunningProcessInfo;
  } catch (err) {
    log(`[LLMSetup] Failed to load PID file: ${err}`);
    return null;
  }
}

/**
 * Clear the running process info file.
 */
function clearRunningProcess(): void {
  try {
    const pidFile = getPidFilePath();
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
      log('[LLMSetup] Cleared PID file');
    }
  } catch (err) {
    log(`[LLMSetup] Failed to clear PID file: ${err}`);
  }
}

/**
 * Check if a process with the given PID is still running.
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify that a tracked process is actually a llamafile we started.
 * This guards against PID reuse - if our llamafile died and the PID
 * was reused by another process, we shouldn't think it's still our llamafile.
 */
function verifyTrackedProcess(info: RunningProcessInfo): boolean {
  // First check if process exists at all
  if (!isProcessRunning(info.pid)) {
    log(`[LLMSetup] PID ${info.pid} is not running`);
    return false;
  }
  
  // Check if the process is actually a llamafile
  try {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      // Get the command line of the process
      const cmd = execSync(`ps -p ${info.pid} -o command= 2>/dev/null || true`, { 
        encoding: 'utf-8' 
      }).trim();
      
      if (!cmd) {
        log(`[LLMSetup] Could not get command for PID ${info.pid}`);
        return false;
      }
      
      // Check if it looks like a llamafile
      const isLlamafile = cmd.includes('llamafile') || 
                          cmd.includes('.llamafile') ||
                          cmd.includes('--server') && cmd.includes('--host');
      
      if (!isLlamafile) {
        log(`[LLMSetup] PID ${info.pid} is not a llamafile (cmd: ${cmd.substring(0, 100)})`);
        return false;
      }
      
      log(`[LLMSetup] Verified PID ${info.pid} is a llamafile`);
      return true;
      
    } else if (process.platform === 'win32') {
      // Windows: use wmic to get process info
      const cmd = execSync(`wmic process where ProcessId=${info.pid} get CommandLine 2>nul`, {
        encoding: 'utf-8'
      }).trim();
      
      const isLlamafile = cmd.includes('llamafile') || cmd.includes('.llamafile');
      if (!isLlamafile) {
        log(`[LLMSetup] PID ${info.pid} is not a llamafile on Windows`);
        return false;
      }
      
      return true;
    }
    
    // Unknown platform - just trust the PID check
    return true;
    
  } catch (err) {
    log(`[LLMSetup] Error verifying process ${info.pid}: ${err}`);
    // If we can't verify, assume it's not valid to be safe
    return false;
  }
}

/**
 * Clean up stale PID file if the tracked process is no longer valid.
 * Call this on startup to handle cases where the process died unexpectedly.
 */
function cleanupStalePidFile(): void {
  const info = loadRunningProcess();
  if (!info) return;
  
  if (!verifyTrackedProcess(info)) {
    log(`[LLMSetup] Cleaning up stale PID file for ${info.modelId} (PID ${info.pid})`);
    clearRunningProcess();
  }
}

// =============================================================================
// LLM Setup Manager
// =============================================================================

export class LLMSetupManager {
  private runningProcess: ChildProcess | null = null;
  private activeModelId: string | null = null;
  private downloadAbortController: AbortController | null = null;
  
  /**
   * Get current setup status.
   */
  async getStatus(): Promise<LLMSetupStatus> {
    // Clean up any stale PID files on status check
    cleanupStalePidFile();
    
    // Check what's downloaded
    const downloadedModels = this.getDownloadedModels();
    
    // Check if something is running
    const runningCheck = await this.checkRunning();
    
    const status: LLMSetupStatus = {
      available: runningCheck.available,
      runningProvider: runningCheck.provider,
      runningUrl: runningCheck.url,
      downloadedModels,
      activeModel: this.activeModelId,
      availableModels: AVAILABLE_MODELS,
    };
    
    // Include Ollama-specific info if Ollama is running
    if (runningCheck.ollamaInfo) {
      status.ollamaInfo = runningCheck.ollamaInfo;
    }
    
    return status;
  }
  
  /**
   * Get list of downloaded model IDs.
   * Includes both llamafile downloads and Ollama-downloaded models.
   */
  getDownloadedModels(): string[] {
    const dir = getLLMDir();
    if (!fs.existsSync(dir)) {
      return [];
    }
    
    const files = fs.readdirSync(dir);
    const modelIds = new Set<string>();
    
    // Llamafile downloads
    files
      .filter(f => f.endsWith('.llamafile'))
      .forEach(f => modelIds.add(f.replace('.llamafile', '')));
    
    // Ollama downloads (marker files)
    files
      .filter(f => f.endsWith('.ollama'))
      .forEach(f => modelIds.add(f.replace('.ollama', '')));
    
    return Array.from(modelIds);
  }
  
  /**
   * Check if a model was downloaded via Ollama (vs llamafile).
   */
  isOllamaModel(modelId: string): boolean {
    return fs.existsSync(getOllamaMarkerPath(modelId));
  }
  
  /**
   * Check if an LLM is running.
   */
  private async checkRunning(): Promise<{
    available: boolean;
    provider: 'llamafile' | 'ollama' | 'external' | null;
    url: string | null;
    ollamaInfo?: {
      version: string | null;
      supportsTools: boolean;
      minimumToolVersion: string;
      recommendedVersion: string;
      warning?: string;
    };
  }> {
    // Check if we have a tracked llamafile process (from PID file)
    const savedProcess = loadRunningProcess();
    if (savedProcess) {
      // Verify the process is actually running AND is a llamafile
      if (verifyTrackedProcess(savedProcess)) {
        const llamafileUrl = `http://localhost:${savedProcess.port}`;
        // Also verify the server is responding on HTTP
        if (await this.isServerRunning(llamafileUrl)) {
          // Restore our tracking if we just restarted
          if (!this.activeModelId) {
            this.activeModelId = savedProcess.modelId;
            log(`[LLMSetup] Recovered tracked process: PID ${savedProcess.pid}, model ${savedProcess.modelId}`);
          }
          return {
            available: true,
            provider: 'llamafile',
            url: llamafileUrl,
          };
        } else {
          // Process exists but server not responding - might be starting up or crashed
          log(`[LLMSetup] Tracked process ${savedProcess.pid} exists but server not responding`);
        }
      } else {
        // PID file exists but process is dead or not a llamafile - clean up
        log(`[LLMSetup] Tracked process ${savedProcess.pid} is invalid or dead, cleaning up`);
        clearRunningProcess();
      }
    }
    
    // Check llamafile default port (8080) for untracked processes
    const llamafileUrl = 'http://localhost:8080';
    if (await this.isServerRunning(llamafileUrl)) {
      return {
        available: true,
        provider: 'external',  // Can't manage it - we didn't start it
        url: llamafileUrl,
      };
    }
    
    // Check Ollama
    const ollamaUrl = 'http://localhost:11434';
    if (await this.isOllamaRunning(ollamaUrl)) {
      const ollamaInfo = await this.getOllamaInfo(ollamaUrl);
      return {
        available: true,
        provider: 'ollama',
        url: ollamaUrl,
        ollamaInfo,
      };
    }
    
    return {
      available: false,
      provider: null,
      url: null,
    };
  }
  
  /**
   * Check if Ollama is running using any-llm-ts.
   */
  private async isOllamaRunning(baseUrl: string): Promise<boolean> {
    try {
      const ollama = AnyLLM.create('ollama', { baseUrl });
      return await ollama.isAvailable();
    } catch {
      return false;
    }
  }
  
  /**
   * Get Ollama version and tool support info.
   */
  private async getOllamaInfo(baseUrl: string): Promise<{
    version: string | null;
    supportsTools: boolean;
    minimumToolVersion: string;
    recommendedVersion: string;
    warning?: string;
  }> {
    const MINIMUM_TOOL_VERSION = '0.3.0';
    const RECOMMENDED_VERSION = '0.5.0';
    
    let version: string | null = null;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`${baseUrl}/api/version`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json() as { version?: string };
        version = data.version || null;
      }
    } catch {
      // Version check failed
    }
    
    // Compare versions
    const supportsTools = version ? this.compareVersions(version, MINIMUM_TOOL_VERSION) >= 0 : true;
    const meetsRecommended = version ? this.compareVersions(version, RECOMMENDED_VERSION) >= 0 : true;
    
    let warning: string | undefined;
    if (!supportsTools) {
      warning = `Version ${version} does not support tool calling. Upgrade to ${MINIMUM_TOOL_VERSION} or later.`;
    } else if (!meetsRecommended) {
      warning = `Version ${version} supports tools but ${RECOMMENDED_VERSION}+ is recommended for reliability.`;
    }
    
    return {
      version,
      supportsTools,
      minimumToolVersion: MINIMUM_TOOL_VERSION,
      recommendedVersion: RECOMMENDED_VERSION,
      warning,
    };
  }
  
  /**
   * Compare two semantic version strings.
   * Returns: negative if a < b, 0 if a == b, positive if a > b
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
    const partsB = b.replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
    
    const maxLen = Math.max(partsA.length, partsB.length);
    
    for (let i = 0; i < maxLen; i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      
      if (numA !== numB) {
        return numA - numB;
      }
    }
    
    return 0;
  }
  
  /**
   * Check if a server is responding.
   */
  private async isServerRunning(baseUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`${baseUrl}/v1/models`, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }
  
  /**
   * Download a model.
   * On macOS with Docker, uses Ollama to download (faster, works without Gatekeeper issues).
   * Otherwise downloads llamafile directly.
   */
  async downloadModel(
    modelId: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const model = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    
    ensureLLMDir();
    
    // Check if already downloaded (either llamafile or ollama marker)
    const targetPath = getModelPath(modelId);
    const ollamaMarkerPath = getOllamaMarkerPath(modelId);
    
    if (fs.existsSync(targetPath) || fs.existsSync(ollamaMarkerPath)) {
      log(`[LLMSetup] Model ${modelId} already downloaded`);
      onProgress?.({
        modelId,
        bytesDownloaded: model.size,
        totalBytes: model.size,
        percent: 100,
        status: 'complete',
      });
      return;
    }
    
    // Check for native Ollama first (best performance)
    const nativeOllamaAvailable = await this.checkNativeOllamaInstalled();
    if (nativeOllamaAvailable) {
      log(`[LLMSetup] Native Ollama detected, using for download (best performance)`);
      return this.downloadModelViaNativeOllama(modelId, model, onProgress);
    }
    
    // On macOS without native Ollama, try Docker (slower but avoids Gatekeeper)
    if (process.platform === 'darwin') {
      const dockerExec = getDockerExec();
      const dockerInfo = await dockerExec.checkDocker();
      
      if (dockerInfo.available) {
        log(`[LLMSetup] No native Ollama, using Docker (slower - consider installing Ollama: brew install ollama)`);
        return this.downloadModelViaOllama(modelId, model, onProgress);
      }
    }
    
    log(`[LLMSetup] Starting llamafile download of ${modelId} from ${model.url}`);
    
    const tempPath = `${targetPath}.download`;
    
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tempPath);
      let downloadedBytes = 0;
      
      const request = https.get(model.url, {
        headers: {
          'User-Agent': 'Harbor-Bridge/1.0',
        },
      }, (response) => {
        // Handle redirects (301, 302, 307, 308)
        if (response.statusCode === 301 || response.statusCode === 302 || 
            response.statusCode === 307 || response.statusCode === 308) {
          let redirectUrl = response.headers.location;
          if (redirectUrl) {
            try {
              // Handle relative redirects by resolving against original URL
              if (redirectUrl.startsWith('/')) {
                const originalUrl = new URL(model.url);
                redirectUrl = `${originalUrl.protocol}//${originalUrl.host}${redirectUrl}`;
              }
              
              // Validate the redirect URL
              new URL(redirectUrl); // Will throw if invalid
              
              log(`[LLMSetup] Following redirect to ${redirectUrl}`);
              file.close();
              if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
              }
              
            // Recursively follow redirect
            https.get(redirectUrl, {
              headers: { 'User-Agent': 'Harbor-Bridge/1.0' },
            }, (redirectResponse) => {
              this.handleDownloadResponse(
                redirectResponse,
                tempPath,
                targetPath,
                modelId,
                model.size,
                onProgress,
                resolve,
                reject,
                redirectUrl,
                1
              );
            }).on('error', (err) => {
                log(`[LLMSetup] Redirect request failed: ${err.message}`);
                if (fs.existsSync(tempPath)) {
                  fs.unlinkSync(tempPath);
                }
                onProgress?.({
                  modelId,
                  bytesDownloaded: 0,
                  totalBytes: model.size,
                  percent: 0,
                  status: 'error',
                  error: `Redirect failed: ${err.message}`,
                });
                reject(new Error(`Redirect failed: ${err.message}`));
              });
              return;
            } catch (urlError) {
              // Invalid redirect URL - fail gracefully
              log(`[LLMSetup] Invalid redirect URL: ${redirectUrl} - ${urlError}`);
              file.close();
              if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
              }
              onProgress?.({
                modelId,
                bytesDownloaded: 0,
                totalBytes: model.size,
                percent: 0,
                status: 'error',
                error: `Invalid redirect URL from server`,
              });
              reject(new Error(`Invalid redirect URL: ${redirectUrl}`));
              return;
            }
          }
        }
        
        // Handle non-success status codes
        if (response.statusCode && response.statusCode >= 400) {
          log(`[LLMSetup] HTTP error: ${response.statusCode}`);
          file.close();
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
          onProgress?.({
            modelId,
            bytesDownloaded: 0,
            totalBytes: model.size,
            percent: 0,
            status: 'error',
            error: `HTTP error ${response.statusCode}`,
          });
          reject(new Error(`HTTP error ${response.statusCode}`));
          return;
        }
        
        this.handleDownloadResponse(
          response,
          tempPath,
          targetPath,
          modelId,
          model.size,
          onProgress,
          resolve,
          reject,
          model.url,
          0
        );
      });
      
      request.on('error', (err) => {
        file.close();
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        onProgress?.({
          modelId,
          bytesDownloaded: 0,
          totalBytes: model.size,
          percent: 0,
          status: 'error',
          error: err.message,
        });
        reject(err);
      });
    });
  }
  
  private handleDownloadResponse(
    response: any,
    tempPath: string,
    targetPath: string,
    modelId: string,
    expectedSize: number,
    onProgress: ((progress: DownloadProgress) => void) | undefined,
    resolve: () => void,
    reject: (err: Error) => void,
    currentUrl?: string,
    redirectCount = 0
  ): void {
    // Limit redirects to prevent infinite loops
    const MAX_REDIRECTS = 10;
    if (redirectCount > MAX_REDIRECTS) {
      log(`[LLMSetup] Too many redirects (${redirectCount})`);
      onProgress?.({
        modelId,
        bytesDownloaded: 0,
        totalBytes: expectedSize,
        percent: 0,
        status: 'error',
        error: 'Too many redirects',
      });
      reject(new Error('Too many redirects'));
      return;
    }
    
    // Check for redirects in this response too
    if (response.statusCode === 301 || response.statusCode === 302 || 
        response.statusCode === 307 || response.statusCode === 308) {
      let redirectUrl = response.headers.location;
      if (redirectUrl) {
        try {
          // Handle relative redirects
          if (redirectUrl.startsWith('/') && currentUrl) {
            const originalUrl = new URL(currentUrl);
            redirectUrl = `${originalUrl.protocol}//${originalUrl.host}${redirectUrl}`;
          }
          
          // Validate URL
          new URL(redirectUrl);
          
          log(`[LLMSetup] Following redirect #${redirectCount + 1} to ${redirectUrl}`);
          
          https.get(redirectUrl, {
            headers: { 'User-Agent': 'Harbor-Bridge/1.0' },
          }, (redirectResponse) => {
            this.handleDownloadResponse(
              redirectResponse,
              tempPath,
              targetPath,
              modelId,
              expectedSize,
              onProgress,
              resolve,
              reject,
              redirectUrl,
              redirectCount + 1
            );
          }).on('error', (err) => {
            log(`[LLMSetup] Redirect request failed: ${err.message}`);
            onProgress?.({
              modelId,
              bytesDownloaded: 0,
              totalBytes: expectedSize,
              percent: 0,
              status: 'error',
              error: `Redirect failed: ${err.message}`,
            });
            reject(new Error(`Redirect failed: ${err.message}`));
          });
          return;
        } catch (urlError) {
          log(`[LLMSetup] Invalid redirect URL: ${redirectUrl}`);
          onProgress?.({
            modelId,
            bytesDownloaded: 0,
            totalBytes: expectedSize,
            percent: 0,
            status: 'error',
            error: 'Invalid redirect URL',
          });
          reject(new Error(`Invalid redirect URL: ${redirectUrl}`));
          return;
        }
      }
    }
    
    // Handle error status codes
    if (response.statusCode && response.statusCode >= 400) {
      log(`[LLMSetup] HTTP error in response: ${response.statusCode}`);
      onProgress?.({
        modelId,
        bytesDownloaded: 0,
        totalBytes: expectedSize,
        percent: 0,
        status: 'error',
        error: `HTTP error ${response.statusCode}`,
      });
      reject(new Error(`HTTP error ${response.statusCode}`));
      return;
    }
    
    // Now we have the actual file response
    const totalBytes = parseInt(response.headers['content-length'] || String(expectedSize), 10);
    let downloadedBytes = 0;
    let lastReportedPercent = -1;
    
    log(`[LLMSetup] Starting actual download, size: ${Math.round(totalBytes / 1_000_000)} MB`);
    
    const file = fs.createWriteStream(tempPath);
    
    response.on('data', (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      const percent = Math.round((downloadedBytes / totalBytes) * 100);
      
      // Only report every 1% to reduce noise
      if (percent !== lastReportedPercent) {
        lastReportedPercent = percent;
        onProgress?.({
          modelId,
          bytesDownloaded: downloadedBytes,
          totalBytes,
          percent,
          status: 'downloading',
        });
      }
    });
    
    response.pipe(file);
    
    file.on('finish', () => {
      file.close();
      
      // Verify file size is reasonable (at least 100MB for LLM files)
      const stats = fs.statSync(tempPath);
      if (stats.size < 100_000_000) {
        log(`[LLMSetup] Downloaded file too small: ${stats.size} bytes`);
        fs.unlinkSync(tempPath);
        onProgress?.({
          modelId,
          bytesDownloaded: 0,
          totalBytes: expectedSize,
          percent: 0,
          status: 'error',
          error: `Downloaded file too small (${Math.round(stats.size / 1000)} KB). Server may have returned an error page.`,
        });
        reject(new Error('Downloaded file too small - likely an error page'));
        return;
      }
      
      // Rename temp to final
      fs.renameSync(tempPath, targetPath);
      
      // Make executable
      fs.chmodSync(targetPath, 0o755);
      
      // Remove macOS quarantine and other extended attributes to prevent Gatekeeper prompts
      if (process.platform === 'darwin') {
        try {
          // Use -cr to recursively clear ALL extended attributes
          execSync(`xattr -cr "${targetPath}"`, { stdio: 'pipe' });
          log(`[LLMSetup] Cleared extended attributes from ${targetPath}`);
        } catch (e) {
          // Log but don't fail - user can manually clear if needed
          log(`[LLMSetup] Warning: Could not clear extended attributes: ${e}`);
        }
      }
      
      log(`[LLMSetup] Download complete: ${targetPath} (${Math.round(stats.size / 1_000_000)} MB)`);
      
      onProgress?.({
        modelId,
        bytesDownloaded: totalBytes,
        totalBytes,
        percent: 100,
        status: 'complete',
      });
      
      resolve();
    });
    
    file.on('error', (err) => {
      file.close();
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      onProgress?.({
        modelId,
        bytesDownloaded: downloadedBytes,
        totalBytes,
        percent: 0,
        status: 'error',
        error: err.message,
      });
      reject(err);
    });
  }
  
  /**
   * Download a model via native Ollama (fastest on macOS with Metal GPU).
   */
  private async downloadModelViaNativeOllama(
    modelId: string,
    model: LLMModel,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const ollamaModel = OLLAMA_MODEL_MAP[modelId];
    if (!ollamaModel) {
      throw new Error(`No Ollama equivalent for model: ${modelId}`);
    }
    
    const ollamaUrl = 'http://localhost:11434';
    
    log(`[LLMSetup] Downloading ${modelId} via native Ollama (${ollamaModel})`);
    
    try {
      // Ensure Ollama is running
      let isRunning = await this.isOllamaRunning(ollamaUrl);
      
      if (!isRunning) {
        log('[LLMSetup] Starting native Ollama server for download...');
        const ollamaServe = spawn('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore',
        });
        ollamaServe.unref();
        
        const ready = await this.waitForOllamaReady(ollamaUrl, 30000);
        if (!ready) {
          throw new Error('Failed to start native Ollama server');
        }
      }
      
      // Check if model is already downloaded
      const modelAvailable = await this.checkOllamaModelAvailable(ollamaUrl, ollamaModel);
      if (modelAvailable) {
        log(`[LLMSetup] Model ${ollamaModel} already available in native Ollama`);
        
        // Create marker file
        const ollamaMarkerPath = getOllamaMarkerPath(modelId);
        fs.writeFileSync(ollamaMarkerPath, JSON.stringify({
          modelId,
          ollamaModelName: ollamaModel,
          downloadedAt: new Date().toISOString(),
          native: true,
        }));
        
        onProgress?.({
          modelId,
          bytesDownloaded: model.size,
          totalBytes: model.size,
          percent: 100,
          status: 'complete',
        });
        return;
      }
      
      // Pull the model with progress streaming
      log(`[LLMSetup] Pulling model via native Ollama: ${ollamaModel}`);
      
      onProgress?.({
        modelId,
        bytesDownloaded: 0,
        totalBytes: model.size,
        percent: 0,
        status: 'downloading',
      });
      
      const response = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ollamaModel, stream: true }),
      });
      
      if (!response.ok) {
        throw new Error(`Ollama pull failed: ${response.status}`);
      }
      
      // Stream the progress
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      let lastPercent = -1;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const data = JSON.parse(line) as { 
              status?: string; 
              completed?: number; 
              total?: number;
              error?: string;
            };
            
            if (data.error) {
              throw new Error(data.error);
            }
            
            if (data.total && data.completed !== undefined) {
              const percent = Math.round((data.completed / data.total) * 100);
              if (percent !== lastPercent) {
                lastPercent = percent;
                onProgress?.({
                  modelId,
                  bytesDownloaded: data.completed,
                  totalBytes: data.total,
                  percent,
                  status: 'downloading',
                });
              }
            }
            
            if (data.status === 'success') {
              // Create marker file
              const ollamaMarkerPath = getOllamaMarkerPath(modelId);
              fs.writeFileSync(ollamaMarkerPath, JSON.stringify({
                modelId,
                ollamaModelName: ollamaModel,
                downloadedAt: new Date().toISOString(),
                native: true,
              }));
              
              log(`[LLMSetup] Native Ollama download complete: ${ollamaModel}`);
              onProgress?.({
                modelId,
                bytesDownloaded: model.size,
                totalBytes: model.size,
                percent: 100,
                status: 'complete',
              });
              return;
            }
          } catch (parseError) {
            // Ignore parse errors for non-JSON lines
          }
        }
      }
      
      throw new Error('Download did not complete successfully');
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[LLMSetup] Native Ollama download failed: ${message}`);
      
      onProgress?.({
        modelId,
        bytesDownloaded: 0,
        totalBytes: model.size,
        percent: 0,
        status: 'error',
        error: message,
      });
      
      throw error;
    }
  }
  
  /**
   * Download a model via Ollama in Docker.
   * This is used on macOS to avoid Gatekeeper issues with llamafile.
   */
  private async downloadModelViaOllama(
    modelId: string,
    model: LLMModel,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    const ollamaModel = OLLAMA_MODEL_MAP[modelId];
    if (!ollamaModel) {
      throw new Error(`No Ollama equivalent for model: ${modelId}`);
    }
    
    const containerName = 'harbor-ollama';
    const ollamaPort = 11434;
    const ollamaUrl = `http://127.0.0.1:${ollamaPort}`;
    
    log(`[LLMSetup] Downloading ${modelId} via Ollama (${ollamaModel})`);
    
    try {
      // Ensure Ollama container is running
      const containerRunning = await this.ensureOllamaContainer(containerName, ollamaPort);
      if (!containerRunning) {
        throw new Error('Failed to start Ollama container');
      }
      
      // Pull the model with progress streaming
      log(`[LLMSetup] Pulling Ollama model: ${ollamaModel}`);
      
      onProgress?.({
        modelId,
        bytesDownloaded: 0,
        totalBytes: model.size,
        percent: 0,
        status: 'downloading',
      });
      
      const response = await fetch(`${ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ollamaModel, stream: true }),
      });
      
      if (!response.ok) {
        throw new Error(`Ollama pull failed: ${response.status}`);
      }
      
      // Stream the progress
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }
      
      const decoder = new TextDecoder();
      let lastPercent = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line) as { 
              status?: string; 
              completed?: number; 
              total?: number; 
              error?: string;
            };
            
            if (data.error) {
              throw new Error(data.error);
            }
            
            // Calculate progress
            if (data.completed && data.total) {
              const percent = Math.round((data.completed / data.total) * 100);
              if (percent !== lastPercent) {
                lastPercent = percent;
                log(`[LLMSetup] Ollama pull: ${data.status} ${percent}%`);
                onProgress?.({
                  modelId,
                  bytesDownloaded: data.completed,
                  totalBytes: data.total,
                  percent,
                  status: 'downloading',
                });
              }
            } else if (data.status) {
              log(`[LLMSetup] Ollama pull: ${data.status}`);
            }
          } catch (parseErr) {
            // Ignore JSON parse errors for partial lines
            if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
              throw parseErr;
            }
          }
        }
      }
      
      // Write marker file to indicate this model was downloaded via Ollama
      const markerPath = getOllamaMarkerPath(modelId);
      fs.writeFileSync(markerPath, JSON.stringify({
        modelId,
        ollamaModel,
        downloadedAt: new Date().toISOString(),
      }, null, 2));
      
      log(`[LLMSetup] Ollama download complete: ${ollamaModel}`);
      
      onProgress?.({
        modelId,
        bytesDownloaded: model.size,
        totalBytes: model.size,
        percent: 100,
        status: 'complete',
      });
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[LLMSetup] Ollama download failed: ${message}`);
      
      onProgress?.({
        modelId,
        bytesDownloaded: 0,
        totalBytes: model.size,
        percent: 0,
        status: 'error',
        error: message,
      });
      
      throw error;
    }
  }
  
  /**
   * Ensure Ollama container is running, start it if not.
   */
  private async ensureOllamaContainer(containerName: string, port: number): Promise<boolean> {
    const ollamaUrl = `http://127.0.0.1:${port}`;
    
    // Check if Ollama is already responding (maybe already running)
    if (await this.isOllamaRunning(ollamaUrl)) {
      log('[LLMSetup] Ollama already running');
      return true;
    }
    
    log('[LLMSetup] Starting Ollama container...');
    
    try {
      // Remove any existing container
      try {
        execSync(`docker rm -f "${containerName}"`, { stdio: 'ignore' });
      } catch {
        // Container didn't exist
      }
      
      // Start Ollama container
      const homeDir = process.env.HOME || '/tmp';
      const ollamaDataDir = path.join(homeDir, '.harbor', 'ollama-docker');
      
      if (!fs.existsSync(ollamaDataDir)) {
        fs.mkdirSync(ollamaDataDir, { recursive: true });
      }
      
      const dockerArgs = [
        'run', '-d',
        '--name', containerName,
        '-p', `${port}:11434`,
        '-v', `${ollamaDataDir}:/root/.ollama`,
        'ollama/ollama',
      ];
      
      const result = spawnSync('docker', dockerArgs, {
        encoding: 'utf-8',
        timeout: 60000,
      });
      
      if (result.status !== 0) {
        log(`[LLMSetup] Docker start failed: ${result.stderr}`);
        return false;
      }
      
      // Wait for API to be ready
      const ready = await this.waitForOllamaReady(ollamaUrl, 30000);
      if (!ready) {
        log('[LLMSetup] Ollama API not ready after 30s');
        return false;
      }
      
      log('[LLMSetup] Ollama container started');
      return true;
      
    } catch (error) {
      log(`[LLMSetup] Failed to start Ollama container: ${error}`);
      return false;
    }
  }
  
  /**
   * Cancel an in-progress download.
   */
  cancelDownload(): void {
    if (this.downloadAbortController) {
      this.downloadAbortController.abort();
      this.downloadAbortController = null;
    }
  }
  
  /**
   * Delete a downloaded model.
   * Handles both llamafile and Ollama downloads.
   */
  deleteModel(modelId: string): boolean {
    // Stop if running
    if (this.activeModelId === modelId) {
      this.stopLocalLLM();
    }
    
    let deleted = false;
    
    // Delete llamafile if exists
    const modelPath = getModelPath(modelId);
    if (fs.existsSync(modelPath)) {
      fs.unlinkSync(modelPath);
      log(`[LLMSetup] Deleted llamafile: ${modelId}`);
      deleted = true;
    }
    
    // Delete Ollama marker if exists
    const ollamaMarkerPath = getOllamaMarkerPath(modelId);
    if (fs.existsSync(ollamaMarkerPath)) {
      fs.unlinkSync(ollamaMarkerPath);
      log(`[LLMSetup] Deleted Ollama marker: ${modelId}`);
      deleted = true;
      
      // Also try to delete the model from Ollama
      const ollamaModel = OLLAMA_MODEL_MAP[modelId];
      if (ollamaModel) {
        this.deleteOllamaModel(ollamaModel).catch(err => {
          log(`[LLMSetup] Warning: Could not delete from Ollama: ${err}`);
        });
      }
    }
    
    return deleted;
  }
  
  /**
   * Delete a model from Ollama.
   */
  private async deleteOllamaModel(modelName: string): Promise<void> {
    const ollamaUrl = 'http://127.0.0.1:11434';
    
    try {
      const response = await fetch(`${ollamaUrl}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
        signal: AbortSignal.timeout(10000),
      });
      
      if (response.ok) {
        log(`[LLMSetup] Deleted model from Ollama: ${modelName}`);
      }
    } catch {
      // Ollama might not be running, that's OK
    }
  }
  
  /**
   * Docker container ID for the running llamafile (if using Docker).
   */
  private dockerContainerId: string | null = null;
  
  /**
   * Start a downloaded llamafile.
   * On macOS, uses Docker to avoid Gatekeeper issues.
   */
  async startLocalLLM(modelId: string, port: number = 8080): Promise<{
    success: boolean;
    error?: string;
    url?: string;
  }> {
    const modelPath = getModelPath(modelId);
    
    if (!fs.existsSync(modelPath)) {
      return {
        success: false,
        error: `Model not downloaded: ${modelId}`,
      };
    }
    
    // Stop any existing process
    if (this.runningProcess || this.dockerContainerId) {
      await this.stopLocalLLM();
    }
    
    // Check for native Ollama first (best performance on macOS with Metal GPU)
    const nativeOllamaAvailable = await this.checkNativeOllamaInstalled();
    if (nativeOllamaAvailable) {
      log('[LLMSetup] Native Ollama detected, using for best performance');
      return this.startWithNativeOllama(modelId);
    }
    
    // On macOS without native Ollama, use Docker (slower but avoids Gatekeeper)
    if (process.platform === 'darwin') {
      const dockerExec = getDockerExec();
      const dockerInfo = await dockerExec.checkDocker();
      
      if (dockerInfo.available) {
        log('[LLMSetup] No native Ollama, using Docker (slower - consider installing Ollama natively)');
        return this.startLocalLLMWithDocker(modelId, modelPath, port);
      } else {
        log(`[LLMSetup] Docker not available: ${dockerInfo.error}`);
        log('[LLMSetup] Attempting native llamafile execution (may fail due to Gatekeeper)');
      }
    }
    
    // Native llamafile execution (Linux, or macOS without Docker/Ollama)
    return this.startLocalLLMNative(modelId, modelPath, port);
  }
  
  /**
   * Start Ollama in Docker (for macOS to bypass Gatekeeper issues with llamafile).
   * Uses the official Ollama Docker image. Model should already be downloaded.
   */
  private async startLocalLLMWithDocker(
    modelId: string, 
    _modelPath: string, 
    _port: number
  ): Promise<{ success: boolean; error?: string; url?: string }> {
    const ollamaModel = OLLAMA_MODEL_MAP[modelId];
    if (!ollamaModel) {
      return {
        success: false,
        error: `No Ollama equivalent for model: ${modelId}`,
      };
    }
    
    const containerName = 'harbor-ollama';
    const ollamaPort = 11434;
    const ollamaUrl = `http://127.0.0.1:${ollamaPort}`;
    
    log(`[LLMSetup] Starting Ollama in Docker with model: ${ollamaModel}`);
    
    try {
      // Ensure Ollama container is running
      const containerRunning = await this.ensureOllamaContainer(containerName, ollamaPort);
      if (!containerRunning) {
        return {
          success: false,
          error: 'Failed to start Ollama container',
        };
      }
      
      // Model should already be downloaded during the download phase
      // Just verify it's available
      const modelAvailable = await this.checkOllamaModelAvailable(ollamaUrl, ollamaModel);
      
      if (!modelAvailable) {
        // Model not found - try to pull it (fallback for edge cases)
        log(`[LLMSetup] Model ${ollamaModel} not found, pulling...`);
        const pullSuccess = await this.pullOllamaModel(ollamaUrl, ollamaModel);
        if (!pullSuccess) {
          return {
            success: false,
            error: `Model ${ollamaModel} not available. Please download it first.`,
          };
        }
      }
      
      this.activeModelId = modelId;
      this.dockerContainerId = containerName;
      
      // Save container info for recovery
      saveRunningProcess({
        pid: -1,
        modelId,
        port: ollamaPort,
        startedAt: new Date().toISOString(),
        dockerContainerId: containerName,
      });
      
      log(`[LLMSetup] Ollama ready with model ${ollamaModel} at ${ollamaUrl}`);
      
      return {
        success: true,
        url: ollamaUrl,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[LLMSetup] Docker/Ollama start failed: ${message}`);
      
      return {
        success: false,
        error: `Docker/Ollama failed: ${message}`,
      };
    }
  }
  
  /**
   * Check if native Ollama is installed on the system.
   * Native Ollama is much faster on macOS because it uses Metal GPU acceleration.
   */
  private async checkNativeOllamaInstalled(): Promise<boolean> {
    try {
      // Check if ollama command exists
      const result = spawnSync('which', ['ollama'], { encoding: 'utf-8' });
      if (result.status !== 0) {
        log('[LLMSetup] Native Ollama not found (which ollama failed)');
        return false;
      }
      
      // Check if Ollama is running or can be started
      const ollamaUrl = 'http://localhost:11434';
      if (await this.isOllamaRunning(ollamaUrl)) {
        log('[LLMSetup] Native Ollama is already running');
        return true;
      }
      
      // Ollama is installed but not running - we can start it
      log('[LLMSetup] Native Ollama is installed but not running');
      return true;
      
    } catch (error) {
      log(`[LLMSetup] Error checking native Ollama: ${error}`);
      return false;
    }
  }
  
  /**
   * Start using native Ollama (much faster on macOS with Metal GPU).
   */
  private async startWithNativeOllama(modelId: string): Promise<{
    success: boolean;
    error?: string;
    url?: string;
  }> {
    const ollamaModel = OLLAMA_MODEL_MAP[modelId];
    if (!ollamaModel) {
      return {
        success: false,
        error: `No Ollama equivalent for model: ${modelId}`,
      };
    }
    
    const ollamaUrl = 'http://localhost:11434';
    
    try {
      // Check if Ollama is running
      let isRunning = await this.isOllamaRunning(ollamaUrl);
      
      if (!isRunning) {
        // Try to start Ollama serve in background
        log('[LLMSetup] Starting native Ollama server...');
        const ollamaServe = spawn('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore',
        });
        ollamaServe.unref();
        
        // Wait for it to be ready
        const ready = await this.waitForOllamaReady(ollamaUrl, 30000);
        if (!ready) {
          return {
            success: false,
            error: 'Failed to start native Ollama server. Try running "ollama serve" manually.',
          };
        }
        isRunning = true;
      }
      
      // Check if model is available
      const modelAvailable = await this.checkOllamaModelAvailable(ollamaUrl, ollamaModel);
      
      if (!modelAvailable) {
        // Pull the model
        log(`[LLMSetup] Pulling model ${ollamaModel}...`);
        const pullResult = spawnSync('ollama', ['pull', ollamaModel], {
          encoding: 'utf-8',
          timeout: 600000, // 10 minute timeout for large models
        });
        
        if (pullResult.status !== 0) {
          return {
            success: false,
            error: `Failed to pull model ${ollamaModel}: ${pullResult.stderr}`,
          };
        }
      }
      
      this.activeModelId = modelId;
      
      log(`[LLMSetup] Native Ollama ready with model: ${ollamaModel}`);
      
      return {
        success: true,
        url: ollamaUrl,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[LLMSetup] Native Ollama start failed: ${message}`);
      
      return {
        success: false,
        error: `Native Ollama failed: ${message}`,
      };
    }
  }
  
  /**
   * Check if a model is available in Ollama using any-llm-ts.
   */
  private async checkOllamaModelAvailable(baseUrl: string, modelName: string): Promise<boolean> {
    try {
      const ollama = AnyLLM.create('ollama', { baseUrl });
      const models = await ollama.listModels();
      
      // Check if model exists (handle both "model" and "model:tag" formats)
      const modelBase = modelName.split(':')[0];
      return models.some(m => 
        m.id === modelName || 
        m.id.startsWith(modelBase + ':')
      );
      
    } catch {
      return false;
    }
  }
  
  /**
   * Wait for Ollama API to be ready using any-llm-ts.
   */
  private async waitForOllamaReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const ollama = AnyLLM.create('ollama', { baseUrl });
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        if (await ollama.isAvailable()) {
          return true;
        }
      } catch {
        // Not ready yet
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    return false;
  }
  
  /**
   * Pull an Ollama model via API.
   */
  private async pullOllamaModel(baseUrl: string, modelName: string): Promise<boolean> {
    try {
      log(`[LLMSetup] Pulling Ollama model: ${modelName}`);
      
      // Ollama pull can take a long time - we'll stream the response
      const response = await fetch(`${baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
      });
      
      if (!response.ok) {
        log(`[LLMSetup] Pull request failed: ${response.status}`);
        return false;
      }
      
      // Read the streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        log('[LLMSetup] No response body reader');
        return false;
      }
      
      const decoder = new TextDecoder();
      let lastStatus = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
            
            if (data.error) {
              log(`[LLMSetup] Pull error: ${data.error}`);
              return false;
            }
            
            // Log progress occasionally
            if (data.status && data.status !== lastStatus) {
              lastStatus = data.status;
              if (data.completed && data.total) {
                const percent = Math.round((data.completed / data.total) * 100);
                log(`[LLMSetup] Pulling ${modelName}: ${data.status} ${percent}%`);
              } else {
                log(`[LLMSetup] Pulling ${modelName}: ${data.status}`);
              }
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
      }
      
      log(`[LLMSetup] Model pull complete: ${modelName}`);
      return true;
      
    } catch (error) {
      log(`[LLMSetup] Pull failed: ${error}`);
      return false;
    }
  }
  
  /**
   * Start llamafile natively (for Linux, or macOS without Docker).
   */
  private async startLocalLLMNative(
    modelId: string,
    modelPath: string,
    port: number
  ): Promise<{ success: boolean; error?: string; url?: string }> {
    // Ensure the file is executable
    try {
      fs.chmodSync(modelPath, 0o755);
    } catch (chmodErr) {
      log(`[LLMSetup] Warning: Could not set execute permissions: ${chmodErr}`);
    }
    
    // On macOS, try to clear extended attributes (may not work due to Gatekeeper)
    if (process.platform === 'darwin') {
      try {
        execSync(`xattr -cr "${modelPath}"`, { stdio: 'ignore' });
        log(`[LLMSetup] Cleared extended attributes from ${modelPath}`);
      } catch (xattrErr) {
        log(`[LLMSetup] Warning: Could not clear extended attributes: ${xattrErr}`);
      }
      
      // Also clear quarantine from llamafile's cache directory
      const homeDir = process.env.HOME || '';
      const llamafileCacheDirs = [
        path.join(homeDir, '.cache', 'llamafile'),
        path.join(homeDir, '.llamafile'),
        '/tmp/llamafile',
      ];
      
      for (const cacheDir of llamafileCacheDirs) {
        if (fs.existsSync(cacheDir)) {
          try {
            execSync(`xattr -cr "${cacheDir}"`, { stdio: 'ignore' });
            log(`[LLMSetup] Cleared extended attributes from cache: ${cacheDir}`);
          } catch {
            // Ignore
          }
        }
      }
    }
    
    log(`[LLMSetup] Starting llamafile natively: ${modelPath}`);
    
    try {
      this.runningProcess = spawn(modelPath, [
        '--server',
        '--host', '127.0.0.1',
        '--port', String(port),
        '--ctx-size', '4096',
        '--parallel', '1',
      ], {
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
      
      this.activeModelId = modelId;
      
      // Save PID file for recovery
      if (this.runningProcess.pid) {
        saveRunningProcess({
          pid: this.runningProcess.pid,
          modelId,
          port,
          startedAt: new Date().toISOString(),
        });
      }
      
      // Log stderr
      this.runningProcess.stderr?.on('data', (data) => {
        log(`[llamafile] ${data.toString().trim()}`);
      });
      
      this.runningProcess.on('error', (err) => {
        log(`[LLMSetup] Process error: ${err.message}`);
        this.runningProcess = null;
        this.activeModelId = null;
        clearRunningProcess();
      });
      
      this.runningProcess.on('exit', (code) => {
        log(`[LLMSetup] Process exited with code ${code}`);
        this.runningProcess = null;
        this.activeModelId = null;
        clearRunningProcess();
      });
      
      // Wait for server to be ready
      const url = `http://127.0.0.1:${port}`;
      const ready = await this.waitForServer(url, 30000);
      
      if (!ready) {
        this.stopLocalLLM();
        return {
          success: false,
          error: 'Server failed to start within 30 seconds. On macOS, try installing Docker Desktop.',
        };
      }
      
      log(`[LLMSetup] Server ready at ${url}`);
      
      return {
        success: true,
        url,
      };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[LLMSetup] Failed to start: ${message}`);
      
      return {
        success: false,
        error: message,
      };
    }
  }
  
  /**
   * Wait for the server to be ready.
   */
  private async waitForServer(url: string, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (await this.isServerRunning(url)) {
        return true;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    return false;
  }
  
  /**
   * Stop the running llamafile or Ollama container.
   * Handles both native processes and Docker containers.
   */
  async stopLocalLLM(): Promise<boolean> {
    log('[LLMSetup] Stopping LLM...');
    
    // Check for Docker container first (by ID or name)
    if (this.dockerContainerId) {
      try {
        log(`[LLMSetup] Stopping Docker container: ${this.dockerContainerId}`);
        execSync(`docker stop ${this.dockerContainerId}`, { 
          timeout: 10000,
          stdio: 'ignore',
        });
        log('[LLMSetup] Docker container stopped');
      } catch (error) {
        log(`[LLMSetup] Error stopping Docker container: ${error}`);
        // Try force remove
        try {
          execSync(`docker rm -f ${this.dockerContainerId}`, { stdio: 'ignore' });
        } catch {
          // Ignore
        }
      }
      this.dockerContainerId = null;
      this.activeModelId = null;
      clearRunningProcess();
      return true;
    }
    
    // Also try stopping by known container name (harbor-ollama)
    try {
      execSync('docker stop harbor-ollama', { timeout: 10000, stdio: 'ignore' });
      execSync('docker rm harbor-ollama', { timeout: 5000, stdio: 'ignore' });
      log('[LLMSetup] Stopped harbor-ollama container');
    } catch {
      // Container wasn't running
    }
    
    // Check saved process info for Docker container
    const savedProcess = loadRunningProcess();
    if (savedProcess?.dockerContainerId) {
      try {
        log(`[LLMSetup] Stopping saved Docker container: ${savedProcess.dockerContainerId}`);
        execSync(`docker stop ${savedProcess.dockerContainerId}`, { 
          timeout: 10000,
          stdio: 'ignore',
        });
        log('[LLMSetup] Docker container stopped');
      } catch (error) {
        log(`[LLMSetup] Error stopping Docker container: ${error}`);
        try {
          execSync(`docker rm -f ${savedProcess.dockerContainerId}`, { stdio: 'ignore' });
        } catch {
          // Ignore
        }
      }
      this.activeModelId = null;
      clearRunningProcess();
      return true;
    }
    
    // Method 1: If we have a direct reference to the process, use it
    if (this.runningProcess) {
      try {
        this.runningProcess.kill('SIGTERM');
        
        // Wait a bit for graceful shutdown
        await new Promise(r => setTimeout(r, 1000));
        
        // Force kill if still running
        if (this.runningProcess && !this.runningProcess.killed) {
          this.runningProcess.kill('SIGKILL');
        }
        
        this.runningProcess = null;
        this.activeModelId = null;
        clearRunningProcess();
        
        log('[LLMSetup] Stopped (direct reference)');
        return true;
        
      } catch (error) {
        log(`[LLMSetup] Error stopping via direct reference: ${error}`);
        this.runningProcess = null;
        this.activeModelId = null;
      }
    }
    
    // Method 2: Use PID file to find and kill the process we started
    if (savedProcess) {
      log(`[LLMSetup] Found tracked process: PID ${savedProcess.pid}`);
      
      if (isProcessRunning(savedProcess.pid)) {
        try {
          // Try graceful shutdown first
          process.kill(savedProcess.pid, 'SIGTERM');
          await new Promise(r => setTimeout(r, 1000));
          
          // Force kill if still running
          if (isProcessRunning(savedProcess.pid)) {
            process.kill(savedProcess.pid, 'SIGKILL');
          }
          
          this.activeModelId = null;
          clearRunningProcess();
          
          log(`[LLMSetup] Stopped tracked process: PID ${savedProcess.pid}`);
          return true;
          
        } catch (error) {
          log(`[LLMSetup] Error stopping tracked process: ${error}`);
          // Process might already be gone
          clearRunningProcess();
        }
      } else {
        // Process is already dead, just clean up
        log(`[LLMSetup] Tracked process ${savedProcess.pid} already dead, cleaning up`);
        clearRunningProcess();
      }
      
      this.activeModelId = null;
      return true;
    }
    
    log('[LLMSetup] No tracked llamafile process found to stop');
    return false;
  }
  
  /**
   * Get the PID of the running process.
   */
  getPid(): number | null {
    return this.runningProcess?.pid || null;
  }
}

// Singleton
let _setupManager: LLMSetupManager | null = null;

export function getLLMSetupManager(): LLMSetupManager {
  if (!_setupManager) {
    _setupManager = new LLMSetupManager();
  }
  return _setupManager;
}


