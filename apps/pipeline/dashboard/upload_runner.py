"""Starts the Lab's YouTube uploads: ``scripts/youtube_upload.py``, one at a time.

The same script Tony can run by hand. It runs under the pipeline's venv
python because it loads ``.env`` for the YouTube credentials; the dashboard
itself never reads them. What it printed goes to ``youtube.log`` in the run's
folder, and how it went to ``youtube.json`` there.
"""
from __future__ import annotations

import os
import shlex
import signal
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from lib import lab, youtube_upload

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TIMEOUT_SECONDS = 1800.0
LOG_FILE = "youtube.log"
Command = Callable[[Dict[str, Any], str, Path, Path], List[str]]
_STARTING = "starting"


class UploadBusy(RuntimeError):
    """An upload is already going; ``active`` is its run id."""

    def __init__(self, active: str):
        super().__init__(f"an upload is already going: {active}")
        self.active = active


def upload_command(config: Dict[str, Any], run_id: str, config_path: Path, python: Path) -> List[str]:
    return [str(python), str(ROOT / "scripts" / "youtube_upload.py"), run_id, "--config", str(config_path)]


class UploadRunner:
    def __init__(self, python: Path, command: Optional[Command] = None, timeout: float = DEFAULT_TIMEOUT_SECONDS):
        self.python = Path(python)
        self.command = command or upload_command
        self.custom_command = command is not None
        self.timeout = timeout
        self._lock = threading.Lock()
        self._active: Optional[str] = None

    @property
    def active(self) -> Optional[str]:
        """The run whose upload is in progress, or None (also while one is still being asked for)."""
        return None if self._active == _STARTING else self._active

    def can_start(self) -> bool:
        return self.custom_command or self.python.is_file()

    def reserve(self) -> None:
        """Claim the one slot before the upload is written down, so two requests cannot both start one."""
        with self._lock:
            if self._active is not None:
                raise UploadBusy(self._active)
            self._active = _STARTING

    def release(self) -> None:
        with self._lock:
            self._active = None

    def start(self, config: Dict[str, Any], run_id: str, config_path: Path) -> None:
        """Start the reserved slot's upload, which ``youtube_upload.prepare`` has left ``ready``."""
        try:
            command = self.command(config, run_id, Path(config_path), self.python)
            log = (lab.lab_dir(config) / run_id / LOG_FILE).open("ab")
            log.write(f"$ {shlex.join(command)}\n".encode("utf-8"))
            log.flush()
        except BaseException:
            self.release()
            raise
        with self._lock:
            self._active = run_id
        try:
            process = subprocess.Popen(
                command, cwd=str(ROOT), env=dict(os.environ),
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
            )
        except OSError as exc:
            log.write(f"could not start: {exc}\n".encode("utf-8"))
            log.close()
            youtube_upload.finish(config, run_id, 127)
            self.release()
            return
        threading.Thread(target=self._wait, args=(config, run_id, process, log), daemon=True).start()

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
                youtube_upload.finish(config, run_id, process.returncode, timed_out)
            finally:
                self.release()
