"""
Official MCP Registry provider.

Fetches server listings from the official MCP registry API at:
https://registry.modelcontextprotocol.io/v0/servers
"""

import logging
from typing import Optional
import aiohttp

from .base import CatalogProvider, CatalogServer, PackageInfo, ProviderResult, generate_server_id

logger = logging.getLogger(__name__)

# Registry API configuration
REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io"
SERVERS_ENDPOINT = "/v0/servers"
DEFAULT_LIMIT = 100
MAX_PAGES = 10  # Safety limit


class OfficialRegistryProvider(CatalogProvider):
    """
    Fetches MCP servers from the official registry.
    
    The registry API returns paginated results with server metadata including
    transport types (stdio, sse, http) which we use to identify remote servers.
    """
    
    @property
    def id(self) -> str:
        return "official_registry"
    
    @property
    def name(self) -> str:
        return "Official MCP Registry"
    
    async def fetch(self, query: Optional[str] = None) -> ProviderResult:
        """Fetch servers from the registry API with pagination."""
        servers: list[CatalogServer] = []
        cursor: Optional[str] = None
        pages_fetched = 0
        
        try:
            async with aiohttp.ClientSession() as session:
                while pages_fetched < MAX_PAGES:
                    # Build URL with query params
                    params = {"limit": str(DEFAULT_LIMIT)}
                    if cursor:
                        params["cursor"] = cursor
                    if query:
                        params["search"] = query
                    
                    url = f"{REGISTRY_BASE_URL}{SERVERS_ENDPOINT}"
                    logger.info(f"[{self.name}] Fetching: {url} (page {pages_fetched + 1})")
                    
                    async with session.get(url, params=params) as response:
                        if response.status != 200:
                            error_text = await response.text()
                            raise Exception(f"HTTP {response.status}: {error_text[:200]}")
                        
                        data = await response.json()
                    
                    # Parse servers from response
                    raw_servers = data.get("servers", [])
                    for entry in raw_servers:
                        server = self._parse_entry(entry)
                        if server:
                            servers.append(server)
                    
                    pages_fetched += 1
                    logger.info(f"[{self.name}] Page {pages_fetched}: got {len(raw_servers)} servers")
                    
                    # Check for more pages
                    cursor = data.get("cursor")
                    if not cursor:
                        break
            
            logger.info(f"[{self.name}] Total: {len(servers)} servers from {pages_fetched} pages")
            return self._make_result(servers)
            
        except Exception as e:
            logger.error(f"[{self.name}] Fetch error: {e}")
            return self._make_result([], error=str(e))
    
    def _parse_entry(self, entry: dict) -> Optional[CatalogServer]:
        """Parse a registry entry into a CatalogServer."""
        try:
            server_data = entry.get("server", entry)  # Handle nested or flat structure
            
            name = server_data.get("name", "")
            if not name:
                return None
            
            description = server_data.get("description", "")
            
            # Repository can be string or dict with 'url' key
            repository_data = server_data.get("repository", "")
            if isinstance(repository_data, dict):
                repository = repository_data.get("url", "")
            else:
                repository = str(repository_data) if repository_data else ""
            
            # Homepage can also be string or dict
            homepage_data = server_data.get("homepage", "")
            if isinstance(homepage_data, dict):
                homepage = homepage_data.get("url", "")
            else:
                homepage = str(homepage_data) if homepage_data else ""
            
            # Extract endpoint URL from packages with remote transports
            endpoint_url = ""
            packages = server_data.get("packages", [])
            
            for pkg in packages:
                # Transport can be string, list, or dict with 'type' key
                transport_data = pkg.get("transport", [])
                
                # Normalize to list of transport type strings
                transports: list[str] = []
                if isinstance(transport_data, str):
                    transports = [transport_data]
                elif isinstance(transport_data, dict):
                    transport_type = transport_data.get("type", "")
                    if transport_type:
                        transports = [transport_type]
                elif isinstance(transport_data, list):
                    for t in transport_data:
                        if isinstance(t, str):
                            transports.append(t)
                        elif isinstance(t, dict):
                            tt = t.get("type", "")
                            if tt:
                                transports.append(tt)
                
                # Look for remote transports (sse, http, streamable-http)
                remote_transports = [t for t in transports if t in ("sse", "http", "streamable-http")]
                
                if remote_transports:
                    # Try to extract endpoint URL
                    # Check various fields where endpoint might be
                    endpoint_url = (
                        pkg.get("endpoint") or
                        pkg.get("url") or
                        pkg.get("baseUrl") or
                        ""
                    )
                    if isinstance(endpoint_url, dict):
                        endpoint_url = endpoint_url.get("url", "")
                    if endpoint_url:
                        break
            
            # Determine if this server supports remote transport
            supports_remote = any(
                t in ("sse", "http", "streamable-http")
                for pkg in packages
                for t in self._get_transports(pkg)
            )
            
            # Build tags
            tags: list[str] = []
            if endpoint_url:
                tags.append("remote")
            elif supports_remote:
                tags.append("remote_capable")  # Supports remote but no URL known
            else:
                tags.append("installable_only")
            
            # Check for featured/official status
            meta = entry.get("_meta", {})
            registry_meta = meta.get("io.modelcontextprotocol.registry/official", {})
            if registry_meta.get("status") == "active":
                tags.append("official")
            
            # Add any existing tags from the entry (filter out non-strings)
            if "tags" in server_data:
                for tag in server_data["tags"]:
                    if isinstance(tag, str):
                        tags.append(tag)
            
            # Extract package info for installation
            package_infos: list[PackageInfo] = []
            for pkg in packages:
                registry_type = pkg.get("registryType", "npm")
                identifier = pkg.get("identifier", "")
                env_vars = pkg.get("environmentVariables", [])
                
                if identifier:
                    package_infos.append(PackageInfo(
                        registry_type=registry_type,
                        identifier=identifier,
                        env_vars=env_vars,
                    ))
            
            return CatalogServer(
                id=generate_server_id(self.id, endpoint_url, repository, name),
                name=name,
                source=self.id,
                endpoint_url=endpoint_url,
                installable_only=not endpoint_url,
                packages=package_infos,
                description=description,
                homepage_url=homepage or repository,
                repository_url=repository,
                tags=tags,
            )
            
        except Exception as e:
            logger.warning(f"[{self.name}] Failed to parse entry: {e}")
            return None
    
    def _get_transports(self, pkg: dict) -> list[str]:
        """Extract transport types from a package definition."""
        transport_data = pkg.get("transport", [])
        transports: list[str] = []
        
        if isinstance(transport_data, str):
            transports = [transport_data]
        elif isinstance(transport_data, dict):
            transport_type = transport_data.get("type", "")
            if transport_type:
                transports = [transport_type]
        elif isinstance(transport_data, list):
            for t in transport_data:
                if isinstance(t, str):
                    transports.append(t)
                elif isinstance(t, dict):
                    tt = t.get("type", "")
                    if tt:
                        transports.append(tt)
        
        return transports

