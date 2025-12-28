"""
MCP Server Installer - App Store for MCP Servers

This module provides:
- Runtime detection (node, python, docker)
- One-click server installation
- Process management (start/stop/monitor)
- Secret storage for API keys
"""

from .runtime import RuntimeManager, Runtime, RuntimeType, get_runtime_manager
from .runner import PackageRunner, ServerProcess, ProcessState, get_package_runner
from .manager import InstalledServerManager, InstalledServer, get_installed_server_manager
from .secrets import SecretStore, get_secret_store

__all__ = [
    # Runtime
    "RuntimeManager",
    "Runtime",
    "RuntimeType",
    "get_runtime_manager",
    # Runner
    "PackageRunner",
    "ServerProcess",
    "ProcessState",
    "get_package_runner",
    # Manager
    "InstalledServerManager",
    "InstalledServer",
    "get_installed_server_manager",
    # Secrets
    "SecretStore",
    "get_secret_store",
]

