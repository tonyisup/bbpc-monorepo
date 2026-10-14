"""Which pipeline stages have run for an episode, worked out from the files they leave.

Six stages leave a file in the data directory, so those are checked.
``import_transcript`` and ``publish`` write only to Convex. ``pipeline.py``
journals each stage it runs (``lib/stage_journal.py``), so their last journaled
run says whether they finished; an episode with no journaled run of them falls
back to ``output/cowork/state.json`` and is marked ``checked: False``.

Standard library only: the dashboard imports this without the pipeline venv.
"""
from __future__ import annotations

import datetime as _dt
from pathlib import Path
from typing import Any, Dict, List, Optional

from lib import cowork_handoff, phrase_scan, publish_log, stage_journal

STAGES = ["transcribe", "import_transcript", "movies", "review_clip", "parse", "clip", "thumbnail", "publish"]

DONE = "done"          # the stage's file is there
PARTIAL = "partial"    # some of the stage's files are there
MISSING = "missing"    # the stage's file is not there
WAITING = "waiting"    # not there, and the episode is waiting on Cowork
RECORDED = "recorded"  # no local file; the stage journal says its last run finished
FAILED = "failed"      # no local file; the stage journal says its last run failed or was interrupted
INFERRED = "inferred"  # no local file to check; state.json implies it ran
UNKNOWN = "unknown"    # no local file to check, and state.json does not say
JOURNALED = ("import_transcript", "publish")


def artifacts(config: Dict[str, Any], stem: str) -> Dict[str, Path]:
    """Where the episode's audio is read from and where each stage writes."""
    paths = config.get("paths", {})
    output = Path(paths.get("output_dir", "./output"))
    return {
        "audio": Path(paths.get("episodes_dir", "./episodes")) / f"{stem}.mp3",
        "transcript": Path(paths.get("transcripts_dir", "./transcripts")) / f"{stem}.json",  # pipeline.py
        "movies": Path(paths.get("movie_extractions_dir", "./output/movies")) / f"{stem}.movies.json",
        "reviewManifest": output / "review-clips" / stem / "_manifest.json",
        "seo": output / "seo" / f"{stem}.seo.json",  # lib/parser.py writes here, whatever paths.seo_dir says
        "clips": output / "clips" / stem,
        "thumbnail": output / "thumbnails" / f"{stem}.png",
    }


def episode_audio(config: Dict[str, Any], stem: str) -> Optional[Path]:
    """The episode's local mp3, or None. state.json's ``episodePath`` can name a checkout that is gone."""
    path = artifacts(config, stem)["audio"]
    return path if path.is_file() else None


def known_stems(config: Dict[str, Any]) -> List[str]:
    """Every episode with a dated transcript, a local mp3, or a state.json entry, oldest first."""
    paths = config.get("paths", {})
    stems = {stem for stem, _ in phrase_scan.transcript_files(Path(paths.get("transcripts_dir", "./transcripts")))}
    episodes_dir = Path(paths.get("episodes_dir", "./episodes"))
    if episodes_dir.is_dir():
        stems |= {p.stem for p in episodes_dir.glob("*.mp3") if not p.name.startswith(".")}
    stems |= set(cowork_handoff.load_state(config)["episodes"])
    return sorted(stems)


def _file_stage(stage: str, path: Path, waiting: bool = False) -> Dict[str, Any]:
    if path.is_file():
        return {"stage": stage, "state": DONE, "checked": True, "detail": path.name}
    if waiting:
        return {"stage": stage, "state": WAITING, "checked": True, "detail": f"waiting on Cowork; no {path.name}"}
    return {"stage": stage, "state": MISSING, "checked": True, "detail": f"no {path.name}"}


def _clip_stage(config: Dict[str, Any], stem: str) -> Dict[str, Any]:
    # The clip stage creates output/clips/<stem>/ before it renders, so count the files.
    rendered = publish_log.rendered_clips(config, stem)
    if not rendered:
        return {"stage": "clip", "state": MISSING, "checked": True, "detail": "no SEO file, so no picks to render"}
    found = sum(1 for row in rendered if row["fileExists"])
    state = DONE if found == len(rendered) else PARTIAL if found else MISSING
    return {"stage": "clip", "state": state, "checked": True, "detail": f"{found} of {len(rendered)} picks rendered"}


