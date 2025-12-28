"""
SQLite database for persistent catalog storage.

Provides:
- Fast startup (load from local DB)
- Background refresh (update DB asynchronously)
- Change tracking (detect additions, updates, removals)
- Priority scoring (rank servers by relevance)
"""

import json
import logging
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Database location
DB_DIR = Path.home() / ".harbor"
DB_PATH = DB_DIR / "catalog.db"

# Priority scoring weights
SCORE_REMOTE_ENDPOINT = 1000  # Has a live remote endpoint
SCORE_REMOTE_CAPABLE = 400    # Supports remote but no URL known
SCORE_FEATURED = 500          # Marked as featured
SCORE_OFFICIAL_TAG = 300      # Has "official" tag
SCORE_OFFICIAL_SOURCE = 200   # From official registry
SCORE_HAS_DESCRIPTION = 50    # Has a description
SCORE_HAS_REPO = 25           # Has a repository link
SCORE_RECENT_UPDATE = 100     # Updated in last 7 days

# Staleness thresholds
STALE_THRESHOLD_HOURS = 1     # Consider data stale after 1 hour
REMOVED_THRESHOLD_DAYS = 7    # Mark as removed after 7 days not seen


@dataclass
class ServerChange:
    """Represents a change to a server entry."""
    server_id: str
    change_type: str  # 'added', 'updated', 'removed', 'restored'
    field_changes: Optional[dict] = None


def get_db_connection() -> sqlite3.Connection:
    """Get a database connection, creating tables if needed."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    
    # Create tables if they don't exist
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source TEXT NOT NULL,
            endpoint_url TEXT DEFAULT '',
            installable_only INTEGER DEFAULT 1,
            description TEXT DEFAULT '',
            homepage_url TEXT DEFAULT '',
            repository_url TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',  -- JSON array
            packages TEXT DEFAULT '[]',  -- JSON array of package info
            
            -- Metadata
            first_seen_at REAL NOT NULL,
            last_seen_at REAL NOT NULL,
            last_updated_at REAL,
            
            -- Status
            is_removed INTEGER DEFAULT 0,
            removed_at REAL,
            
            -- Scoring factors
            is_featured INTEGER DEFAULT 0,
            popularity_score INTEGER DEFAULT 0,
            priority_score INTEGER DEFAULT 0
        );
        
        CREATE INDEX IF NOT EXISTS idx_servers_source ON servers(source);
        CREATE INDEX IF NOT EXISTS idx_servers_priority ON servers(priority_score DESC);
        CREATE INDEX IF NOT EXISTS idx_servers_removed ON servers(is_removed);
        CREATE INDEX IF NOT EXISTS idx_servers_endpoint ON servers(endpoint_url);
        
        CREATE TABLE IF NOT EXISTS provider_status (
            provider_id TEXT PRIMARY KEY,
            provider_name TEXT NOT NULL,
            last_fetch_at REAL,
            last_success_at REAL,
            last_error TEXT,
            server_count INTEGER DEFAULT 0
        );
        
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    """)
    
    conn.commit()
    return conn


def compute_priority_score(
    endpoint_url: str,
    source: str,
    is_featured: bool,
    description: str,
    repository_url: str,
    tags: list[str],
    popularity_score: int = 0,
    last_updated_at: Optional[float] = None,
) -> int:
    """Compute a priority score for ranking servers."""
    score = 0
    
    # Remote endpoint is most important
    if endpoint_url:
        score += SCORE_REMOTE_ENDPOINT
    elif "remote_capable" in tags:
        score += SCORE_REMOTE_CAPABLE
    
    # Featured servers
    if is_featured or "featured" in tags:
        score += SCORE_FEATURED
    
    # Official tag (from registry metadata)
    if "official" in tags:
        score += SCORE_OFFICIAL_TAG
    
    # Official registry gets priority
    if source == "official_registry":
        score += SCORE_OFFICIAL_SOURCE
    
    # Has useful metadata
    if description:
        score += SCORE_HAS_DESCRIPTION
    if repository_url:
        score += SCORE_HAS_REPO
    
    # Popularity (e.g., GitHub stars)
    score += min(popularity_score, 500)  # Cap at 500
    
    # Recent updates
    if last_updated_at:
        days_ago = (time.time() - last_updated_at) / 86400
        if days_ago < 7:
            score += SCORE_RECENT_UPDATE
    
    return score


