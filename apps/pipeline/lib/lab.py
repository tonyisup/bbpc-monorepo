"""The Lab: settings drafts and one-clip test renders, kept apart from real output.

A *draft* is a JSON file of setting overrides in ``<output_dir>/lab/drafts/``.
Real runs keep using ``config.json`` until a draft is applied to it.

A *run* renders one clip with a draft. It is a folder ``<output_dir>/lab/<run id>/``
holding a run config (``config.json`` plus the draft, with ``paths.output_dir``
pointed at the folder), a one-clip SEO file, and a copy of the clip's real
still or of a background an earlier run made for the clip.
``pipeline.py <episode> --config <run config> --only clip`` then writes only
inside that folder, and the episode's real clip, SEO file and ``state.json``
are never touched.

Nothing here writes outside ``<output_dir>/lab/`` except ``apply_draft``, which
rewrites ``config.json``. Standard library only.
"""
from __future__ import annotations

import copy
import datetime as _dt
import difflib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from lib import clip_files, publish_log, settings_schema, stage_status

LAB_STAGES = ("clip",)                             # the stages a Lab run may run
NEVER_IN_LAB = ("import_transcript", "publish")    # they write to Convex
PAID_PROVIDERS = ("openrouter", "openai")
MAX_CLIP_SECONDS = 180.0                           # bounds how long a test render takes
MAX_PROMPT_CHARS = 2000
# Blanked in a free run's environment, so the clip stage could not pay for an image even by mistake.
IMAGE_KEY_NAMES = ("OPENROUTER_API_KEY", "OPENAI_API_KEY")
_DRAFT_NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")
_RUN_ID = re.compile(r"\d{8}-\d{6}-\d{8}-(?:pick|candidate)-\d{1,2}(?:-\d{1,3})?")
_STEM = re.compile(r"\d{8}")
_EDITABLE = ("start", "end", "imagePrompt")


class LabError(ValueError):
    """A request the Lab refuses. ``problems`` lists each reason; ``code`` names the kind."""

    def __init__(self, message: str, problems: Optional[List[str]] = None, code: str = "invalid"):
        super().__init__(message)
        self.problems = problems or [message]
        self.code = code


def lab_dir(config: Dict[str, Any]) -> Path:
    return Path(config.get("paths", {}).get("output_dir", "./output")) / "lab"


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc)


def _write_json(path: Path, payload: Any) -> None:
    _write_text(path, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def _write_text(path: Path, text: str) -> None:
    """Write through a temporary file in the same folder, so a reader never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _settings(raw_config: Mapping[str, Any]) -> Dict[str, Any]:
    settings = raw_config.get("settings") if isinstance(raw_config, Mapping) else None
    return dict(settings) if isinstance(settings, dict) else {}


# --------------------------------------------------------------------------- drafts

def check_overrides(overrides: Any) -> List[str]:
    """Why these overrides cannot be a draft (empty when they can).

    A draft may change only settings the schema marks ``draft``: ones the Lab's
    clip run reads, and never one that names a program to run.
    """
    if not isinstance(overrides, dict):
        return ["overrides must be an object of setting: value"]
    problems: List[str] = []
    for key in sorted(overrides):
        setting = settings_schema.BY_KEY.get(key)
        if setting is None:
            problems.append(f"{key} is not a known setting")
        elif not setting.draft:
            problems.append(f"{key} cannot be changed in a draft")
        else:
            problems.extend(settings_schema.problems(key, overrides[key]))
    return problems


def changes(settings: Mapping[str, Any], overrides: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Each override that differs from what ``config.json`` gives now, as ``key``, ``from`` and ``to``."""
    rows = []
    for key in sorted(overrides):
        current = settings_schema.value(settings, key) if key in settings_schema.BY_KEY else None
        if current != overrides[key]:
            rows.append({"key": key, "from": current, "to": overrides[key]})
    return rows


def _draft_path(config: Dict[str, Any], name: Any) -> Optional[Path]:
    if not isinstance(name, str) or not _DRAFT_NAME.fullmatch(name):
        return None
    return lab_dir(config) / "drafts" / f"{name}.json"


def load_draft(config: Dict[str, Any], name: Any) -> Optional[Dict[str, Any]]:
    path = _draft_path(config, name)
    draft = _read_json(path) if path is not None and path.is_file() else None
    return draft if isinstance(draft, dict) and isinstance(draft.get("overrides"), dict) else None


def save_draft(
    config: Dict[str, Any],
    raw_config: Mapping[str, Any],
    title: Any,
    overrides: Any,
    name: Optional[str] = None,
) -> Dict[str, Any]:
    """Validate and save a draft. ``name`` replaces that draft; otherwise the name comes from the title."""
    title = " ".join(str(title or "").split())
    slug = name if name is not None else re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40].strip("-")
    path = _draft_path(config, slug)
    if not title or path is None:
        raise LabError("a draft needs a name with a letter or a number in it")
    if name is not None and not path.is_file():
        raise LabError(f"there is no draft called {name}")
    problems = check_overrides(overrides)
    if problems:
        raise LabError("the draft has values the settings schema does not accept", problems)
    settings = _settings(raw_config)
    draft = {
        "name": slug,
        "title": title,
        "updatedAt": _now().replace(microsecond=0).isoformat(),
        # A value equal to what config.json already gives is not a change.
        "overrides": {row["key"]: row["to"] for row in changes(settings, overrides)},
    }
    _write_json(path, draft)
    return draft