def _inferred_stage(stage: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    status = entry.get("status")
    if status == cowork_handoff.STATUS_DONE:
        note = f" ({entry['note']})" if entry.get("note") else ""
        said = f"state.json says done{note}"
        # pipeline.py marks an episode done after a run that reached publish; seeding only saw an SEO file.
        if stage == "publish" and entry.get("note") == cowork_handoff.SEEDED_NOTE:
            return {"stage": stage, "state": UNKNOWN, "checked": False,
                    "detail": f"{said}, which does not show a publish; this stage leaves no local file"}
    elif status == cowork_handoff.STATUS_AWAITING and stage == "import_transcript":
        said = "state.json says awaiting_cowork, which follows the import"
    else:
        said = "state.json has no entry" if not status else f"state.json says {status}"
        return {"stage": stage, "state": UNKNOWN, "checked": False,
                "detail": f"{said}; this stage leaves no local file"}
    return {"stage": stage, "state": INFERRED, "checked": False,
            "detail": f"{said}; this stage leaves no local file"}


def _at(stamp: Any) -> str:
    """A journal time as ``2026-10-14 19:00 UTC``; anything unreadable as it is."""
    try:
        moment = _dt.datetime.fromisoformat(str(stamp)).astimezone(_dt.timezone.utc)
    except ValueError:
        return str(stamp)
    return f"{moment:%Y-%m-%d %H:%M} UTC"


def _journaled_stage(stage: str, runs: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The row for a stage from its journaled runs, or None when it has none. Dry runs write nothing, so they do not count."""
    runs = [run for run in runs if run["stage"] == stage and run["outcome"] != "dry_run"]
    if not runs:
        return None
    last = runs[-1]
    if last["outcome"] == "done":
        return {"stage": stage, "state": RECORDED, "checked": True,
                "detail": f"pipeline.py finished it at {_at(last['finishedAt'])}"}
    if last["outcome"] == "failed":
        said = f"the last run failed at {_at(last['finishedAt'])}" + (f" ({last['detail']})" if last.get("detail") else "")
    elif last["outcome"] == "interrupted":
        said = f"the last run was interrupted at {_at(last['finishedAt'])}"
    else:
        said = f"the last run stopped at {_at(last['finishedAt'])} ({last['outcome']})"
    finished = [run for run in runs if run["outcome"] == "done"]
    if finished:
        said += f"; it last finished at {_at(finished[-1]['finishedAt'])}"
    return {"stage": stage, "state": FAILED, "checked": True, "detail": said}


def stage_statuses(
    config: Dict[str, Any],
    stem: str,
    state: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """One row per stage, in ``STAGES`` order: ``stage``, ``state``, ``checked`` and ``detail``.

    Pass ``state`` (from ``cowork_handoff.load_state``) to avoid re-reading it per episode.
    """
    state = state if state is not None else cowork_handoff.load_state(config)
    entry = state["episodes"].get(stem, {})
    waiting = entry.get("status") == cowork_handoff.STATUS_AWAITING
    paths = artifacts(config, stem)
    runs = stage_journal.entries(config, stem)
    rows = {
        "transcribe": _file_stage("transcribe", paths["transcript"]),
        "import_transcript": _inferred_stage("import_transcript", entry),
        "movies": _file_stage("movies", paths["movies"], waiting),
        "review_clip": _file_stage("review_clip", paths["reviewManifest"]),
        "parse": _file_stage("parse", paths["seo"], waiting),
        "clip": _clip_stage(config, stem),
        "thumbnail": _file_stage("thumbnail", paths["thumbnail"]),
        "publish": _inferred_stage("publish", entry),
    }
    for stage in JOURNALED:
        rows[stage] = _journaled_stage(stage, runs) or rows[stage]
    return [rows[stage] for stage in STAGES]
