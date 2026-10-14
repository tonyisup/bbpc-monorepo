"""Starts pipeline runs for the Runs tab: checked first, one at a time, logged under output/runs/.

The run is ``pipeline.py`` itself (``lib.pipeline_runs``), started through
``scripts/redacted_run.py`` under the pipeline's venv python, so the log holds
the pipeline's output with every ``.env`` value replaced by its name. This
module never reads ``.env``: the checks run in their own process
(``scripts/check_run.py``) and come back as names and results only.

A run is its own process group, so Stop reaches everything it started
(ffmpeg, the Node importer, a headless Cowork session). A run keeps going if
the dashboard stops; its record then shows it running, or interrupted once it
has ended, because no one was left to note how.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import shlex
import signal
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional

from lib import pipeline_runs
from lib.stage_status import STAGES

ROOT = Path(__file__).resolve().parents[1]
CHECK_TIMEOUT_SECONDS = 120.0
STOP_GRACE_SECONDS = 10.0
Command = Callable[[Path, Dict[str, Any], Path], List[str]]
_STARTING = "starting"
NO_OTHER_RUN = "No other dashboard run is active"


def run_env(python: Path, environ: Mapping[str, str]) -> Dict[str, str]:
    """The environment ``source venv/bin/activate`` gives ``scheduled_pipeline.sh``, unbuffered for a live log."""
    env = dict(environ)
    bin_dir = Path(python).parent
    env["PATH"] = f"{bin_dir}:{env['PATH']}" if env.get("PATH") else str(bin_dir)
    env["VIRTUAL_ENV"] = str(bin_dir.parent)
    env["PYTHONUNBUFFERED"] = "1"
    return env


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


class RunBusy(RuntimeError):
    """A run is already going; ``active`` is its id."""

    def __init__(self, active: str):
        super().__init__(f"a run is already going: {active}")
        self.active = active


class ChecksFailed(ValueError):
    def __init__(self, result: Dict[str, Any]):
        super().__init__("A check failed, so the run was not started.")
        self.result = result


class RunRunner:
    def __init__(self, python: Path, run_command: Optional[Command] = None, check_command: Optional[Command] = None):
        self.python = Path(python)
        self.run_command = run_command or pipeline_runs.run_argv
        self.check_command = check_command or pipeline_runs.check_argv
        self._lock = threading.Lock()
        self._active: Optional[str] = None
        self._process: Optional[subprocess.Popen] = None
        self._stopping = False
        self.last_check: Optional[Dict[str, Any]] = None
        self.last_check_at: Optional[str] = None

    @property
    def active(self) -> Optional[str]:
        """The id of the run this dashboard has going, or None (also while one is being checked)."""
        return None if self._active == _STARTING else self._active

    def python_found(self) -> bool:
        return self.python.is_file()

    # ------------------------------------------------------------------ checks

    def _busy_with(self, config: Dict[str, Any], starting: bool = False) -> Optional[str]:
        """The run in the way: this dashboard's, or one another dashboard has going. ``starting``:
        the caller holds the slot, so it is not in its own way."""
        if self._active is not None and not (starting and self._active == _STARTING):
            return self._active
        other = pipeline_runs.running_elsewhere(config)
        return other["id"] if other else None

    def check(self, config: Dict[str, Any], planned: Dict[str, Any], config_path: Path,
              starting: bool = False) -> Dict[str, Any]:
        """Every check before ``planned`` runs: the pipeline's own (scripts/check_run.py), then this dashboard's."""
        command = self.check_command(self.python, planned, Path(config_path))
        try:
            done = subprocess.run(command, cwd=str(ROOT), env=run_env(self.python, os.environ), capture_output=True,
                                  text=True, timeout=CHECK_TIMEOUT_SECONDS, stdin=subprocess.DEVNULL)
            result = json.loads(done.stdout)
            if not isinstance(result, dict) or not isinstance(result.get("checks"), list):
                raise ValueError("not a list of checks")
        except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
            said = locals().get("done")
            output = " ".join(((said.stdout or "") + (said.stderr or "")).split())[-600:] if said else ""
            # check_run.py scrubs what it prints; a crash before it could is shown only in part.
            result = {"ok": False, "credentials": [], "checks": [{
                "id": "checks", "label": "The checks ran", "ok": False,
                "detail": f"{type(exc).__name__}: {exc}" + (f"; it printed: {output}" if output else "")}]}
        busy = self._busy_with(config, starting)
        if busy == _STARTING:
            busy = "being started"
        result["checks"].append({
            "id": "no_other_run", "label": NO_OTHER_RUN, "ok": busy is None,
            "detail": f"run {busy} is still going" if busy else "none running from a dashboard",
        })
        result["ok"] = all(check.get("ok") for check in result["checks"])
        stages = list(STAGES) if planned["stage"] is None else STAGES[STAGES.index(planned["stage"]):]
        # Every run reaches publish, which writes to Convex; one with import_transcript in range writes there too.
        result.update(command=shlex.join(pipeline_runs.pipeline_argv(self.python, planned, Path(config_path))),
                      stages=stages, writesConvex=True)
        self.last_check, self.last_check_at = result, _now()
        return result

    # ------------------------------------------------------------------ runs

    def start(self, config: Dict[str, Any], planned: Dict[str, Any], config_path: Path) -> Dict[str, Any]:
        """Check, then start ``planned``. RunBusy if a run is going, ChecksFailed if a check fails."""
        with self._lock:
            busy = self._busy_with(config)
            if busy is not None:
                raise RunBusy(busy if busy != _STARTING else "being started")
            self._active = _STARTING
        try:
            result = self.check(config, planned, config_path, starting=True)
            if not result["ok"]:
                raise ChecksFailed(result)
            display = pipeline_runs.pipeline_argv(self.python, planned, Path(config_path))
            run = pipeline_runs.create_run(config, planned, display)
            log = pipeline_runs.log_path(config, run["id"]).open("ab")
        except BaseException:
            self._release()
            raise
        log.write(f"$ {run['command']}\n".encode("utf-8"))
        log.flush()
        try:
            process = subprocess.Popen(
                self.run_command(self.python, planned, Path(config_path)), cwd=str(ROOT),
                env=run_env(self.python, os.environ), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True,  # its own process group, so Stop reaches all it started
            )
        except OSError as exc:
            log.write(f"could not start: {exc}\n".encode("utf-8"))
            self._end(config, run["id"], log, 127)
            return pipeline_runs.load_run(config, run["id"])
        with self._lock:
            self._active, self._process, self._stopping = run["id"], process, False
        started = pipeline_runs.start_run(config, run["id"], process.pid)
        threading.Thread(target=self._wait, args=(config, run["id"], process, log), daemon=True).start()
        return started

    def stop(self, run_id: Any) -> None:
        """End the run in progress: TERM to its process group, then KILL if it is still there."""
        with self._lock:
            process = self._process
            if run_id is None or run_id != self.active or process is None:
                raise ValueError("that run is not running from this dashboard")
            self._stopping = True
        _signal_group(process, signal.SIGTERM)
        timer = threading.Timer(STOP_GRACE_SECONDS, lambda: process.poll() is None and _signal_group(process, signal.SIGKILL))
        timer.daemon = True
        timer.start()

    def _wait(self, config: Dict[str, Any], run_id: str, process: subprocess.Popen, log: Any) -> None:
        returncode = process.wait()
        self._end(config, run_id, log, returncode)

    def _end(self, config: Dict[str, Any], run_id: str, log: Any, returncode: int) -> None:
        try:
            run = pipeline_runs.finish_run(config, run_id, returncode, self._stopping)
            log.write(f"\n{pipeline_runs.OUTCOMES[run['status']]} (exit {returncode})\n".encode("utf-8"))
        finally:
            log.close()
            self._release()

    def _release(self) -> None:
        with self._lock:
            self._active, self._process, self._stopping = None, None, False


def _signal_group(process: subprocess.Popen, sig: int) -> None:
    try:
        os.killpg(process.pid, sig)
    except OSError:
        pass
