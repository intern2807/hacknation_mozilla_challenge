"""
Package runner - executes MCP servers from npm, pypi, or docker.

Handles:
- Building the correct command for each package type
- Spawning stdio processes
- Capturing logs and monitoring health
"""

import asyncio
import logging
import os
import signal
import subprocess
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional, Callable

from .runtime import RuntimeManager, RuntimeType, get_runtime_manager

logger = logging.getLogger(__name__)


class ProcessState(str, Enum):
    """State of a running server process."""
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    CRASHED = "crashed"
    ERROR = "error"


@dataclass
class ServerProcess:
    """A running MCP server process."""
    server_id: str
    package_type: str  # npm, pypi, oci
    package_id: str    # e.g., "@modelcontextprotocol/server-github"
    
    state: ProcessState = ProcessState.STOPPED
    pid: Optional[int] = None
    started_at: Optional[float] = None
    stopped_at: Optional[float] = None
    exit_code: Optional[int] = None
    error_message: Optional[str] = None
    
    # Process handle (not serialized)
    _process: Optional[asyncio.subprocess.Process] = field(default=None, repr=False)
    _log_buffer: list[str] = field(default_factory=list, repr=False)
    
    def to_dict(self) -> dict:
        return {
            "serverId": self.server_id,
            "packageType": self.package_type,
            "packageId": self.package_id,
            "state": self.state.value,
            "pid": self.pid,
            "startedAt": int(self.started_at * 1000) if self.started_at else None,
            "stoppedAt": int(self.stopped_at * 1000) if self.stopped_at else None,
            "exitCode": self.exit_code,
            "errorMessage": self.error_message,
            "recentLogs": self._log_buffer[-50:],  # Last 50 lines
        }
    
    def add_log(self, line: str):
        """Add a log line to the buffer."""
        self._log_buffer.append(line)
        if len(self._log_buffer) > 1000:
            self._log_buffer = self._log_buffer[-500:]


