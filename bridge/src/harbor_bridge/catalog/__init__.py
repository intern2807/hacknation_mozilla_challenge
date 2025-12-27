"""
Catalog providers for fetching MCP server listings from various sources.

This module provides a modular system for scraping/fetching MCP server
catalogs from different sources (registries, awesome lists, etc.)
"""

from .base import CatalogProvider, CatalogServer, ProviderResult
from .manager import CatalogManager, get_catalog_manager
from .official_registry import OfficialRegistryProvider
from .github_awesome import GitHubAwesomeProvider

__all__ = [
    "CatalogProvider",
    "CatalogServer", 
    "ProviderResult",
    "CatalogManager",
    "get_catalog_manager",
    "OfficialRegistryProvider",
    "GitHubAwesomeProvider",
]

