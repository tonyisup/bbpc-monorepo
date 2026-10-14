"""Pipeline runs started from the dashboard: what may be started, and a record of each.

Standard library only: the dashboard imports this without the pipeline venv.

Three kinds of run, each ``pipeline.py`` itself:

- ``unattended``: no episode, as ``scheduled_pipeline.sh`` runs it. The
  pipeline finds the newest episode in Azure, skips it if finished and resumes
  it if Cowork has written its files.
- ``from``: one local episode from a stage onwards.
- ``resume``: an episode handed to Cowork, from ``movies`` onwards.

Each run is recorded in ``output/runs/<id>.json`` with its log beside it,
``<id>.log``. The log is written by ``scripts/redacted_run.py``, which replaces
every ``.env`` value in the pipeline's output with its name.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import shlex
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from lib import cowork_handoff
from lib.stage_status import STAGES, artifacts

MODES = ("unattended", "from", "resume")
RESUME_STAGE = "movies"
# How a run ended. Exit 75 is the pipeline handing an episode to Cowork, never a failure.
OUTCOMES = {"done": "finished", "cowork": "handed to Cowork", "failed": "failed", "stopped": "stopped",
            "interrupted": "interrupted", "running": "running", "starting": "starting"}
_RUN_ID = re.compile(r"\d{8}-\d{6}(?:-\d{1,3})?")
_STEM = re.compile(r"\d{8}")


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def runs_dir(config: Dict[str, Any]) -> Path:
    return Path(config.get("paths", {}).get("output_dir", "./output")) / "runs"


def _audio(config: Dict[str, Any], stem: Any) -> Path:
    if not isinstance(stem, str) or not _STEM.fullmatch(stem):
        raise ValueError(f"episode must be a date like 20261005, not {stem!r}")
    audio = artifacts(config, stem)["audio"]
    if not audio.is_file():
        raise ValueError(f"no mp3 for {stem} in {audio.parent}")
    return audio.resolve()


def plan(config: Dict[str, Any], mode: Any, stem: Any = None, stage: Any = None) -> Dict[str, Any]:
    """What a run of ``mode`` would do, or ValueError saying why it may not start."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {', '.join(MODES)}, not {mode!r}")
    if mode == "unattended":
        if stem is not None or stage is not None:
            raise ValueError("an unattended run picks its own episode and starts where that episode left off")
        return {"mode": mode, "stem": None, "stage": None, "args": []}
    if mode == "resume":
        if stage not in (None, RESUME_STAGE):
            raise ValueError(f"resume always starts from {RESUME_STAGE}; use a run from a stage for another")
        audio = _audio(config, stem)
        if cowork_handoff.episode_status(config, stem) != cowork_handoff.STATUS_AWAITING:
            raise ValueError(f"{stem} is not waiting for Cowork")
        from lib import cowork_headless  # standard library too; only needed here
        if not cowork_handoff.outputs_ready(config, stem) and not cowork_headless.enabled(config):
            raise ValueError(f"Cowork has not written {stem}'s movies and SEO files yet")
        stage = RESUME_STAGE
    else:
        audio = _audio(config, stem)
        if stage not in STAGES:
            raise ValueError(f"stage must be one of {', '.join(STAGES)}, not {stage!r}")
    return {"mode": mode, "stem": stem, "stage": stage, "args": [str(audio), "--from", stage]}


def pipeline_argv(python: Path, planned: Dict[str, Any], config_path: Path) -> List[str]:
    """The pipeline command itself, as it would be typed in a terminal (from apps/pipeline)."""
    return [str(python), "pipeline.py", *planned["args"], "--config", str(config_path)]


def run_argv(python: Path, planned: Dict[str, Any], config_path: Path) -> List[str]:
    """What the dashboard starts: the pipeline, through the wrapper that keeps ``.env`` values out of its log."""
    return [str(python), "scripts/redacted_run.py", "--", *pipeline_argv(python, planned, config_path)]


def check_argv(python: Path, planned: Dict[str, Any], config_path: Path) -> List[str]:
    """The checks for this run, as JSON."""
    stage = ["--from", planned["stage"]] if planned["stage"] else []
    return [str(python), "scripts/check_run.py", "--config", str(config_path), "--json", *stage]


def outcome(returncode: Optional[int], stopped: bool = False) -> str:
    if returncode == 0:
        return "done"
    if returncode == cowork_handoff.EXIT_AWAITING_COWORK:
        return "cowork"
    return "stopped" if stopped else "failed"


# --------------------------------------------------------------------------- records

def _record_path(config: Dict[str, Any], run_id: Any) -> Optional[Path]:
    if not isinstance(run_id, str) or not _RUN_ID.fullmatch(run_id):
        return None
    return runs_dir(config) / f"{run_id}.json"


