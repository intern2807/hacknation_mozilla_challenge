"""
Runtime detection and management.

Detects available runtimes (Node.js, Python, Docker) and provides
information about how to install missing ones.
"""

import asyncio
import logging
import shutil
import subprocess
import sys
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class RuntimeType(str, Enum):
    """Types of runtimes we support."""
    NODE = "node"
    PYTHON = "python"
    DOCKER = "docker"


@dataclass
class Runtime:
    """Information about an installed runtime."""
    type: RuntimeType
    available: bool
    version: Optional[str] = None
    path: Optional[str] = None
    runner_cmd: Optional[str] = None  # e.g., "npx", "uvx", "docker"
    install_hint: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            "type": self.type.value,
            "available": self.available,
            "version": self.version,
            "path": self.path,
            "runnerCmd": self.runner_cmd,
            "installHint": self.install_hint,
        }


class RuntimeManager:
    """Detects and manages runtimes for running MCP servers."""
    
    # Install hints for missing runtimes
    INSTALL_HINTS = {
        RuntimeType.NODE: {
            "darwin": "Install with: brew install node\nOr: https://nodejs.org/",
            "linux": "Install with: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs",
            "win32": "Download from: https://nodejs.org/",
        },
        RuntimeType.PYTHON: {
            "darwin": "Install with: brew install python\nOr use uv: curl -LsSf https://astral.sh/uv/install.sh | sh",
            "linux": "Install with: sudo apt install python3 python3-pip\nOr use uv: curl -LsSf https://astral.sh/uv/install.sh | sh",
            "win32": "Download from: https://python.org/\nOr use uv: powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"",
        },
        RuntimeType.DOCKER: {
            "darwin": "Install Docker Desktop: https://docker.com/products/docker-desktop/",
            "linux": "Install with: curl -fsSL https://get.docker.com | sh",
            "win32": "Install Docker Desktop: https://docker.com/products/docker-desktop/",
        },
    }
    
    def __init__(self):
        self._cache: dict[RuntimeType, Runtime] = {}
    
    async def detect_all(self, force_refresh: bool = False) -> list[Runtime]:
        """Detect all available runtimes."""
        if not force_refresh and len(self._cache) == 3:
            return list(self._cache.values())
        
        runtimes = await asyncio.gather(
            self.detect_node(),
            self.detect_python(),
            self.detect_docker(),
        )
        
        for runtime in runtimes:
            self._cache[runtime.type] = runtime
        
        return runtimes
    
    async def detect_node(self) -> Runtime:
        """Detect Node.js and npx availability."""
        runtime = Runtime(
            type=RuntimeType.NODE,
            available=False,
            install_hint=self._get_install_hint(RuntimeType.NODE),
        )
        
        # Check for node
        node_path = shutil.which("node")
        if node_path:
            runtime.path = node_path
            version = await self._get_version("node", "--version")
            if version:
                runtime.version = version
                runtime.available = True
        
        # Check for npx (preferred runner)
        npx_path = shutil.which("npx")
        if npx_path:
            runtime.runner_cmd = "npx"
        elif runtime.available:
            # Fallback to node with require
            runtime.runner_cmd = "node"
        
        self._cache[RuntimeType.NODE] = runtime
        return runtime
    
    async def detect_python(self) -> Runtime:
        """Detect Python and uvx/pip availability."""
        runtime = Runtime(
            type=RuntimeType.PYTHON,
            available=False,
            install_hint=self._get_install_hint(RuntimeType.PYTHON),
        )
        
        # Check for python
        python_path = shutil.which("python3") or shutil.which("python")
        if python_path:
            runtime.path = python_path
            version = await self._get_version(python_path, "--version")
            if version:
                runtime.version = version
                runtime.available = True
        
        # Check for uvx (preferred) or pipx
        uvx_path = shutil.which("uvx")
        if uvx_path:
            runtime.runner_cmd = "uvx"
        else:
            pipx_path = shutil.which("pipx")
            if pipx_path:
                runtime.runner_cmd = "pipx run"
            elif runtime.available:
                # Fallback to python -m
                runtime.runner_cmd = f"{python_path} -m"
        
        self._cache[RuntimeType.PYTHON] = runtime
        return runtime
    
    async def detect_docker(self) -> Runtime:
        """Detect Docker availability."""
        runtime = Runtime(
            type=RuntimeType.DOCKER,
            available=False,
            install_hint=self._get_install_hint(RuntimeType.DOCKER),
        )
        
        docker_path = shutil.which("docker")
        if docker_path:
            runtime.path = docker_path
            runtime.runner_cmd = "docker"
            
            # Check if Docker daemon is running
            try:
                result = subprocess.run(
                    ["docker", "info"],
                    capture_output=True,
                    timeout=5,
                )
                if result.returncode == 0:
                    runtime.available = True
                    version = await self._get_version("docker", "--version")
                    runtime.version = version
                else:
                    runtime.install_hint = "Docker is installed but not running. Start Docker Desktop."
            except (subprocess.TimeoutExpired, Exception):
                runtime.install_hint = "Docker is installed but not responding. Start Docker Desktop."
        
        self._cache[RuntimeType.DOCKER] = runtime
        return runtime
    
    def get_runtime(self, runtime_type: RuntimeType) -> Optional[Runtime]:
        """Get a cached runtime, or None if not detected yet."""
        return self._cache.get(runtime_type)
    
    def get_runtime_for_registry_type(self, registry_type: str) -> Optional[Runtime]:
        """Get the runtime needed for a registry type (npm, pypi, oci)."""
        mapping = {
            "npm": RuntimeType.NODE,
            "pypi": RuntimeType.PYTHON,
            "oci": RuntimeType.DOCKER,
        }
        runtime_type = mapping.get(registry_type.lower())
        if runtime_type:
            return self._cache.get(runtime_type)
        return None
    
    async def _get_version(self, cmd: str, *args: str) -> Optional[str]:
        """Get version string from a command."""
        try:
            result = subprocess.run(
                [cmd, *args],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                # Extract version from output (usually first line)
                output = result.stdout.strip() or result.stderr.strip()
                # Clean up common prefixes
                for prefix in ("v", "Python ", "Docker version "):
                    if output.startswith(prefix):
                        output = output[len(prefix):]
                return output.split()[0] if output else None
        except Exception as e:
            logger.debug(f"Failed to get version for {cmd}: {e}")
        return None
    
    def _get_install_hint(self, runtime_type: RuntimeType) -> str:
        """Get install hint for current platform."""
        platform = sys.platform
        if platform.startswith("linux"):
            platform = "linux"
        hints = self.INSTALL_HINTS.get(runtime_type, {})
        return hints.get(platform, hints.get("linux", ""))


# Singleton
_manager: Optional[RuntimeManager] = None


def get_runtime_manager() -> RuntimeManager:
    """Get the singleton RuntimeManager."""
    global _manager
    if _manager is None:
        _manager = RuntimeManager()
    return _manager

