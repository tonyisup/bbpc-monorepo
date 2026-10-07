"""Hand-off between the pipeline and Claude Cowork for the judgment stages.

Cowork reads a finished transcript and writes two files the pipeline consumes
in place of its own LLM calls:

    <cowork_dir>/<stem>.movies.json   -> used by the ``movies`` stage
    <cowork_dir>/<stem>.seo.json      -> used by the ``parse`` stage

``settings.cowork_mode`` (or ``--cowork-mode``) controls the behaviour:

    off      never read Cowork files; use the heuristic/LLM stages
    prefer   use Cowork files when present, otherwise fall back (default)
    require  use Cowork files; when missing, stop with AwaitingCowork so the
             run can resume later with ``--from movies``

Progress is tracked in ``<cowork_dir>/state.json`` so unattended runs neither
reprocess finished episodes nor start the expensive stages early. The
pipeline owns that file; Cowork only reads it and writes the two outputs.

This module deliberately uses only the standard library so the validator
(``scripts/validate_cowork_outputs.py``) can run without the pipeline venv.
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

MODES = ("off", "prefer", "require")
DEFAULT_MODE = "prefer"
EXIT_AWAITING_COWORK = 75  # EX_TEMPFAIL: not a failure, try again later

STATUS_AWAITING = "awaiting_cowork"
STATUS_DONE = "done"

CLIP_MIN_SECONDS = 20.0
CLIP_MAX_SECONDS = 90.0
SEO_STRING_KEYS = ("title", "metaDescription", "callToAction")
SEO_LIST_KEYS = ("keywords", "highlights", "clipAnalysis", "candidateClips", "notableWorks")
MOVIE_STATUSES = {"accepted", "maybe", "rejected", "db_assigned"}


class AwaitingCowork(Exception):
    """Raised by a stage in ``require`` mode when Cowork has not written its file yet."""

    def __init__(self, stem: str, stage: str, path: Path):
        self.stem = stem
        self.stage = stage
        self.path = path
        super().__init__(f"Waiting for Cowork to write {path} ({stage} stage, episode {stem}).")


class CoworkOutputInvalid(ValueError):
    """Raised when a Cowork file exists but does not pass validation."""

    def __init__(self, path: Path, problems: List[str]):
        self.path = path
        self.problems = problems
        joined = "\n  - ".join(problems)
        super().__init__(f"Cowork output {path} is invalid:\n  - {joined}")


# --------------------------------------------------------------------------- paths/mode

def cowork_dir(config: Dict[str, Any]) -> Path:
    settings = config.get("settings", {}) if isinstance(config, dict) else {}
    configured = settings.get("cowork_outputs_dir") if isinstance(settings, dict) else None
    if configured:
        return Path(str(configured)).expanduser().resolve()
    output_dir = config.get("paths", {}).get("output_dir", "./output") if isinstance(config, dict) else "./output"
    return (Path(output_dir).expanduser() / "cowork").resolve()


def movies_path(config: Dict[str, Any], stem: str) -> Path:
    return cowork_dir(config) / f"{stem}.movies.json"


def seo_path(config: Dict[str, Any], stem: str) -> Path:
    return cowork_dir(config) / f"{stem}.seo.json"


def resolve_mode(config: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> str:
    override = (context or {}).get("cowork_mode")
    settings = config.get("settings", {}) if isinstance(config, dict) else {}
    raw = override or (settings.get("cowork_mode") if isinstance(settings, dict) else None) or DEFAULT_MODE
    mode = str(raw).strip().lower()
    if mode not in MODES:
        raise ValueError(f"cowork_mode must be one of {MODES}, got {raw!r}")
    return mode


def outputs_ready(config: Dict[str, Any], stem: str) -> bool:
    return movies_path(config, stem).is_file() and seo_path(config, stem).is_file()


# --------------------------------------------------------------------------- loading

def _read_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        raise CoworkOutputInvalid(path, [f"not valid JSON: {exc}"]) from None


def load_movies(config: Dict[str, Any], stem: str) -> Optional[Dict[str, Any]]:
    """Return the validated Cowork movie payload, or None when it does not exist."""
    path = movies_path(config, stem)
    if not path.is_file():
        return None
    payload = _read_json(path)
    problems = validate_movies(payload)
    if problems:
        raise CoworkOutputInvalid(path, problems)
    return payload


def load_seo(
    config: Dict[str, Any],
    stem: str,
    transcript_duration: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Return the validated Cowork SEO payload, or None when it does not exist."""
    path = seo_path(config, stem)
    if not path.is_file():
        return None
    payload = _read_json(path)
    problems = validate_seo(payload, transcript_duration)
    if problems:
        raise CoworkOutputInvalid(path, problems)
    return payload


# --------------------------------------------------------------------------- validation