def visuals(settings: Mapping[str, Any]) -> Dict[str, Any]:
    """The provider a new background would come from, its model, and whether the request costs money."""
    provider = settings_schema.value(settings, "visuals_provider")
    model_key = f"{provider}_visual_model"
    return {
        "name": provider,
        "model": settings_schema.value(settings, model_key) if model_key in settings_schema.BY_KEY else None,
        "paid": provider in PAID_PROVIDERS,
    }


def list_drafts(config: Dict[str, Any], raw_config: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """Every readable draft, by name, with its ``changes`` against config.json and any ``problems``.

    ``provider`` is what a new background would use with the draft (config.json's when the draft has problems).
    """
    folder = lab_dir(config) / "drafts"
    settings = _settings(raw_config)
    drafts = []
    for path in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        draft = load_draft(config, path.stem)
        if draft is None:
            continue
        problems = check_overrides(draft["overrides"])
        drafts.append({
            "name": path.stem, "title": str(draft.get("title") or path.stem), "updatedAt": draft.get("updatedAt"),
            "overrides": draft["overrides"],
            "changes": [] if problems else changes(settings, draft["overrides"]),
            "problems": problems,
            "provider": visuals({**settings, **({} if problems else draft["overrides"])}),
        })
    return drafts


def delete_draft(config: Dict[str, Any], name: Any) -> bool:
    path = _draft_path(config, name)
    if path is None or not path.is_file():
        return False
    path.unlink()
    return True


# --------------------------------------------------------------------------- applying a draft

def config_text(raw_config: Mapping[str, Any]) -> str:
    """``config.json`` as the repository formats it, so an apply changes only the lines it means to."""
    return json.dumps(raw_config, indent=2, ensure_ascii=False) + "\n"


def apply_draft(config_path: Path, config: Dict[str, Any], name: Any) -> Dict[str, Any]:
    """Write a draft's overrides into ``config.json`` and delete the draft.

    Returns the ``changes`` made and a unified ``diff`` of the file. It does
    not commit: ``config.json`` is tracked, and committing it is Tony's call.
    """
    draft = load_draft(config, name)
    if draft is None:
        raise LabError(f"there is no draft called {name}")
    problems = check_overrides(draft["overrides"])
    if problems:
        raise LabError("the draft has values the settings schema does not accept", problems)
    config_path = Path(config_path)
    before = config_path.read_text(encoding="utf-8")
    raw = json.loads(before)
    settings = raw.setdefault("settings", {})
    applied = changes(settings, draft["overrides"])
    settings.update({row["key"]: row["to"] for row in applied})
    after = config_text(raw)
    _write_text(config_path, after)
    delete_draft(config, name)
    diff = difflib.unified_diff(before.splitlines(), after.splitlines(), "a/config.json", "b/config.json", lineterm="")
    return {"changes": applied, "diff": "\n".join(diff)}


def git_diff(config_path: Path) -> Optional[str]:
    """``git diff -- config.json`` for the checkout holding it, or None when git cannot say."""
    config_path = Path(config_path)
    try:
        result = subprocess.run(
            ["git", "diff", "--", config_path.name], cwd=str(config_path.parent),
            capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout if result.returncode == 0 else None


# --------------------------------------------------------------------------- what can be rendered

def lab_episodes(config: Dict[str, Any]) -> List[str]:
    """Episodes the Lab can render, oldest first: the clip stage needs the local mp3 and an SEO file."""
    return [
        stem for stem in stage_status.known_stems(config)
        if _STEM.fullmatch(stem) and stage_status.episode_audio(config, stem) and clip_choices(config, stem)
    ]


def clip_choices(config: Dict[str, Any], stem: str) -> List[Dict[str, Any]]:
    """The episode's rendered picks, then Cowork's other candidates.

    ``id`` is ``pick-N`` (the ``NN-`` file number) or ``candidate-N`` (the
    position in ``candidateClips``, as ``publish_decisions.py`` counts it).
    ``realClip`` and ``still`` are the pick's rendered clip and background
    still when they are on disk. ``labStills`` are the backgrounds Lab runs
    made for the clip, newest first.
    """
    output = Path(config.get("paths", {}).get("output_dir", "./output"))
    made = _lab_stills(config, stem)
    choices: List[Dict[str, Any]] = []
    picked = set()
    for row in publish_log.rendered_clips(config, stem):
        clip = row["clip"]
        picked.add(_clip_key(clip))
        real = output / "clips" / stem / row["file"]
        still = output / "visuals" / stem / f"{row['file'][:-len('.mp4')]}.png"
        choices.append(_choice("pick", row["index"], clip, real if real.is_file() else None,
                               still if still.is_file() else None))
    for index, clip in enumerate(publish_log.candidate_clips(config, stem)):
        if isinstance(clip, dict) and _clip_key(clip) not in picked and _window(clip) is not None:
            choices.append(_choice("candidate", index, clip, None, None))
    for choice in choices:
        choice["labStills"] = made.get(choice["id"], [])
    return choices


def _lab_stills(config: Dict[str, Any], stem: str) -> Dict[str, List[Dict[str, Any]]]:
    """By clip id, the stills of finished runs that made a new background for a clip of ``stem``, newest first."""
    stills: Dict[str, List[Dict[str, Any]]] = {}
    for run in list_runs(config):
        if run.get("stem") != stem or not run.get("newBackground") or run.get("status") != "done":
            continue
        clip_file = run.get("clipFile")
        clip = run.get("clip") if isinstance(run.get("clip"), dict) else {}
        if not isinstance(clip_file, str) or not clip_file.endswith(".mp4"):
            continue
        still = lab_dir(config) / run["id"] / "visuals" / stem / f"{Path(clip_file).name[:-len('.mp4')]}.png"
        if still.is_file():
            stills.setdefault(str(clip.get("id")), []).append({
                "run": run["id"], "createdAt": run.get("createdAt"),
                "imagePrompt": str(clip.get("imagePrompt") or ""), "still": still,
            })
    return stills


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def _window(clip: Mapping[str, Any]) -> Optional[tuple]:
    start, end = _number(clip.get("start")), _number(clip.get("end"))
    return None if start is None or end is None or start < 0 or end <= start else (start, end)


def _clip_key(clip: Mapping[str, Any]) -> tuple:
    return (_number(clip.get("start")), _number(clip.get("end")), str(clip.get("headline") or ""))


def _choice(source: str, index: int, clip: Dict[str, Any], real: Optional[Path], still: Optional[Path]) -> Dict[str, Any]:
    return {
        "id": f"{source}-{index}", "source": source, "index": index,
        "headline": str(clip.get("headline") or ""), "start": float(clip["start"]), "end": float(clip["end"]),
        "imagePrompt": str(clip.get("imagePrompt") or ""),
        "realClip": real, "still": still, "clip": clip,
    }


# --------------------------------------------------------------------------- runs

def run_dir(config: Dict[str, Any], run_id: Any) -> Optional[Path]:
    """The folder of an existing run, or None. Only a real folder directly inside the Lab that holds ``run.json``."""
    if not isinstance(run_id, str) or not _RUN_ID.fullmatch(run_id):
        return None
    folder = lab_dir(config) / run_id
    if folder.is_symlink() or not (folder / "run.json").is_file():
        return None
    return folder if folder.resolve().parent == lab_dir(config).resolve() else None


def _edited_clip(clip: Dict[str, Any], edits: Any, new_background: bool, settings: Mapping[str, Any],
                 transcript: Path) -> tuple:
    """Return (the clip with ``edits`` applied, the edits that changed something)."""
    if edits is None:
        edits = {}
    if not isinstance(edits, dict):
        raise LabError("edits must be an object")
    for key in edits:
        if key not in _EDITABLE:
            raise LabError(f"only {', '.join(_EDITABLE[:-1])} and {_EDITABLE[-1]} can be changed, not {key}")
    edited = dict(clip)
    if "imagePrompt" in edits:
        prompt = edits["imagePrompt"]
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise LabError(f"the image prompt must be text of at most {MAX_PROMPT_CHARS} characters")
        if not new_background:
            raise LabError("the image prompt only matters with a new background")
        edited["imagePrompt"] = prompt.strip()
    if "start" in edits or "end" in edits:
        window = _window({"start": edits.get("start", clip["start"]), "end": edits.get("end", clip["end"])})
        if window is None:
            raise LabError("start and end must be seconds, with start before end")
        edited["start"], edited["end"] = window
        length = window[1] - window[0]
        shortest = float(settings_schema.value(settings, "min_clip_duration_seconds"))
        if not shortest <= length <= MAX_CLIP_SECONDS:
            raise LabError(f"the clip must be {shortest:g} to {MAX_CLIP_SECONDS:g} seconds long, not {length:g}")
        segments = _read_json(transcript)
        ends = [_number(seg.get("end")) for seg in segments if isinstance(seg, dict)] if isinstance(segments, list) else []
        spoken_until = max((end for end in ends if end is not None), default=None)
        if spoken_until is not None and window[1] > spoken_until + 1.0:
            raise LabError(f"the clip ends at {window[1]:g}s, after the transcript ends ({spoken_until:g}s)")
    changed = {key: edited[key] for key in _EDITABLE if key in edits and edited[key] != clip.get(key)}
    return edited, changed


def create_run(
    config: Dict[str, Any],
    raw_config: Mapping[str, Any],
    *,
    stem: Any,
    clip: Any,
    stage: Any = "clip",
    draft: Optional[str] = None,
    edits: Any = None,
    new_background: bool = False,
    background: Any = None,
    confirm_paid: bool = False,
    now: Optional[_dt.datetime] = None,
) -> Dict[str, Any]:
    """Check a render request and build its run folder; raise ``LabError`` when it is refused.

    ``background`` is the id of a run whose new background to reuse instead
    of the real still. Nothing is written unless every check passes. The run
    is left ``ready``: ``run_command`` and ``run_env`` say how to start it.
    """
    if stage in NEVER_IN_LAB:
        raise LabError(f"{stage} writes to Convex and is never run from the Lab", code="never_in_lab")
    if stage not in LAB_STAGES:
        raise LabError(f"{stage} is not a stage the Lab runs")
    if not isinstance(stem, str) or stem not in lab_episodes(config):
        raise LabError(f"{stem} is not an episode the Lab can render")
    choice = next((c for c in clip_choices(config, stem) if c["id"] == clip), None)
    if choice is None:
        raise LabError(f"{clip} is not a clip of {stem}")

    overrides: Dict[str, Any] = {}
    draft_ref = None
    if draft is not None:
        loaded = load_draft(config, draft)
        if loaded is None:
            raise LabError(f"there is no draft called {draft}")
        problems = check_overrides(loaded["overrides"])
        if problems:
            raise LabError("the draft has values the settings schema does not accept", problems)
        overrides = loaded["overrides"]
        draft_ref = {"name": draft, "title": str(loaded.get("title") or draft)}
    settings = {**_settings(raw_config), **overrides}

    new_background = bool(new_background)
    provider = settings_schema.value(settings, "visuals_provider")
    paid = new_background and provider in PAID_PROVIDERS
    reused, reused_prompt = choice["still"], None
    if background is not None:
        if new_background:
            raise LabError("a render either reuses a background or makes a new one, not both")
        made = next((row for row in choice["labStills"] if row["run"] == background), None)
        if made is None:
            raise LabError(f"{background} is not a background made in the Lab for this clip")
        reused, reused_prompt = made["still"], made["imagePrompt"]
    if not new_background and reused is None:
        raise LabError("This clip has no still to reuse. Rendering it needs a new background, which is one image request.",
                       code="needs_background")
    if paid and not confirm_paid:
        model = settings_schema.value(settings, f"{provider}_visual_model")
        raise LabError(f"A new background is one paid image request to {provider} ({model}).", code="confirm_paid")
    paths = stage_status.artifacts(config, stem)
    edited, changed = _edited_clip(choice["clip"], edits, new_background, settings, paths["transcript"])
    if reused_prompt:
        edited["imagePrompt"] = reused_prompt  # the prompt the reused background was made from

    now = now or _now()
    base = f"{now:%Y%m%d-%H%M%S}-{stem}-{choice['id']}"
    run_id = next(rid for rid in [base] + [f"{base}-{n}" for n in range(2, 1000)] if not (lab_dir(config) / rid).exists())
    folder = lab_dir(config) / run_id
    folder.mkdir(parents=True)

    run_config = copy.deepcopy(dict(raw_config))
    run_config["paths"] = {
        "episodes_dir": str(paths["audio"].parent.resolve()),
        "transcripts_dir": str(paths["transcript"].parent.resolve()),
        # Everything the clip stage writes goes under the run folder.
        "output_dir": str(folder),
        "seo_dir": str(folder / "seo"),
        "movie_extractions_dir": str(folder / "movies"),
    }
    run_config["settings"] = {
        **settings,
        # Reuse the copied still and ask for no image; a new background asks for exactly one.
        "local_visual_reuse_cached_still": not new_background,
        # No stage that reads these runs here; pointing them at the run folder keeps it that way.
        "cowork_outputs_dir": str(folder / "cowork"),
        "cowork_headless": False,
    }
    _write_json(folder / "config.json", run_config)
    _write_json(folder / "seo" / f"{stem}.seo.json", {"clipAnalysis": [edited], "candidateClips": [edited]})
    clip_file = clip_files.clip_file_name(1, edited)  # the run's only clip is number 01
    if not new_background:
        still = folder / "visuals" / stem / f"{clip_file[:-len('.mp4')]}.png"
        still.parent.mkdir(parents=True)
        shutil.copyfile(reused, still)

    run = {
        "id": run_id, "createdAt": now.replace(microsecond=0).isoformat(),
        "stem": stem, "stage": stage,
        "clip": {key: choice[key] for key in ("id", "source", "index", "headline")}
        | {key: edited.get(key) for key in _EDITABLE},
        "edits": changed,
        "draft": draft_ref, "overrides": overrides,
        "newBackground": new_background, "background": background, "paid": paid, "provider": provider,
        "clipFile": f"clips/{stem}/{clip_file}",
        "realClipFile": choice["realClip"].name if choice["realClip"] else None,
        "status": "ready", "startedAt": None, "finishedAt": None, "returncode": None, "message": None,
    }
    _write_json(folder / "run.json", run)
    return run


def run_command(config: Dict[str, Any], run: Mapping[str, Any], python: Path) -> List[str]:
    """The pipeline's clip stage on one explicit episode, so it never asks Azure for the latest."""
    return [
        str(python), "pipeline.py", str(stage_status.artifacts(config, run["stem"])["audio"].resolve()),
        "--config", str(lab_dir(config) / run["id"] / "config.json"),
        "--only", run["stage"],
    ]


def run_env(run: Mapping[str, Any], environ: Mapping[str, str]) -> Dict[str, str]:
    """The environment for a run. Unless the run is a confirmed paid one, the image API keys are blank.

    The pipeline never replaces a variable that is already set, so a blank one
    stays blank after it loads ``.env``, and a hosted image request fails
    before it is sent.
    """
    env = dict(environ)
    if not run.get("paid"):
        env.update({name: "" for name in IMAGE_KEY_NAMES})
    return env


def load_run(config: Dict[str, Any], run_id: Any) -> Optional[Dict[str, Any]]:
    folder = run_dir(config, run_id)
    run = _read_json(folder / "run.json") if folder is not None else None
    return run if isinstance(run, dict) and run.get("id") == run_id else None


def _update_run(config: Dict[str, Any], run_id: Any, **fields: Any) -> Dict[str, Any]:
    run = load_run(config, run_id)
    if run is None:
        raise LabError(f"there is no run called {run_id}")
    run.update(fields)
    _write_json(lab_dir(config) / run_id / "run.json", run)
    return run


def start_run(config: Dict[str, Any], run_id: Any) -> Dict[str, Any]:
    return _update_run(config, run_id, status="running", startedAt=_now().replace(microsecond=0).isoformat())


def finish_run(config: Dict[str, Any], run_id: Any, returncode: int, timed_out: bool = False) -> Dict[str, Any]:
    """Record how a run ended. The clip stage exits 0 even when a render fails, so the clip file decides."""
    run = load_run(config, run_id)
    if run is None:
        raise LabError(f"there is no run called {run_id}")
    rendered = (lab_dir(config) / run_id / run["clipFile"]).is_file()
    if timed_out:
        message = "stopped: the render ran past its time limit"
    elif returncode != 0:
        message = f"the pipeline exited with status {returncode}"
    elif not rendered:
        message = "the pipeline finished but wrote no clip; see the log"
    else:
        message = None
    return _update_run(
        config, run_id, status="failed" if message else "done", returncode=returncode, message=message,
        finishedAt=_now().replace(microsecond=0).isoformat(),
    )


def list_runs(config: Dict[str, Any], active: Optional[str] = None) -> List[Dict[str, Any]]:
    """Every run, newest first. One left ``ready`` or ``running`` that is not ``active`` was interrupted."""
    folder = lab_dir(config)
    runs = []
    for path in folder.iterdir() if folder.is_dir() else []:
        run = load_run(config, path.name)
        if run is None:
            continue
        if run.get("status") in ("ready", "running") and run["id"] != active:
            run["status"] = "interrupted"
        runs.append(run)
    return sorted(runs, key=lambda run: (str(run.get("createdAt")), run["id"]), reverse=True)


def log_tail(config: Dict[str, Any], run_id: Any, max_bytes: int = 8000, name: str = "run.log") -> str:
    """The end of the run's log (``name``: its render's, or its upload's), starting on a whole line."""
    folder = run_dir(config, run_id)
    log = folder / name if folder is not None else None
    if log is None or not log.is_file():
        return ""
    data = log.read_bytes()
    if len(data) > max_bytes:
        data = data[-max_bytes:]
        data = data[data.find(b"\n") + 1:] if b"\n" in data[:-1] else data
    return data.decode("utf-8", errors="replace")


def delete_run(config: Dict[str, Any], run_id: Any) -> bool:
    """Delete one run folder. Never anything that is not a run directly inside the Lab."""
    folder = run_dir(config, run_id)
    if folder is None:
        return False
    shutil.rmtree(folder)
    return True
