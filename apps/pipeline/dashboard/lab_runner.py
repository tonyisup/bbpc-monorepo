"""Starts the Lab's test renders: one child process at a time, logged to the run's folder.

The process is the pipeline's own clip stage (``lib.lab.run_command``), so a
Lab render and a real render are the same code. What it may write is settled
by the run config it is handed, which points every output path at the run
folder.
"""
from __future__ import annotations

import os
import shlex
import signal
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from lib import lab

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TIMEOUT_SECONDS = 900.0
Command = Callable[[Dict[str, Any], Dict[str, Any], Path], List[str]]
_STARTING = "starting"


class LabBusy(RuntimeError):
    """A render is already running; ``active`` is its run id."""

    def __init__(self, active: str):
        super().__init__(f"a render is already running: {active}")
        self.active = active


class LabRunner:
    def __init__(self, python: Path, command: Optional[Command] = None, timeout: float = DEFAULT_TIMEOUT_SECONDS):
        self.python = Path(python)
        self.command = command or lab.run_command
        self.custom_command = command is not None
        self.timeout = timeout
        self._lock = threading.Lock()
        self._active: Optional[str] = None

    @property
    def active(self) -> Optional[str]:
        """The id of the run in progress, or None (also while one is still being set up)."""
        return None if self._active == _STARTING else self._active

    def python_found(self) -> bool:
        return self.python.is_file()

    def reserve(self) -> None:
        """Claim the one slot before a run folder is built, so two requests cannot both build one."""
        with self._lock:
            if self._active is not None:
                raise LabBusy(self._active)
            self._active = _STARTING

    def release(self) -> None:
        with self._lock:
            self._active = None

    def start(self, config: Dict[str, Any], run: Dict[str, Any]) -> Dict[str, Any]:
        """Start the reserved slot's render and return the run, now ``running``."""
        try:
            command = self.command(config, run, self.python)
            log = (lab.lab_dir(config) / run["id"] / "run.log").open("ab")
            log.write(f"$ {shlex.join(command)}\n".encode("utf-8"))
            log.flush()
            # Marked running before the process exists, so a fast finish is never overwritten.
            started = lab.start_run(config, run["id"])
        except BaseException:
            self.release()
            raise
        try:
            process = subprocess.Popen(
                command, cwd=str(ROOT), env=lab.run_env(run, os.environ),
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True,  # its own process group, so a stop reaches ffmpeg too
            )
        except OSError as exc:
            log.write(f"could not start: {exc}\n".encode("utf-8"))
            log.close()
            self.release()
            return lab.finish_run(config, run["id"], 127)
        with self._lock:
            self._active = run["id"]
        threading.Thread(target=self._wait, args=(config, run["id"], process, log), daemon=True).start()
        return started

    def _wait(self, config: Dict[str, Any], run_id: str, process: subprocess.Popen, log: Any) -> None:
        timed_out = False
        try:
            process.wait(timeout=self.timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                process.kill()
            process.wait()
        finally:
            log.close()
            try:
                lab.finish_run(config, run_id, process.returncode, timed_out)
            finally:
                self.release()
