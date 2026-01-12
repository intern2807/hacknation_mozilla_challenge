/**
 * Runtime detection and management.
 * 
 * Detects available runtimes (Node.js, Python, Docker, Ollama).
 * Uses any-llm-ts for Ollama server availability checks.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { log } from '../native-messaging.js';
import { Runtime, RuntimeType } from '../types.js';
import { AnyLLM } from '../any-llm-ts/src/index.js';

// Install hints for missing runtimes
const INSTALL_HINTS: Record<RuntimeType, Record<string, string>> = {
  [RuntimeType.NODE]: {
    darwin: 'Install with: brew install node\nOr: https://nodejs.org/',
    linux: 'Install with: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs',
    win32: 'Download from: https://nodejs.org/',
  },
  [RuntimeType.PYTHON]: {
    darwin: 'Install with: brew install python\nOr use uv: curl -LsSf https://astral.sh/uv/install.sh | sh',
    linux: 'Install with: sudo apt install python3 python3-pip\nOr use uv: curl -LsSf https://astral.sh/uv/install.sh | sh',
    win32: 'Download from: https://python.org/\nOr use uv: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"',
  },
  [RuntimeType.DOCKER]: {
    darwin: 'Install Docker Desktop: https://docker.com/products/docker-desktop/',
    linux: 'Install with: curl -fsSL https://get.docker.com | sh',
    win32: 'Install Docker Desktop: https://docker.com/products/docker-desktop/',
  },
  [RuntimeType.OLLAMA]: {
    darwin: 'Install with: brew install ollama\nOr download from: https://ollama.com/',
    linux: 'Install with: curl -fsSL https://ollama.com/install.sh | sh',
    win32: 'Download from: https://ollama.com/',
  },
};

function which(cmd: string): string | null {
  try {
    const result = execSync(
      platform() === 'win32' ? `where ${cmd}` : `which ${cmd}`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

function getVersion(cmd: string, args: string[]): string | null {
  try {
    const result = execSync(`${cmd} ${args.join(' ')}`, { 
      encoding: 'utf-8', 
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let version = result.trim();
    // Clean up common prefixes
    for (const prefix of ['v', 'Python ', 'Docker version ']) {
      if (version.startsWith(prefix)) {
        version = version.substring(prefix.length);
      }
    }
    return version.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

function getInstallHint(type: RuntimeType): string {
  const p = platform();
  const hints = INSTALL_HINTS[type];
  return hints[p] || hints.linux || '';
}

export class RuntimeManager {
  private cache: Map<RuntimeType, Runtime> = new Map();

  async detectAll(forceRefresh: boolean = false): Promise<Runtime[]> {
    if (!forceRefresh && this.cache.size === 4) {
      return Array.from(this.cache.values());
    }

    const [node, python, docker, ollama] = await Promise.all([
      this.detectNode(),
      this.detectPython(),
      this.detectDocker(),
      this.detectOllama(),
    ]);

    return [node, python, docker, ollama];
  }

  async detectNode(): Promise<Runtime> {
    const runtime: Runtime = {
      type: RuntimeType.NODE,
      available: false,
      version: null,
      path: null,
      runnerCmd: null,
      installHint: getInstallHint(RuntimeType.NODE),
    };

    const nodePath = which('node');
    if (nodePath) {
      runtime.path = nodePath;
      runtime.version = getVersion('node', ['--version']);
      if (runtime.version) {
        runtime.available = true;
      }
    }

    const npxPath = which('npx');
    if (npxPath) {
      runtime.runnerCmd = 'npx';
    } else if (runtime.available) {
      runtime.runnerCmd = 'node';
    }

    this.cache.set(RuntimeType.NODE, runtime);
    return runtime;
  }

  async detectPython(): Promise<Runtime> {
    const runtime: Runtime = {
      type: RuntimeType.PYTHON,
      available: false,
      version: null,
      path: null,
      runnerCmd: null,
      installHint: getInstallHint(RuntimeType.PYTHON),
    };

    const pythonPath = which('python3') || which('python');
    if (pythonPath) {
      runtime.path = pythonPath;
      runtime.version = getVersion(pythonPath, ['--version']);
      if (runtime.version) {
        runtime.available = true;
      }
    }

    // Check for uvx (preferred) or pipx
    const uvxPath = which('uvx');
    if (uvxPath) {
      runtime.runnerCmd = 'uvx';
    } else {
      const pipxPath = which('pipx');
      if (pipxPath) {
        runtime.runnerCmd = 'pipx run';
      } else if (runtime.available) {
        runtime.runnerCmd = `${pythonPath} -m`;
      }
    }

    this.cache.set(RuntimeType.PYTHON, runtime);
    return runtime;
  }

  async detectDocker(): Promise<Runtime> {
    const runtime: Runtime = {
      type: RuntimeType.DOCKER,
      available: false,
      version: null,
      path: null,
      runnerCmd: null,
      installHint: getInstallHint(RuntimeType.DOCKER),
    };

    const dockerPath = which('docker');
    if (dockerPath) {
      runtime.path = dockerPath;
      runtime.runnerCmd = 'docker';

      // Check if Docker daemon is running
      try {
        execSync('docker info', { 
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        runtime.available = true;
        runtime.version = getVersion('docker', ['--version']);
      } catch {
        runtime.installHint = 'Docker is installed but not running. Start Docker Desktop.';
      }
    }

    this.cache.set(RuntimeType.DOCKER, runtime);
    return runtime;
  }

  async detectOllama(): Promise<Runtime> {
    const runtime: Runtime = {
      type: RuntimeType.OLLAMA,
      available: false,
      version: null,
      path: null,
      runnerCmd: null,
      installHint: getInstallHint(RuntimeType.OLLAMA),
    };

    const ollamaPath = which('ollama');
    if (ollamaPath) {
      runtime.path = ollamaPath;
      runtime.runnerCmd = 'ollama';
      runtime.version = getVersion('ollama', ['--version']);

      // Use any-llm-ts to check if Ollama server is running
      try {
        const ollama = AnyLLM.create('ollama');
        const isRunning = await ollama.isAvailable();
        
        if (isRunning) {
          runtime.available = true;
        } else {
          // Ollama installed but not running - still mark as available since it can be started
          runtime.available = true;
          runtime.installHint = 'Ollama is installed. Run "ollama serve" to start the server.';
        }
      } catch {
        // Ollama installed but server check failed - still mark as available
        runtime.available = true;
        runtime.installHint = 'Ollama is installed. Run "ollama serve" to start the server.';
      }
    }

    this.cache.set(RuntimeType.OLLAMA, runtime);
    log(`[RuntimeManager] Ollama: ${runtime.available ? 'available' : 'not found'} (${runtime.version || 'unknown version'})`);
    return runtime;
  }

  getRuntime(type: RuntimeType): Runtime | undefined {
    return this.cache.get(type);
  }

  getRuntimeForRegistryType(registryType: string): Runtime | undefined {
    const mapping: Record<string, RuntimeType> = {
      npm: RuntimeType.NODE,
      pypi: RuntimeType.PYTHON,
      oci: RuntimeType.DOCKER,
    };
    const type = mapping[registryType.toLowerCase()];
    return type ? this.cache.get(type) : undefined;
  }
}

// Singleton
let _manager: RuntimeManager | null = null;

export function getRuntimeManager(): RuntimeManager {
  if (!_manager) {
    _manager = new RuntimeManager();
  }
  return _manager;
}