class PackageRunner:
    """
    Runs MCP server packages as stdio subprocesses.
    """
    
    def __init__(self):
        self._runtime_manager = get_runtime_manager()
        self._processes: dict[str, ServerProcess] = {}
    
    async def start_server(
        self,
        server_id: str,
        package_type: str,
        package_id: str,
        env_vars: Optional[dict[str, str]] = None,
        args: Optional[list[str]] = None,
        on_output: Optional[Callable[[str, str], None]] = None,
    ) -> ServerProcess:
        """
        Start an MCP server.
        
        Args:
            server_id: Unique ID for this server instance
            package_type: 'npm', 'pypi', or 'oci'
            package_id: Package identifier (e.g., '@anthropic/mcp-server-github')
            env_vars: Environment variables to set
            args: Additional command-line arguments
            on_output: Callback for stdout/stderr output
        
        Returns:
            ServerProcess with state and process info
        """
        # Check if already running
        if server_id in self._processes:
            existing = self._processes[server_id]
            if existing.state == ProcessState.RUNNING:
                return existing
        
        # Create process record
        proc = ServerProcess(
            server_id=server_id,
            package_type=package_type,
            package_id=package_id,
            state=ProcessState.STARTING,
        )
        self._processes[server_id] = proc
        
        try:
            # Build command
            cmd = await self._build_command(package_type, package_id, args)
            if not cmd:
                proc.state = ProcessState.ERROR
                proc.error_message = f"Cannot run {package_type} packages - runtime not available"
                return proc
            
            # Prepare environment
            env = os.environ.copy()
            if env_vars:
                env.update(env_vars)
            
            logger.info(f"[{server_id}] Starting: {' '.join(cmd)}")
            proc.add_log(f"$ {' '.join(cmd)}")
            
            # Start process
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            
            proc._process = process
            proc.pid = process.pid
            proc.started_at = time.time()
            proc.state = ProcessState.RUNNING
            
            # Start log readers
            asyncio.create_task(self._read_output(proc, process.stdout, "stdout", on_output))
            asyncio.create_task(self._read_output(proc, process.stderr, "stderr", on_output))
            
            # Start process monitor
            asyncio.create_task(self._monitor_process(proc, process))
            
            logger.info(f"[{server_id}] Started with PID {process.pid}")
            return proc
            
        except Exception as e:
            logger.exception(f"[{server_id}] Failed to start")
            proc.state = ProcessState.ERROR
            proc.error_message = str(e)
            return proc
    
    async def stop_server(self, server_id: str, timeout: float = 5.0) -> bool:
        """
        Stop a running server.
        
        Returns True if stopped successfully.
        """
        proc = self._processes.get(server_id)
        if not proc or not proc._process:
            return False
        
        if proc.state not in (ProcessState.RUNNING, ProcessState.STARTING):
            return True  # Already stopped
        
        proc.state = ProcessState.STOPPING
        process = proc._process
        
        try:
            # Try graceful shutdown first
            process.terminate()
            
            try:
                await asyncio.wait_for(process.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                # Force kill
                logger.warning(f"[{server_id}] Force killing after timeout")
                process.kill()
                await process.wait()
            
            proc.state = ProcessState.STOPPED
            proc.stopped_at = time.time()
            proc.exit_code = process.returncode
            
            logger.info(f"[{server_id}] Stopped with exit code {proc.exit_code}")
            return True
            
        except Exception as e:
            logger.exception(f"[{server_id}] Error stopping")
            proc.error_message = str(e)
            return False
    
    async def restart_server(
        self,
        server_id: str,
        env_vars: Optional[dict[str, str]] = None,
    ) -> ServerProcess:
        """Stop and restart a server."""
        proc = self._processes.get(server_id)
        if not proc:
            raise ValueError(f"Unknown server: {server_id}")
        
        await self.stop_server(server_id)
        
        return await self.start_server(
            server_id=server_id,
            package_type=proc.package_type,
            package_id=proc.package_id,
            env_vars=env_vars,
        )
    
    def get_process(self, server_id: str) -> Optional[ServerProcess]:
        """Get a server process by ID."""
        return self._processes.get(server_id)
    
    def get_all_processes(self) -> list[ServerProcess]:
        """Get all tracked processes."""
        return list(self._processes.values())
    
    def get_running_processes(self) -> list[ServerProcess]:
        """Get all currently running processes."""
        return [p for p in self._processes.values() if p.state == ProcessState.RUNNING]
    
    async def stop_all(self):
        """Stop all running servers."""
        running = self.get_running_processes()
        await asyncio.gather(*[
            self.stop_server(p.server_id)
            for p in running
        ])
    
    async def _build_command(
        self,
        package_type: str,
        package_id: str,
        args: Optional[list[str]] = None,
    ) -> Optional[list[str]]:
        """Build the command to run a package."""
        
        # Ensure runtimes are detected
        await self._runtime_manager.detect_all()
        
        if package_type == "npm":
            runtime = self._runtime_manager.get_runtime(RuntimeType.NODE)
            if not runtime or not runtime.available:
                return None
            
            cmd = ["npx", "-y", package_id]
            if args:
                cmd.extend(args)
            return cmd
        
        elif package_type == "pypi":
            runtime = self._runtime_manager.get_runtime(RuntimeType.PYTHON)
            if not runtime or not runtime.available:
                return None
            
            # Prefer uvx if available
            if runtime.runner_cmd == "uvx":
                cmd = ["uvx", package_id]
            else:
                # Fallback to pip install + run
                cmd = ["python3", "-m", package_id.replace("-", "_")]
            
            if args:
                cmd.extend(args)
            return cmd
        
        elif package_type == "oci":
            runtime = self._runtime_manager.get_runtime(RuntimeType.DOCKER)
            if not runtime or not runtime.available:
                return None
            
            cmd = [
                "docker", "run", "-i", "--rm",
                package_id,
            ]
            if args:
                cmd.extend(args)
            return cmd
        
        return None
    
    async def _read_output(
        self,
        proc: ServerProcess,
        stream: asyncio.StreamReader,
        stream_name: str,
        callback: Optional[Callable[[str, str], None]],
    ):
        """Read output from a process stream."""
        try:
            while True:
                line = await stream.readline()
                if not line:
                    break
                
                text = line.decode("utf-8", errors="replace").rstrip()
                proc.add_log(f"[{stream_name}] {text}")
                
                if callback:
                    try:
                        callback(stream_name, text)
                    except Exception:
                        pass
        except Exception as e:
            logger.debug(f"[{proc.server_id}] Stream read error: {e}")
    
    async def _monitor_process(
        self,
        proc: ServerProcess,
        process: asyncio.subprocess.Process,
    ):
        """Monitor a process and update state when it exits."""
        try:
            await process.wait()
            
            proc.exit_code = process.returncode
            proc.stopped_at = time.time()
            
            if proc.state == ProcessState.STOPPING:
                proc.state = ProcessState.STOPPED
            elif proc.exit_code != 0:
                proc.state = ProcessState.CRASHED
                proc.error_message = f"Process exited with code {proc.exit_code}"
            else:
                proc.state = ProcessState.STOPPED
            
            logger.info(f"[{proc.server_id}] Exited with code {proc.exit_code}")
            
        except Exception as e:
            logger.exception(f"[{proc.server_id}] Monitor error")
            proc.state = ProcessState.ERROR
            proc.error_message = str(e)


# Singleton
_runner: Optional[PackageRunner] = None


def get_package_runner() -> PackageRunner:
    """Get the singleton PackageRunner."""
    global _runner
    if _runner is None:
        _runner = PackageRunner()
    return _runner

