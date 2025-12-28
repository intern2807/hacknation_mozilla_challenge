"""
Installed Server Manager - tracks installed MCP servers and their configs.

This is the main orchestrator that:
- Tracks which servers are installed
- Manages their configurations
- Coordinates with the runner to start/stop servers
"""

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .runtime import RuntimeManager, get_runtime_manager
from .runner import PackageRunner, ServerProcess, ProcessState, get_package_runner
from .secrets import SecretStore, get_secret_store

logger = logging.getLogger(__name__)

# Storage
CONFIG_DIR = Path.home() / ".harbor"
INSTALLED_FILE = CONFIG_DIR / "installed_servers.json"


@dataclass
class InstalledServer:
    """An installed MCP server with its configuration."""
    
    id: str                          # Unique ID (usually catalog ID)
    name: str                        # Display name
    package_type: str                # npm, pypi, oci
    package_id: str                  # Package identifier
    
    # Configuration
    auto_start: bool = False         # Start on Harbor launch
    args: list[str] = field(default_factory=list)
    
    # Required environment variables (from registry)
    required_env_vars: list[dict] = field(default_factory=list)
    
    # Metadata
    installed_at: float = field(default_factory=time.time)
    catalog_source: Optional[str] = None  # e.g., "official_registry"
    homepage_url: Optional[str] = None
    description: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "packageType": self.package_type,
            "packageId": self.package_id,
            "autoStart": self.auto_start,
            "args": self.args,
            "requiredEnvVars": self.required_env_vars,
            "installedAt": int(self.installed_at * 1000),
            "catalogSource": self.catalog_source,
            "homepageUrl": self.homepage_url,
            "description": self.description,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "InstalledServer":
        return cls(
            id=data["id"],
            name=data["name"],
            package_type=data["packageType"],
            package_id=data["packageId"],
            auto_start=data.get("autoStart", False),
            args=data.get("args", []),
            required_env_vars=data.get("requiredEnvVars", []),
            installed_at=data.get("installedAt", time.time() * 1000) / 1000,
            catalog_source=data.get("catalogSource"),
            homepage_url=data.get("homepageUrl"),
            description=data.get("description"),
        )