class CatalogDatabase:
    """
    SQLite-backed catalog storage with change tracking.
    """
    
    def __init__(self):
        self._conn: Optional[sqlite3.Connection] = None
    
    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = get_db_connection()
        return self._conn
    
    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None
    
    def get_all_servers(
        self,
        include_removed: bool = False,
        remote_only: bool = False,
        source: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> list[dict]:
        """
        Get servers from database, sorted by priority score.
        
        Args:
            include_removed: Include servers marked as removed
            remote_only: Only return servers with endpoint URLs
            source: Filter by source provider
            limit: Maximum number to return
        """
        query = "SELECT * FROM servers WHERE 1=1"
        params: list = []
        
        if not include_removed:
            query += " AND is_removed = 0"
        
        if remote_only:
            query += " AND endpoint_url != ''"
        
        if source:
            query += " AND source = ?"
            params.append(source)
        
        query += " ORDER BY priority_score DESC, name ASC"
        
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        
        cursor = self.conn.execute(query, params)
        rows = cursor.fetchall()
        
        return [self._row_to_dict(row) for row in rows]
    
    def search_servers(self, query: str, limit: int = 100) -> list[dict]:
        """Search servers by name or description."""
        search_term = f"%{query}%"
        cursor = self.conn.execute("""
            SELECT * FROM servers 
            WHERE is_removed = 0 
              AND (name LIKE ? OR description LIKE ?)
            ORDER BY priority_score DESC
            LIMIT ?
        """, (search_term, search_term, limit))
        
        return [self._row_to_dict(row) for row in cursor.fetchall()]
    
    def upsert_servers(
        self,
        servers: list[dict],
        source: str,
    ) -> list[ServerChange]:
        """
        Insert or update servers, tracking changes.
        
        Returns list of changes (added, updated, restored).
        """
        changes: list[ServerChange] = []
        now = time.time()
        
        for server in servers:
            server_id = server["id"]
            
            # Check if exists
            cursor = self.conn.execute(
                "SELECT * FROM servers WHERE id = ?",
                (server_id,)
            )
            existing = cursor.fetchone()
            
            tags = server.get("tags", [])
            tags_json = json.dumps(tags)
            packages = server.get("packages", [])
            packages_json = json.dumps(packages)
            
            # Compute priority score
            priority = compute_priority_score(
                endpoint_url=server.get("endpoint_url", ""),
                source=source,
                is_featured=server.get("is_featured", False),
                description=server.get("description", ""),
                repository_url=server.get("repository_url", ""),
                tags=tags,
                popularity_score=server.get("popularity_score", 0),
                last_updated_at=now,
            )
            
            if existing is None:
                # New server
                self.conn.execute("""
                    INSERT INTO servers (
                        id, name, source, endpoint_url, installable_only,
                        description, homepage_url, repository_url, tags, packages,
                        first_seen_at, last_seen_at, last_updated_at,
                        is_featured, popularity_score, priority_score
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    server_id,
                    server.get("name", ""),
                    source,
                    server.get("endpoint_url", ""),
                    1 if server.get("installable_only", True) else 0,
                    server.get("description", ""),
                    server.get("homepage_url", ""),
                    server.get("repository_url", ""),
                    tags_json,
                    packages_json,
                    now, now, now,
                    1 if server.get("is_featured", False) else 0,
                    server.get("popularity_score", 0),
                    priority,
                ))
                changes.append(ServerChange(server_id, "added"))
                
            else:
                # Existing server - check for changes
                was_removed = existing["is_removed"]
                field_changes = {}
                
                # Check what changed
                if existing["name"] != server.get("name", ""):
                    field_changes["name"] = server.get("name", "")
                if existing["endpoint_url"] != server.get("endpoint_url", ""):
                    field_changes["endpoint_url"] = server.get("endpoint_url", "")
                if existing["description"] != server.get("description", ""):
                    field_changes["description"] = server.get("description", "")
                
                # Update
                self.conn.execute("""
                    UPDATE servers SET
                        name = ?,
                        endpoint_url = ?,
                        installable_only = ?,
                        description = ?,
                        homepage_url = ?,
                        repository_url = ?,
                        tags = ?,
                        packages = ?,
                        last_seen_at = ?,
                        last_updated_at = CASE WHEN ? THEN ? ELSE last_updated_at END,
                        is_removed = 0,
                        removed_at = NULL,
                        is_featured = ?,
                        popularity_score = ?,
                        priority_score = ?
                    WHERE id = ?
                """, (
                    server.get("name", ""),
                    server.get("endpoint_url", ""),
                    1 if server.get("installable_only", True) else 0,
                    server.get("description", ""),
                    server.get("homepage_url", ""),
                    server.get("repository_url", ""),
                    tags_json,
                    packages_json,
                    now,
                    bool(field_changes), now,
                    1 if server.get("is_featured", False) else 0,
                    server.get("popularity_score", 0),
                    priority,
                    server_id,
                ))
                
                if was_removed:
                    changes.append(ServerChange(server_id, "restored"))
                elif field_changes:
                    changes.append(ServerChange(server_id, "updated", field_changes))
        
        self.conn.commit()
        return changes
    
    def mark_removed(self, source: str, seen_ids: set[str]) -> list[ServerChange]:
        """
        Mark servers from a source as removed if not in seen_ids.
        
        Returns list of removal changes.
        """
        changes: list[ServerChange] = []
        now = time.time()
        
        # Find servers from this source that weren't seen
        cursor = self.conn.execute("""
            SELECT id FROM servers 
            WHERE source = ? AND is_removed = 0 AND id NOT IN ({})
        """.format(",".join("?" * len(seen_ids)) if seen_ids else "''"),
            [source] + list(seen_ids)
        )
        
        for row in cursor.fetchall():
            server_id = row["id"]
            self.conn.execute("""
                UPDATE servers SET is_removed = 1, removed_at = ?
                WHERE id = ?
            """, (now, server_id))
            changes.append(ServerChange(server_id, "removed"))
        
        self.conn.commit()
        return changes
    
    def update_provider_status(
        self,
        provider_id: str,
        provider_name: str,
        success: bool,
        server_count: int = 0,
        error: Optional[str] = None,
    ):
        """Update provider fetch status."""
        now = time.time()
        
        self.conn.execute("""
            INSERT INTO provider_status (provider_id, provider_name, last_fetch_at, last_success_at, last_error, server_count)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider_id) DO UPDATE SET
                last_fetch_at = ?,
                last_success_at = CASE WHEN ? THEN ? ELSE last_success_at END,
                last_error = ?,
                server_count = CASE WHEN ? THEN ? ELSE server_count END
        """, (
            provider_id, provider_name, now,
            now if success else None,
            error, server_count,
            now,
            success, now,
            error,
            success, server_count,
        ))
        self.conn.commit()
    
    def get_provider_status(self) -> list[dict]:
        """Get status of all providers."""
        cursor = self.conn.execute("SELECT * FROM provider_status")
        return [dict(row) for row in cursor.fetchall()]
    
    def is_cache_stale(self) -> bool:
        """Check if any provider data is stale."""
        threshold = time.time() - (STALE_THRESHOLD_HOURS * 3600)
        
        cursor = self.conn.execute("""
            SELECT COUNT(*) as cnt FROM provider_status
            WHERE last_success_at IS NULL OR last_success_at < ?
        """, (threshold,))
        
        row = cursor.fetchone()
        return row["cnt"] > 0 if row else True
    
    def get_stats(self) -> dict:
        """Get catalog statistics."""
        cursor = self.conn.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN endpoint_url != '' THEN 1 ELSE 0 END) as remote,
                SUM(CASE WHEN is_removed = 1 THEN 1 ELSE 0 END) as removed,
                SUM(CASE WHEN is_featured = 1 THEN 1 ELSE 0 END) as featured
            FROM servers
        """)
        row = cursor.fetchone()
        return dict(row) if row else {}
    
    def _row_to_dict(self, row: sqlite3.Row) -> dict:
        """Convert a database row to a server dict for the extension."""
        # Handle packages column (might not exist in old DBs)
        packages = []
        try:
            packages_str = row["packages"]
            if packages_str:
                packages = json.loads(packages_str)
        except (KeyError, json.JSONDecodeError):
            pass
        
        return {
            "id": row["id"],
            "name": row["name"],
            "source": row["source"],
            "endpointUrl": row["endpoint_url"],
            "installableOnly": bool(row["installable_only"]),
            "packages": packages,
            "description": row["description"],
            "homepageUrl": row["homepage_url"],
            "repositoryUrl": row["repository_url"],
            "tags": json.loads(row["tags"]) if row["tags"] else [],
            "fetchedAt": int(row["last_seen_at"] * 1000),
            "isRemoved": bool(row["is_removed"]),
            "isFeatured": bool(row["is_featured"]),
            "priorityScore": row["priority_score"],
        }


# Singleton
_db: Optional[CatalogDatabase] = None


def get_catalog_db() -> CatalogDatabase:
    """Get the singleton database instance."""
    global _db
    if _db is None:
        _db = CatalogDatabase()
    return _db

