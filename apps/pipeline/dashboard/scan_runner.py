"""Runs the Shirts tab's Rescan: ``scripts/scan_phrases.py``, one at a time.

The same script Tony runs by hand, so the button and the command line write
the same report. It needs only the standard library, so it runs under the
python the dashboard itself is running on. What it printed is kept in memory
until the next rescan or until the server stops.
"""
from __future__ import annotations

import datetime as _dt
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TIMEOUT_SECONDS = 300.0  # a scan of the whole archive takes about 20 s
Command = Callable[[Path], List[str]]
_IDLE = {"running": False, "startedAt": None, "finishedAt": None, "returncode": None, "timedOut": False, "output": ""}


class ScanBusy(RuntimeError):
    """A rescan is already running."""


def scan_command(config_path: Path) -> List[str]:
    return [sys.executable, str(ROOT / "scripts" / "scan_phrases.py"), "--config", str(config_path)]


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


class ScanRunner:
    def __init__(self, command: Optional[Command] = None, timeout: float = DEFAULT_TIMEOUT_SECONDS):
        self.command = command or scan_command
        self.timeout = timeout
        self._lock = threading.Lock()
        self._state: Dict[str, Any] = dict(_IDLE)

    def state(self) -> Dict[str, Any]:
        """The rescan in progress, or the last one finished since the server started."""
        with self._lock:
            return dict(self._state)

    def start(self, config_path: Path) -> Dict[str, Any]:
        with self._lock:
            if self._state["running"]:
                raise ScanBusy("a rescan is already running")
            self._state = {**_IDLE, "running": True, "startedAt": _now()}
            started = dict(self._state)
        try:
            process = subprocess.Popen(
                self.command(Path(config_path)), cwd=str(ROOT), env=dict(os.environ),
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except OSError as exc:
            self._finish(127, False, f"could not start: {exc}\n")
            return self.state()
        threading.Thread(target=self._wait, args=(process,), daemon=True).start()
        return started

    def _wait(self, process: subprocess.Popen) -> None:
        timed_out = False
        try:
            output, _ = process.communicate(timeout=self.timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                process.kill()
            output, _ = process.communicate()
        self._finish(process.returncode, timed_out, (output or b"").decode("utf-8", "replace"))

    def _finish(self, returncode: int, timed_out: bool, output: str) -> None:
        with self._lock:
            self._state = {**self._state, "running": False, "finishedAt": _now(), "returncode": returncode,
                           "timedOut": timed_out, "output": output}
