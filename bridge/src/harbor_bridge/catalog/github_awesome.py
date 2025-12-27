"""
GitHub Awesome MCP Servers provider.

Fetches and parses the awesome-mcp-servers list from:
https://github.com/wong2/awesome-mcp-servers
"""

import logging
import re
from typing import Optional
import aiohttp

from .base import CatalogProvider, CatalogServer, ProviderResult, generate_server_id

logger = logging.getLogger(__name__)

# GitHub raw content URL
RAW_README_URL = "https://raw.githubusercontent.com/wong2/awesome-mcp-servers/main/README.md"


class GitHubAwesomeProvider(CatalogProvider):
    """
    Parses MCP servers from the awesome-mcp-servers GitHub repository.
    
    This is a best-effort provider that extracts server info from markdown.
    Most entries won't have remote endpoints - they're typically local tools.
    """
    
    @property
    def id(self) -> str:
        return "github_awesome"
    
    @property
    def name(self) -> str:
        return "GitHub Awesome List"
    
    async def fetch(self, query: Optional[str] = None) -> ProviderResult:
        """Fetch and parse the awesome list README."""
        try:
            async with aiohttp.ClientSession() as session:
                logger.info(f"[{self.name}] Fetching: {RAW_README_URL}")
                
                async with session.get(RAW_README_URL) as response:
                    if response.status != 200:
                        raise Exception(f"HTTP {response.status}")
                    
                    markdown = await response.text()
            
            servers = self._parse_markdown(markdown)
            
            # Filter by query if provided
            if query:
                query_lower = query.lower()
                servers = [
                    s for s in servers
                    if query_lower in s.name.lower() or query_lower in s.description.lower()
                ]
            
            logger.info(f"[{self.name}] Parsed {len(servers)} servers")
            return self._make_result(servers)
            
        except Exception as e:
            logger.error(f"[{self.name}] Fetch error: {e}")
            return self._make_result([], error=str(e))
    
    def _parse_markdown(self, markdown: str) -> list[CatalogServer]:
        """Parse markdown to extract server entries."""
        servers: list[CatalogServer] = []
        lines = markdown.split("\n")
        
        in_relevant_section = False
        current_section = ""
        
        # Match markdown links: [text](url) or **[text](url)** - description
        # Also handles: - **[Name](url)** - description
        link_pattern = re.compile(
            r"^\s*[-*]\s*\*{0,2}\[([^\]]+)\]\(([^)]+)\)\*{0,2}\s*[-–—:]?\s*(.*)"
        )
        
        for line in lines:
            # Track section headers
            if line.startswith("#"):
                header_match = re.match(r"^#+\s+(.+)", line)
                if header_match:
                    current_section = header_match.group(1).lower()
                    # Only parse server-related sections
                    in_relevant_section = any(
                        keyword in current_section
                        for keyword in ("server", "official", "tool", "resource", "framework")
                    )
                continue
            
            if not in_relevant_section:
                continue
            
            match = link_pattern.match(line)
            if match:
                name, href, rest = match.groups()
                
                # Skip navigation/meta items
                if any(skip in name.lower() for skip in ("table of contents", "contributing", "license")):
                    continue
                if not href.startswith("http"):
                    continue
                
                # Clean up description
                description = self._clean_description(rest)
                
                # Try to extract remote URL from description
                endpoint_url = self._extract_endpoint_url(description)
                
                tags = ["remote"] if endpoint_url else ["installable_only"]
                
                servers.append(CatalogServer(
                    id=generate_server_id(self.id, endpoint_url, href, name.strip()),
                    name=name.strip(),
                    source=self.id,
                    endpoint_url=endpoint_url,
                    installable_only=not endpoint_url,
                    description=description,
                    homepage_url=href,
                    repository_url=href if "github.com" in href else "",
                    tags=tags,
                ))
        
        return servers
    
    def _clean_description(self, text: str) -> str:
        """Clean up markdown artifacts from description."""
        # Remove image badges ![...](...)
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
        # Remove additional links [text](url)
        text = re.sub(r"\[[^\]]*\]\([^)]*\)", "", text)
        # Remove HTML tags
        text = re.sub(r"<[^>]*>", "", text)
        # Normalize whitespace
        text = re.sub(r"\s+", " ", text)
        return text.strip()
    
    def _extract_endpoint_url(self, description: str) -> str:
        """Try to extract a remote MCP endpoint URL from description."""
        # Look for URLs containing 'mcp' that might be endpoints
        url_match = re.search(
            r"https?://[^\s<>\[\]()]+mcp[^\s<>\[\]()]*",
            description,
            re.IGNORECASE
        )
        if url_match:
            url = url_match.group(0)
            # Strip trailing punctuation
            return re.sub(r"[.,;:!?]+$", "", url)
        return ""

