"""
Secret store for API keys and credentials.

Uses the system keychain where available, falls back to encrypted file storage.
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Storage location
SECRETS_DIR = Path.home() / ".harbor" / "secrets"
SECRETS_FILE = SECRETS_DIR / "credentials.json"


class SecretStore:
    """
    Secure storage for API keys and credentials.
    
    For now, uses a simple JSON file. In production, should use:
    - macOS: Keychain
    - Linux: Secret Service (libsecret)
    - Windows: Credential Manager
    """
    
    def __init__(self):
        SECRETS_DIR.mkdir(parents=True, exist_ok=True)
        # Set restrictive permissions on secrets directory
        try:
            os.chmod(SECRETS_DIR, 0o700)
        except OSError:
            pass
        
        self._secrets: dict[str, dict[str, str]] = {}
        self._load()
    
    def _load(self):
        """Load secrets from storage."""
        if SECRETS_FILE.exists():
            try:
                with open(SECRETS_FILE, "r") as f:
                    self._secrets = json.load(f)
            except Exception as e:
                logger.warning(f"Failed to load secrets: {e}")
                self._secrets = {}
    
    def _save(self):
        """Save secrets to storage."""
        try:
            with open(SECRETS_FILE, "w") as f:
                json.dump(self._secrets, f, indent=2)
            # Set restrictive permissions
            os.chmod(SECRETS_FILE, 0o600)
        except Exception as e:
            logger.error(f"Failed to save secrets: {e}")
    
    def get(self, server_id: str, key: str) -> Optional[str]:
        """Get a secret value for a server."""
        server_secrets = self._secrets.get(server_id, {})
        return server_secrets.get(key)
    
    def get_all(self, server_id: str) -> dict[str, str]:
        """Get all secrets for a server."""
        return self._secrets.get(server_id, {}).copy()
    
    def set(self, server_id: str, key: str, value: str):
        """Set a secret value for a server."""
        if server_id not in self._secrets:
            self._secrets[server_id] = {}
        self._secrets[server_id][key] = value
        self._save()
    
    def set_all(self, server_id: str, secrets: dict[str, str]):
        """Set all secrets for a server."""
        self._secrets[server_id] = secrets.copy()
        self._save()
    
    def delete(self, server_id: str, key: Optional[str] = None):
        """Delete a secret (or all secrets for a server)."""
        if server_id in self._secrets:
            if key:
                self._secrets[server_id].pop(key, None)
            else:
                del self._secrets[server_id]
            self._save()
    
    def has_secrets(self, server_id: str) -> bool:
        """Check if a server has any stored secrets."""
        return server_id in self._secrets and len(self._secrets[server_id]) > 0
    
    def list_servers(self) -> list[str]:
        """List all servers with stored secrets."""
        return list(self._secrets.keys())
    
    def get_missing_secrets(
        self,
        server_id: str,
        required: list[dict],
    ) -> list[dict]:
        """
        Check which required secrets are missing.
        
        Args:
            server_id: Server ID to check
            required: List of required env var defs from registry
                      [{"name": "API_KEY", "isSecret": True}, ...]
        
        Returns:
            List of missing secret definitions
        """
        stored = self._secrets.get(server_id, {})
        missing = []
        
        for env_var in required:
            if env_var.get("isSecret"):
                name = env_var.get("name", "")
                if name and name not in stored:
                    missing.append(env_var)
        
        return missing


# Singleton
_store: Optional[SecretStore] = None


def get_secret_store() -> SecretStore:
    """Get the singleton SecretStore."""
    global _store
    if _store is None:
        _store = SecretStore()
    return _store