def _write(config: Dict[str, Any], run: Dict[str, Any]) -> Dict[str, Any]:
    folder = runs_dir(config)
    folder.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(folder), prefix=f".{run['id']}.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(run, f, indent=2)
        f.write("\n")
    os.replace(tmp, folder / f"{run['id']}.json")
    return run


def create_run(config: Dict[str, Any], planned: Dict[str, Any], command: List[str]) -> Dict[str, Any]:
    """Record a run about to start. ``command`` is shown on the page and at the top of the log."""
    folder = runs_dir(config)
    folder.mkdir(parents=True, exist_ok=True)
    base = _dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    for n in range(1000):
        run_id = base if n == 0 else f"{base}-{n}"
        try:  # claimed by creating its log, so two runs never share one
            (folder / f"{run_id}.log").open("xb").close()
            break
        except FileExistsError:
            continue
    else:
        raise RuntimeError("could not name the run")
    run = {"id": run_id, "mode": planned["mode"], "stem": planned["stem"], "stage": planned["stage"],
           "command": shlex.join(command), "status": "starting", "createdAt": _now(), "pid": None,
           "startedAt": None, "finishedAt": None, "returncode": None}
    return _write(config, run)


def load_run(config: Dict[str, Any], run_id: Any) -> Optional[Dict[str, Any]]:
    path = _record_path(config, run_id)
    try:
        run = json.loads(path.read_text(encoding="utf-8")) if path is not None else None
    except (OSError, ValueError):
        return None
    return run if isinstance(run, dict) and run.get("id") == run_id else None


def _update(config: Dict[str, Any], run_id: str, **fields: Any) -> Dict[str, Any]:
    run = load_run(config, run_id)
    if run is None:
        raise ValueError(f"there is no run called {run_id}")
    run.update(fields)
    return _write(config, run)


def start_run(config: Dict[str, Any], run_id: str, pid: int) -> Dict[str, Any]:
    return _update(config, run_id, status="running", pid=pid, startedAt=_now())


def finish_run(config: Dict[str, Any], run_id: str, returncode: Optional[int], stopped: bool = False) -> Dict[str, Any]:
    return _update(config, run_id, status=outcome(returncode, stopped), returncode=returncode, finishedAt=_now())


def _alive(pid: Any) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def list_runs(config: Dict[str, Any], active: Optional[str] = None) -> List[Dict[str, Any]]:
    """Every run, newest first. One left running whose process is gone was interrupted
    (the dashboard that started it stopped); one whose process is alive and is not
    ``active`` belongs to another dashboard and is still running."""
    folder = runs_dir(config)
    runs = []
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        run = load_run(config, path.stem)
        if run is None:
            continue
        if run.get("status") in ("starting", "running") and run["id"] != active and not _alive(run.get("pid")):
            run["status"] = "interrupted"
        runs.append(run)
    return sorted(runs, key=lambda run: (str(run.get("createdAt")), run["id"]), reverse=True)


def running_elsewhere(config: Dict[str, Any], active: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """A run another dashboard started and is still running, or None. A run started in a terminal is not seen."""
    return next((run for run in list_runs(config, active) if run["status"] == "running" and run["id"] != active),
                None)


def log_path(config: Dict[str, Any], run_id: Any) -> Optional[Path]:
    path = _record_path(config, run_id)
    return path.with_suffix(".log") if path is not None and load_run(config, run_id) is not None else None


def read_log(config: Dict[str, Any], run_id: Any, offset: int = 0, max_bytes: int = 65536) -> Optional[Dict[str, Any]]:
    """The log from byte ``offset`` (up to ``max_bytes``), and where to read from next.

    An ``offset`` of -1 means "the end of it": the last ``max_bytes``, from a whole line.
    """
    path = log_path(config, run_id)
    if path is None or not path.is_file():
        return None
    size = path.stat().st_size
    with path.open("rb") as f:
        if offset < 0:
            start = max(size - max_bytes, 0)
            f.seek(start)
            data = f.read(size - start)
            if start and b"\n" in data[:-1]:
                data = data[data.index(b"\n") + 1:]
            offset = size
            return {"text": data.decode("utf-8", errors="replace"), "offset": offset, "size": size}
        f.seek(min(offset, size))
        data = f.read(max_bytes)
    end = min(offset, size) + len(data)
    # Never split a character: hold back a partial one for the next read.
    while data and end < size and (data[-1] & 0xC0) == 0x80:
        data, end = data[:-1], end - 1
    if data and end < size and data[-1] >= 0xC0:
        data, end = data[:-1], end - 1
    return {"text": data.decode("utf-8", errors="replace"), "offset": end, "size": size}
