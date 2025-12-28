"""
Catalog Manager - orchestrates providers, caching, and database.

Provides:
- Fast startup from SQLite cache
- Background refresh from providers
- Change notifications for the extension
- Priority-sorted results
"""

import asyncio
import logging
import time
from typing import Optional

from .base import CatalogProvider, CatalogServer
from .database import CatalogDatabase, get_catalog_db, ServerChange
from .official_registry import OfficialRegistryProvider
from .github_awesome import GitHubAwesomeProvider

logger = logging.getLogger(__name__)


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
        ]
        
        self._db: Optional[CatalogDatabase] = None
    
    @property
    def db(self) -> CatalogDatabase:
        if self._db is None:
            self._db = get_catalog_db()
        return self._db
    
    def get_provider(self, provider_id: str) -> Optional[CatalogProvider]:
        """Get a provider by ID."""
        for provider in self.providers:
            if provider.id == provider_id:
                return provider
        return None
    
    async def get_cached(
        self,
        remote_only: bool = False,
        source: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> dict:
        """
        Get servers from cache (fast, synchronous read from SQLite).
        
        Returns immediately with cached data. Use refresh() to update.
        """
        servers = self.db.get_all_servers(
            remote_only=remote_only,
            source=source,
            limit=limit,
        )
        
        provider_status = self.db.get_provider_status()
        is_stale = self.db.is_cache_stale()
        stats = self.db.get_stats()
        
        return {
            "servers": servers,
            "providerStatus": [
                {
                    "id": p["provider_id"],
                    "name": p["provider_name"],
                    "ok": p["last_success_at"] is not None,
                    "count": p["server_count"],
                    "error": p["last_error"],
                    "fetchedAt": int(p["last_fetch_at"] * 1000) if p["last_fetch_at"] else None,
                }
                for p in provider_status
            ],
            "fetchedAt": int(time.time() * 1000),
            "isStale": is_stale,
            "stats": stats,
            "changes": [],  # No changes for cached read
        }
    
    async def refresh(
        self,
        force: bool = False,
        query: Optional[str] = None,
    ) -> dict:
        """
        Refresh catalog from all providers.
        
        Args:
            force: Refresh even if cache is fresh
            query: Optional search query (passed to providers that support it)
        
        Returns:
            Result dict with servers, status, and changes
        """
        if not force and not self.db.is_cache_stale():
            # Cache is fresh, just return cached data
            logger.info("[CatalogManager] Cache is fresh, returning cached data")
            return await self.get_cached()
        
        logger.info("[CatalogManager] Refreshing from providers...")
        
        all_changes: list[dict] = []
        
        # Fetch from all providers concurrently
        tasks = [
            self._fetch_provider(provider, query)
            for provider in self.providers
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for provider, result in zip(self.providers, results):
            if isinstance(result, Exception):
                logger.error(f"[{provider.id}] Failed: {result}")
                self.db.update_provider_status(
                    provider.id,
                    provider.name,
                    success=False,
                    error=str(result),
                )
            elif isinstance(result, dict):
                # Result contains servers and changes
                for change in result.get("changes", []):
                    all_changes.append({
                        "serverId": change.server_id,
                        "type": change.change_type,
                        "source": provider.id,
                        "fieldChanges": change.field_changes,
                    })
        
        # Get updated data from DB
        cached = await self.get_cached()
        cached["changes"] = all_changes
        
        logger.info(f"[CatalogManager] Refresh complete. {len(all_changes)} changes.")
        return cached
    
    async def _fetch_provider(
        self,
        provider: CatalogProvider,
        query: Optional[str],
    ) -> dict:
        """Fetch from a single provider and update database."""
        try:
            result = await provider.fetch(query)
            
            if not result.ok:
                self.db.update_provider_status(
                    provider.id,
                    provider.name,
                    success=False,
                    error=result.error,
                )
                return {"changes": []}
            
            # Convert CatalogServer objects to dicts for database
            server_dicts = [
                {
                    "id": s.id,
                    "name": s.name,
                    "endpoint_url": s.endpoint_url,
                    "installable_only": s.installable_only,
                    "packages": [p.to_dict() for p in s.packages],
                    "description": s.description,
                    "homepage_url": s.homepage_url,
                    "repository_url": s.repository_url,
                    "tags": s.tags,
                    "is_featured": "featured" in s.tags,
                    "popularity_score": 0,  # Could be enhanced later
                }
                for s in result.servers
            ]
            
            # Upsert servers and track changes
            changes = self.db.upsert_servers(server_dicts, provider.id)
            
            # Mark servers not seen in this fetch as removed
            seen_ids = {s.id for s in result.servers}
            removal_changes = self.db.mark_removed(provider.id, seen_ids)
            changes.extend(removal_changes)
            
            # Update provider status
            self.db.update_provider_status(
                provider.id,
                provider.name,
                success=True,
                server_count=len(result.servers),
            )
            
            logger.info(f"[{provider.id}] Updated {len(result.servers)} servers, {len(changes)} changes")
            return {"changes": changes}
            
        except Exception as e:
            logger.exception(f"[{provider.id}] Fetch error")
            self.db.update_provider_status(
                provider.id,
                provider.name,
                success=False,
                error=str(e),
            )
            return {"changes": []}
    
    async def search(self, query: str, limit: int = 100) -> dict:
        """
        Search servers by name or description.
        
        Searches local cache first (fast), then can optionally
        trigger a provider search for live results.
        """
        servers = self.db.search_servers(query, limit)
        
        return {
            "servers": servers,
            "providerStatus": [],
            "fetchedAt": int(time.time() * 1000),
            "query": query,
        }
    
    async def fetch_all(
        self,
        force_refresh: bool = False,
        query: Optional[str] = None,
    ) -> dict:
        """
        Main entry point - get catalog data.
        
        If force_refresh is False and cache is fresh, returns cached data.
        Otherwise refreshes from providers.
        """
        if query:
            # For searches, use local search (fast)
            return await self.search(query)
        
        if force_refresh:
            return await self.refresh(force=True)
        
        # Return cached data, but note if stale
        cached = await self.get_cached()
        
        # If stale, trigger background refresh
        if cached.get("isStale"):
            logger.info("[CatalogManager] Cache is stale, triggering background refresh")
            # Don't await - let it run in background
            asyncio.create_task(self.refresh())
        
        return cached
    
    def clear_cache(self):
        """Clear all cached data."""
        # This is now handled by the database
        # We could add a method to clear the DB if needed
        logger.info("[CatalogManager] Cache clear requested (DB persists)")


# Singleton instance
_manager: Optional[CatalogManager] = None


def get_catalog_manager() -> CatalogManager:
    """Get or create the singleton CatalogManager."""
    global _manager
    if _manager is None:
        _manager = CatalogManager()
    return _manager
