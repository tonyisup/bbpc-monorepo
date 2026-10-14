"""Which pipeline stages have run for an episode, worked out from the files they leave.

The pipeline keeps no record of the stages it ran. Six stages leave a file in
the data directory, so those are checked. ``import_transcript`` and ``publish``
write only to Convex, so they are inferred from ``output/cowork/state.json``
and marked ``checked: False``.

Standard library only: the dashboard imports this without the pipeline venv.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from lib import cowork_handoff, phrase_scan, publish_log

STAGES = ["transcribe", "import_transcript", "movies", "review_clip", "parse", "clip", "thumbnail", "publish"]

DONE = "done"          # the stage's file is there
PARTIAL = "partial"    # some of the stage's files are there
MISSING = "missing"    # the stage's file is not there
WAITING = "waiting"    # not there, and the episode is waiting on Cowork
INFERRED = "inferred"  # no local file to check; state.json implies it ran
UNKNOWN = "unknown"    # no local file to check, and state.json does not say


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
    return [rows[stage] for stage in STAGES]
