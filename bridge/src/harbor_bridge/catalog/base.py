"""
Base classes for catalog providers.

To add a new provider:
1. Create a new file (e.g., my_source.py)
2. Subclass CatalogProvider
3. Implement fetch() method
4. Register in manager.py
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional
import hashlib
import time


@dataclass
class PackageInfo:
    """Package installation info for an MCP server."""
    registry_type: str  # npm, pypi, oci
    identifier: str     # Package identifier (e.g., "@modelcontextprotocol/server-github")
    env_vars: list[dict] = field(default_factory=list)  # Required environment variables
    
    def to_dict(self) -> dict:
        return {
            "registryType": self.registry_type,
            "identifier": self.identifier,
            "environmentVariables": self.env_vars,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "PackageInfo":
        return cls(
            registry_type=data.get("registryType", "npm"),
            identifier=data.get("identifier", ""),
            env_vars=data.get("environmentVariables", []),
        )


@dataclass
class CatalogServer:
    """Normalized representation of an MCP server from any source."""
    
    id: str
    name: str
    source: str  # Provider ID (e.g., 'official_registry', 'github_awesome')
    
    # Connection info
    endpoint_url: str = ""  # Remote MCP endpoint (empty if local-only)
    installable_only: bool = True  # True if no remote endpoint
    
    # Package info for installation
    packages: list[PackageInfo] = field(default_factory=list)
    
    # Metadata
    description: str = ""
    homepage_url: str = ""
    repository_url: str = ""
    tags: list[str] = field(default_factory=list)
    
    # Provenance
    fetched_at: float = field(default_factory=time.time)
    
    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "name": self.name,
            "source": self.source,
            "endpointUrl": self.endpoint_url,
            "installableOnly": self.installable_only,
            "packages": [p.to_dict() for p in self.packages],
            "description": self.description,
            "homepageUrl": self.homepage_url,
            "repositoryUrl": self.repository_url,
            "tags": self.tags,
            "fetchedAt": int(self.fetched_at * 1000),  # JS expects milliseconds
        }


@dataclass
class ProviderResult:
    """Result from a provider fetch operation."""
    
    provider_id: str
    provider_name: str
    ok: bool
    servers: list[CatalogServer] = field(default_factory=list)
    error: Optional[str] = None
    fetched_at: float = field(default_factory=time.time)
    
    def to_status_dict(self) -> dict:
        """Convert to status dictionary for the extension."""
        return {
            "id": self.provider_id,
            "ok": self.ok,
            "count": len(self.servers) if self.ok else None,
            "error": self.error,
            "fetchedAt": int(self.fetched_at * 1000),
        }


def generate_server_id(source: str, *parts: str) -> str:
    """Generate a stable ID for a server based on source and key parts."""
    key = f"{source}:" + ":".join(p for p in parts if p)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


class CatalogProvider(ABC):
    """
    Abstract base class for catalog providers.
    
    Each provider is responsible for fetching server listings from a single source.
    """
    
    @property
    @abstractmethod
    def id(self) -> str:
        """Unique identifier for this provider (e.g., 'official_registry')."""
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable name (e.g., 'Official MCP Registry')."""
        pass
    
    @abstractmethod
    async def fetch(self, query: Optional[str] = None) -> ProviderResult:
        """
        Fetch servers from this source.
        
        Args:
            query: Optional search query to filter results
            
        Returns:
            ProviderResult with servers or error information
        """
        pass
    
    def _make_result(
        self,
        servers: list[CatalogServer],
        error: Optional[str] = None
    ) -> ProviderResult:
        """Helper to create a ProviderResult."""
        return ProviderResult(
            provider_id=self.id,
            provider_name=self.name,
            ok=error is None,
            servers=servers,
            error=error,
        )

