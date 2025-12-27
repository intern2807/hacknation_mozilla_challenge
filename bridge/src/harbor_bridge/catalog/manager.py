"""
Catalog Manager - orchestrates providers and handles caching.
"""

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Optional

from .base import CatalogProvider, CatalogServer, ProviderResult
from .official_registry import OfficialRegistryProvider
from .github_awesome import GitHubAwesomeProvider

logger = logging.getLogger(__name__)

# Cache configuration
CACHE_TTL_SECONDS = 10 * 60  # 10 minutes
CACHE_DIR = Path.home() / ".harbor" / "cache"


def _get_cache_path(provider_id: str) -> Path:
    """Get the cache file path for a provider."""
    return CACHE_DIR / f"catalog_{provider_id}.json"


class CatalogManager:
    """
    Manages catalog providers and coordinates fetching/caching.
    
    To add a new provider:
    1. Create a new provider class in its own file
    2. Add it to the providers list in __init__
    """
    
    def __init__(self):
        # Register all available providers here
        self.providers: list[CatalogProvider] = [
            OfficialRegistryProvider(),
            GitHubAwesomeProvider(),
            # Add new providers here:
            # McpServersOrgProvider(),
            # McpSoProvider(),
        ]
        
        # Ensure cache directory exists
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    def get_provider(self, provider_id: str) -> Optional[CatalogProvider]:
        """Get a provider by ID."""
        for provider in self.providers:
            if provider.id == provider_id:
                return provider
        return None
    
    async def fetch_all(
        self,
        force_refresh: bool = False,
        query: Optional[str] = None
    ) -> dict:
        """
        Fetch from all providers, using cache when available.
        
        Returns:
            {
                "servers": [...],
                "providerStatus": [...],
                "fetchedAt": timestamp
            }
        """
        all_servers: list[CatalogServer] = []
        provider_status: list[dict] = []
        
        # Fetch from all providers concurrently
        tasks = [
            self._fetch_provider(provider, force_refresh, query)
            for provider in self.providers
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for provider, result in zip(self.providers, results):
            if isinstance(result, Exception):
                logger.error(f"Provider {provider.id} failed: {result}")
                provider_status.append({
                    "id": provider.id,
                    "ok": False,
                    "error": str(result),
                    "fetchedAt": int(time.time() * 1000),
                })
            else:
                all_servers.extend(result.servers)
                provider_status.append(result.to_status_dict())
        
        # Dedupe servers by ID (prefer first occurrence)
        seen_ids: set[str] = set()
        unique_servers: list[CatalogServer] = []
        for server in all_servers:
            if server.id not in seen_ids:
                seen_ids.add(server.id)
                unique_servers.append(server)
        
        return {
            "servers": [s.to_dict() for s in unique_servers],
            "providerStatus": provider_status,
            "fetchedAt": int(time.time() * 1000),
        }
    
    async def _fetch_provider(
        self,
        provider: CatalogProvider,
        force_refresh: bool,
        query: Optional[str]
    ) -> ProviderResult:
        """Fetch from a single provider with caching."""
        
        # Try cache first (skip if searching or force refresh)
        if not force_refresh and not query:
            cached = self._load_cache(provider.id)
            if cached:
                logger.info(f"[{provider.name}] Using cached data ({len(cached.servers)} servers)")
                return cached
        
        # Fetch fresh data
        result = await provider.fetch(query)
        
        # Cache successful results (only for non-search queries)
        if result.ok and not query:
            self._save_cache(provider.id, result)
        
        return result
    
    def _load_cache(self, provider_id: str) -> Optional[ProviderResult]:
        """Load cached data if fresh enough."""
        cache_path = _get_cache_path(provider_id)
        
        try:
            if not cache_path.exists():
                return None
            
            with open(cache_path, "r") as f:
                data = json.load(f)
            
            fetched_at = data.get("fetchedAt", 0) / 1000  # Convert from ms
            if time.time() - fetched_at > CACHE_TTL_SECONDS:
                logger.debug(f"[{provider_id}] Cache expired")
                return None
            
            servers = [
                CatalogServer(
                    id=s["id"],
                    name=s["name"],
                    source=s["source"],
                    endpoint_url=s.get("endpointUrl", ""),
                    installable_only=s.get("installableOnly", True),
                    description=s.get("description", ""),
                    homepage_url=s.get("homepageUrl", ""),
                    repository_url=s.get("repositoryUrl", ""),
                    tags=s.get("tags", []),
                    fetched_at=fetched_at,
                )
                for s in data.get("servers", [])
            ]
            
            return ProviderResult(
                provider_id=provider_id,
                provider_name=data.get("providerName", provider_id),
                ok=True,
                servers=servers,
                fetched_at=fetched_at,
            )
            
        except Exception as e:
            logger.warning(f"[{provider_id}] Cache load error: {e}")
            return None
    
    def _save_cache(self, provider_id: str, result: ProviderResult) -> None:
        """Save result to cache."""
        cache_path = _get_cache_path(provider_id)
        
        try:
            data = {
                "providerId": provider_id,
                "providerName": result.provider_name,
                "servers": [s.to_dict() for s in result.servers],
                "fetchedAt": int(result.fetched_at * 1000),
            }
            
            with open(cache_path, "w") as f:
                json.dump(data, f)
            
            logger.debug(f"[{provider_id}] Cached {len(result.servers)} servers")
            
        except Exception as e:
            logger.warning(f"[{provider_id}] Cache save error: {e}")
    
    def clear_cache(self, provider_id: Optional[str] = None) -> None:
        """Clear cache for one or all providers."""
        if provider_id:
            cache_path = _get_cache_path(provider_id)
            if cache_path.exists():
                cache_path.unlink()
                logger.info(f"Cleared cache for {provider_id}")
        else:
            for provider in self.providers:
                cache_path = _get_cache_path(provider.id)
                if cache_path.exists():
                    cache_path.unlink()
            logger.info("Cleared all catalog caches")


# Singleton instance
_manager: Optional[CatalogManager] = None


def get_catalog_manager() -> CatalogManager:
    """Get or create the singleton CatalogManager."""
    global _manager
    if _manager is None:
        _manager = CatalogManager()
    return _manager