class InstalledServerManager:
    """
    Manages installed MCP servers.
    
    This is the main API for:
    - Installing servers from the catalog
    - Configuring servers (env vars, args)
    - Starting/stopping servers
    - Checking server status
    """
    
    def __init__(self):
        self._servers: dict[str, InstalledServer] = {}
        self._runtime_manager = get_runtime_manager()
        self._runner = get_package_runner()
        self._secrets = get_secret_store()
        
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self._load()
    
    def _load(self):
        """Load installed servers from disk."""
        if INSTALLED_FILE.exists():
            try:
                with open(INSTALLED_FILE, "r") as f:
                    data = json.load(f)
                
                for server_data in data.get("servers", []):
                    server = InstalledServer.from_dict(server_data)
                    self._servers[server.id] = server
                
                logger.info(f"Loaded {len(self._servers)} installed servers")
            except Exception as e:
                logger.error(f"Failed to load installed servers: {e}")
    
    def _save(self):
        """Save installed servers to disk."""
        try:
            data = {
                "version": 1,
                "servers": [s.to_dict() for s in self._servers.values()],
            }
            with open(INSTALLED_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save installed servers: {e}")
    
    async def install(
        self,
        catalog_entry: dict,
        package_index: int = 0,
    ) -> InstalledServer:
        """
        Install a server from a catalog entry.
        
        Args:
            catalog_entry: Server data from the catalog
            package_index: Which package to install (if multiple)
        
        Returns:
            The installed server config
        """
        server_id = catalog_entry.get("id", "")
        name = catalog_entry.get("name", server_id)
        
        # Get package info (from registry data or infer from ID)
        packages = catalog_entry.get("packages", [])
        
        if packages and package_index < len(packages):
            pkg = packages[package_index]
            package_type = pkg.get("registryType", "npm")
            package_id = pkg.get("identifier", "")
            required_env_vars = pkg.get("environmentVariables", [])
        else:
            # Infer from catalog ID (e.g., "official_registry:abc123")
            # For npm packages, the ID often IS the package name
            package_type = "npm"
            package_id = name
            required_env_vars = []
        
        server = InstalledServer(
            id=server_id,
            name=name,
            package_type=package_type,
            package_id=package_id,
            required_env_vars=required_env_vars,
            catalog_source=catalog_entry.get("source"),
            homepage_url=catalog_entry.get("homepageUrl"),
            description=catalog_entry.get("description"),
        )
        
        self._servers[server_id] = server
        self._save()
        
        logger.info(f"Installed server: {name} ({package_type}:{package_id})")
        return server
    
    def uninstall(self, server_id: str) -> bool:
        """Uninstall a server (remove from Harbor, doesn't remove packages)."""
        if server_id not in self._servers:
            return False
        
        # Stop if running
        proc = self._runner.get_process(server_id)
        if proc and proc.state == ProcessState.RUNNING:
            import asyncio
            asyncio.create_task(self._runner.stop_server(server_id))
        
        # Remove config and secrets
        del self._servers[server_id]
        self._secrets.delete(server_id)
        self._save()
        
        logger.info(f"Uninstalled server: {server_id}")
        return True
    
    def get_server(self, server_id: str) -> Optional[InstalledServer]:
        """Get an installed server by ID."""
        return self._servers.get(server_id)
    
    def get_all_servers(self) -> list[InstalledServer]:
        """Get all installed servers."""
        return list(self._servers.values())
    
    def is_installed(self, server_id: str) -> bool:
        """Check if a server is installed."""
        return server_id in self._servers
    
    async def start(self, server_id: str) -> ServerProcess:
        """Start an installed server."""
        server = self._servers.get(server_id)
        if not server:
            raise ValueError(f"Server not installed: {server_id}")
        
        # Check for required secrets
        missing = self._secrets.get_missing_secrets(
            server_id,
            server.required_env_vars,
        )
        if missing:
            missing_names = [m.get("name") for m in missing]
            raise ValueError(f"Missing required secrets: {missing_names}")
        
        # Get secrets as env vars
        env_vars = self._secrets.get_all(server_id)
        
        # Start the server
        return await self._runner.start_server(
            server_id=server_id,
            package_type=server.package_type,
            package_id=server.package_id,
            env_vars=env_vars,
            args=server.args if server.args else None,
        )
    
    async def stop(self, server_id: str) -> bool:
        """Stop a running server."""
        return await self._runner.stop_server(server_id)
    
    async def restart(self, server_id: str) -> ServerProcess:
        """Restart a server."""
        server = self._servers.get(server_id)
        if not server:
            raise ValueError(f"Server not installed: {server_id}")
        
        env_vars = self._secrets.get_all(server_id)
        return await self._runner.restart_server(server_id, env_vars)
    
    def get_status(self, server_id: str) -> dict:
        """Get full status of an installed server."""
        server = self._servers.get(server_id)
        if not server:
            return {"installed": False}
        
        proc = self._runner.get_process(server_id)
        missing_secrets = self._secrets.get_missing_secrets(
            server_id,
            server.required_env_vars,
        )
        
        return {
            "installed": True,
            "server": server.to_dict(),
            "process": proc.to_dict() if proc else None,
            "missingSecrets": [m.get("name") for m in missing_secrets],
            "canStart": len(missing_secrets) == 0,
        }
    
    def get_all_status(self) -> list[dict]:
        """Get status of all installed servers."""
        return [self.get_status(s.id) for s in self._servers.values()]
    
    def set_secret(self, server_id: str, key: str, value: str):
        """Set a secret for a server."""
        self._secrets.set(server_id, key, value)
    
    def set_secrets(self, server_id: str, secrets: dict[str, str]):
        """Set all secrets for a server."""
        self._secrets.set_all(server_id, secrets)
    
    def configure(
        self,
        server_id: str,
        auto_start: Optional[bool] = None,
        args: Optional[list[str]] = None,
    ):
        """Update server configuration."""
        server = self._servers.get(server_id)
        if not server:
            raise ValueError(f"Server not installed: {server_id}")
        
        if auto_start is not None:
            server.auto_start = auto_start
        if args is not None:
            server.args = args
        
        self._save()
    
    async def start_auto_start_servers(self):
        """Start all servers marked for auto-start."""
        for server in self._servers.values():
            if server.auto_start:
                try:
                    await self.start(server.id)
                except Exception as e:
                    logger.error(f"Failed to auto-start {server.id}: {e}")
    
    async def check_runtimes(self) -> dict:
        """Check available runtimes."""
        runtimes = await self._runtime_manager.detect_all()
        return {
            "runtimes": [r.to_dict() for r in runtimes],
            "canInstall": {
                "npm": any(r.available and r.type.value == "node" for r in runtimes),
                "pypi": any(r.available and r.type.value == "python" for r in runtimes),
                "oci": any(r.available and r.type.value == "docker" for r in runtimes),
            },
        }


# Singleton
_manager: Optional[InstalledServerManager] = None


def get_installed_server_manager() -> InstalledServerManager:
    """Get the singleton InstalledServerManager."""
    global _manager
    if _manager is None:
        _manager = InstalledServerManager()
    return _manager