def _finite(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _check_window(label: str, row: Any, duration: Optional[float], problems: List[str]) -> None:
    if not isinstance(row, dict):
        problems.append(f"{label} is not an object")
        return
    start, end = _finite(row.get("start")), _finite(row.get("end"))
    if start is None or end is None:
        problems.append(f"{label} needs numeric start/end seconds")
        return
    if end <= start or start < 0:
        problems.append(f"{label} has an invalid window {start}-{end}")
    if duration is not None and end > duration + 1.0:
        problems.append(f"{label} ends at {end:.1f}s, past the transcript end ({duration:.1f}s)")


def validate_movies(payload: Any) -> List[str]:
    problems: List[str] = []
    if not isinstance(payload, dict):
        return ["top level must be an object"]
    movies = payload.get("movies")
    if not isinstance(movies, list):
        return ["'movies' must be a list"]
    if not isinstance(payload.get("candidates", []), list):
        problems.append("'candidates' must be a list")
    for i, movie in enumerate(movies):
        label = f"movies[{i}]"
        if not isinstance(movie, dict):
            problems.append(f"{label} is not an object")
            continue
        if not str(movie.get("title") or "").strip():
            problems.append(f"{label} needs a title")
        year = movie.get("year")
        if year is not None and not (isinstance(year, int) and 1880 <= year <= 2100):
            problems.append(f"{label} has an implausible year {year!r}")
        if movie.get("status", "accepted") not in MOVIE_STATUSES:
            problems.append(f"{label} has unknown status {movie.get('status')!r}")
        for j, ev in enumerate(movie.get("evidence") or []):
            _check_window(f"{label}.evidence[{j}]", ev, None, problems)
    return problems


def validate_seo(payload: Any, transcript_duration: Optional[float] = None) -> List[str]:
    problems: List[str] = []
    if not isinstance(payload, dict):
        return ["top level must be an object"]
    for key in SEO_STRING_KEYS:
        if not (isinstance(payload.get(key), str) and payload[key].strip()):
            problems.append(f"'{key}' must be a non-empty string")
    for key in SEO_LIST_KEYS:
        if not (isinstance(payload.get(key), list) and payload[key]):
            problems.append(f"'{key}' must be a non-empty list")
    for key in ("candidateClips", "clipAnalysis"):
        for i, clip in enumerate(payload.get(key) or []):
            label = f"{key}[{i}]"
            _check_window(label, clip, transcript_duration, problems)
            if isinstance(clip, dict):
                if not str(clip.get("headline") or "").strip():
                    problems.append(f"{label} needs a headline")
                if not str(clip.get("imagePrompt") or "").strip():
                    problems.append(f"{label} needs an imagePrompt")
    for i, row in enumerate(payload.get("highlights") or []):
        if not isinstance(row, dict) or not all(isinstance(row.get(k), str) for k in ("start", "end")):
            problems.append(f"highlights[{i}] needs HH:MM:SS string start/end")
    return problems


def clip_duration_warnings(payload: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    for key in ("candidateClips", "clipAnalysis"):
        for i, clip in enumerate(payload.get(key) or []):
            start, end = _finite(clip.get("start")), _finite(clip.get("end"))
            if start is None or end is None:
                continue
            length = end - start
            if length < CLIP_MIN_SECONDS or length > CLIP_MAX_SECONDS:
                warnings.append(f"{key}[{i}] is {length:.0f}s (expected {CLIP_MIN_SECONDS:.0f}-{CLIP_MAX_SECONDS:.0f}s)")
    return warnings


# --------------------------------------------------------------------------- state

def state_path(config: Dict[str, Any]) -> Path:
    return cowork_dir(config) / "state.json"


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def _seed_state(config: Dict[str, Any]) -> Dict[str, Any]:
    """First run: treat episodes that already have SEO output as done."""
    output_dir = Path(config.get("paths", {}).get("output_dir", "./output")).expanduser()
    seo_dir = Path(config.get("paths", {}).get("seo_dir", output_dir / "seo")).expanduser()
    episodes: Dict[str, Any] = {}
    for path in sorted(seo_dir.glob("*.seo.json")):
        stem = path.name[: -len(".seo.json")]
        if "." in stem:  # e.g. 20260713.seo.pre-budget-fix.json
            continue
        episodes[stem] = {"status": STATUS_DONE, "updatedAt": _now(), "note": "seeded from existing output"}
    return {"version": 1, "episodes": episodes}


def load_state(config: Dict[str, Any]) -> Dict[str, Any]:
    path = state_path(config)
    if not path.is_file():
        return _seed_state(config)
    with path.open(encoding="utf-8") as f:
        state = json.load(f)
    state.setdefault("version", 1)
    state.setdefault("episodes", {})
    return state


def save_state(config: Dict[str, Any], state: Dict[str, Any]) -> None:
    path = state_path(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".state.", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def episode_status(config: Dict[str, Any], stem: str) -> Optional[str]:
    return load_state(config)["episodes"].get(stem, {}).get("status")


def mark_episode(config: Dict[str, Any], stem: str, status: str, **fields: Any) -> None:
    state = load_state(config)
    entry = dict(state["episodes"].get(stem, {}))
    entry.update({k: v for k, v in fields.items() if v is not None})
    if status != STATUS_AWAITING:
        entry.pop("lastError", None)
    entry["status"] = status
    entry["updatedAt"] = _now()
    state["episodes"][stem] = entry
    save_state(config, state)


def awaiting(config: Dict[str, Any]) -> List[str]:
    return sorted(
        stem for stem, entry in load_state(config)["episodes"].items()
        if entry.get("status") == STATUS_AWAITING
    )
