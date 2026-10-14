"""What each dashboard tab shows, as plain functions from a config to a dict.

Nothing here decides anything: stage status, validation, publish counts and
setting defaults all come from the ``lib/`` functions the command-line tools
use. These functions only gather those answers for one page. They read the
data directory and never write to it.
"""
from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from lib import (
    cowork_handoff, cowork_headless, lab, phrase_scan, pipeline_runs, publish_log, settings_schema, shirt_ideas,
    stage_status, visual_prompts,
)
from lib.data_dir import data_dir, resolve_data_paths

RECENT_EPISODES = 12
RUNS_LISTED = 30
DOCS = ("cowork-handoff.md", "show-format.md")  # under apps/pipeline/docs
MEDIA_ROOTS = (("episodes", "episodes_dir"), ("output", "output_dir"))  # URL name, paths key
_STATE_FIELDS = ("status", "updatedAt", "note", "waitingOn", "lastError")


def load_config(path: Path) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return ``config.json`` as written, and a copy with its paths anchored to the data directory.

    Like the validator, this does not go through ``runtime_config.load_config``,
    which loads ``.env``.
    """
    with Path(path).open(encoding="utf-8") as f:
        raw = json.load(f)
    return raw, resolve_data_paths(copy.deepcopy(raw))


def _read_json(path: Path) -> Any:
    """The file's JSON, or None when it is missing or cannot be read."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _label(path: Path) -> str:
    """A path as Tony would type it: relative to the data directory when it is inside it."""
    try:
        return path.resolve().relative_to(data_dir()).as_posix()
    except ValueError:
        return str(path)


def _date(stem: str) -> Optional[str]:
    return f"{stem[:4]}-{stem[4:6]}-{stem[6:]}" if re.fullmatch(r"\d{8}", stem) else None


def media_url(config: Dict[str, Any], path: Path) -> Optional[str]:
    """The dashboard URL for a file under ``episodes/`` or ``output/``; None for anything else."""
    for name, key in MEDIA_ROOTS:
        try:
            relative = Path(path).relative_to(Path(config.get("paths", {}).get(key, f"./{name}")))
        except ValueError:
            continue
        return f"/media/{name}/" + "/".join(quote(part, safe="") for part in relative.parts)
    return None


def _identity(config: Dict[str, Any], stem: str) -> Tuple[Optional[int], Optional[str]]:
    """Episode number and title as Convex had them when the movies stage ran; the only local copy."""
    for path in (stage_status.artifacts(config, stem)["movies"], cowork_handoff.movies_path(config, stem)):
        payload = _read_json(path)
        episode = payload.get("episode") if isinstance(payload, dict) else None
        if not isinstance(episode, dict):
            continue
        number, title = episode.get("dbEpisodeNumber"), episode.get("dbEpisodeTitle")
        if isinstance(number, int) or title:
            return (number if isinstance(number, int) else None), (str(title) if title else None)
    return None, None


def header(config: Dict[str, Any], check: Optional[Dict[str, Any]] = None, checked_at: Optional[str] = None) -> Dict[str, Any]:
    """The data directory, and the Convex target as the Runs tab's last check found it (none until one is made)."""
    convex: Dict[str, Any] = {"checked": False}
    found = next((row for row in (check or {}).get("checks") or [] if row.get("id") == "configuration"), None)
    if found is not None:
        convex = {"checked": True, "ok": bool(found.get("ok")), "at": checked_at, "detail": found.get("detail")}
    return {"dataDir": str(data_dir()), "convex": convex}


# --------------------------------------------------------------------------- Today

def _shorts(reports: Dict[str, Dict[str, Any]], stem: str) -> Optional[Dict[str, int]]:
    row = reports.get(stem)
    return {key: row[key] for key in ("rendered", "published", "skipped", "toReview")} if row else None


def _status(entry: Dict[str, Any], shorts: Optional[Dict[str, int]]) -> str:
    if entry.get("status") == cowork_handoff.STATUS_AWAITING:
        return "waiting"
    if shorts and shorts["toReview"]:
        return "review"
    return "done" if entry.get("status") == cowork_handoff.STATUS_DONE else "unprocessed"


def _needs(config, state, reports, transcript_stems, phrases) -> List[Dict[str, Any]]:
    episodes = state["episodes"]
    needs: List[Dict[str, Any]] = []
    for stem in sorted(reports, reverse=True):
        if reports[stem]["toReview"]:
            number, title = _identity(config, stem)
            needs.append({"kind": "clips", "stem": stem, "date": _date(stem), "number": number, "title": title,
                          "count": reports[stem]["toReview"]})
    for stem in cowork_handoff.awaiting(config):
        number, title = _identity(config, stem)
        check = cowork_handoff.check_episode(config, stem)
        needs.append({
            "kind": "cowork", "stem": stem, "date": _date(stem), "number": number, "title": title,
            "ready": cowork_handoff.outputs_ready(config, stem), "ok": check["ok"],
            # With headless on, an episode is only left waiting when its session failed or was skipped.
            "headless": cowork_headless.enabled(config),
            "files": check["files"], "lastError": episodes[stem].get("lastError"),
        })
    if phrases["stale"]:
        needs.append({"kind": "phrases", "reportSavedAt": phrases["reportSavedAt"],
                      "ignoreSavedAt": phrases["ignoreSavedAt"]})
    unprocessed = []
    for stem in transcript_stems:
        if episodes.get(stem, {}).get("status") == cowork_handoff.STATUS_AWAITING:
            continue  # listed above
        missing = [label for label, absent in (
            ("SEO file", not stage_status.artifacts(config, stem)["seo"].is_file()),
            ("state entry", stem not in episodes),
        ) if absent]
        if missing:
            unprocessed.append({"stem": stem, "missing": missing})
    if unprocessed:
        needs.append({"kind": "unprocessed", "episodes": unprocessed})
    return needs


def today(config: Dict[str, Any]) -> Dict[str, Any]:
    paths = config.get("paths", {})
    state = cowork_handoff.load_state(config)
    statuses = [entry.get("status") for entry in state["episodes"].values()]
    transcript_stems = [stem for stem, _ in phrase_scan.transcript_files(Path(paths.get("transcripts_dir", "./transcripts")))]
    reports = {row["stem"]: row for row in publish_log.report(config, publish_log.tracked_stems(config))}
    decisions = publish_log.load(config)["decisions"]
    phrases = phrase_scan.report_status(Path(paths.get("output_dir", "./output")) / "phrases")

    recent = []
    for stem in reversed(stage_status.known_stems(config)[-RECENT_EPISODES:]):
        number, title = _identity(config, stem)
        shorts = _shorts(reports, stem)
        recent.append({
            "stem": stem, "date": _date(stem), "number": number, "title": title,
            "stages": stage_status.stage_statuses(config, stem, state),
            "status": _status(state["episodes"].get(stem, {}), shorts),
            "shorts": shorts,
        })
    return {
        "needs": _needs(config, state, reports, transcript_stems, phrases),
        "clipsToReview": sum(row["toReview"] for row in reports.values()),
        "archive": {
            "transcripts": len(transcript_stems),
            "firstDate": _date(transcript_stems[0]) if transcript_stems else None,
            "lastDate": _date(transcript_stems[-1]) if transcript_stems else None,
            "done": statuses.count(cowork_handoff.STATUS_DONE),
            "waiting": statuses.count(cowork_handoff.STATUS_AWAITING),
            "shortsPublished": sum(1 for d in decisions if d.get("decision") == "published"),
            "decisions": len(decisions),
            "phrasesScanned": phrases["scanned"],
            "phrases": phrases["phrases"],
            "passages": phrases["passages"],
        },
        "recent": recent,
    }


# --------------------------------------------------------------------------- Episode

def episodes(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every known episode, newest first, for the episode picker."""
    rows = []
    for stem in reversed(stage_status.known_stems(config)):
        number, title = _identity(config, stem)
        rows.append({"stem": stem, "date": _date(stem), "number": number, "title": title})
    return rows


def _first_file(*paths: Path) -> Optional[Path]:
    return next((path for path in paths if path.is_file()), None)


def _seo(config: Dict[str, Any], stem: str) -> Optional[Dict[str, Any]]:
    """The SEO title: the parse stage's output, or Cowork's file while parse has not run."""
    path = _first_file(stage_status.artifacts(config, stem)["seo"], cowork_handoff.seo_path(config, stem))
    if path is None:
        return None
    payload = _read_json(path)
    title = payload.get("title") if isinstance(payload, dict) else None
    title = title if isinstance(title, str) else None
    return {"source": _label(path), "title": title, "titleLength": len(title or ""),
            "titleMax": cowork_handoff.TITLE_MAX_CHARS}


def _movies(config: Dict[str, Any], stem: str) -> Dict[str, Any]:
    """The reviewed movies: the movies stage's output, or Cowork's file while the stage has not run."""
    view: Dict[str, Any] = {"hosts": list(cowork_handoff.HOSTS), "source": None, "extractor": None, "rows": []}
    path = _first_file(stage_status.artifacts(config, stem)["movies"], cowork_handoff.movies_path(config, stem))
    if path is None:
        return view
    payload = _read_json(path)
    if not isinstance(payload, dict):
        view["source"] = f"{_label(path)} (could not be read)"
        return view
    extractor = payload.get("extractor") if isinstance(payload.get("extractor"), dict) else {}
    view["source"] = _label(path)
    view["extractor"] = " · ".join(str(extractor[k]) for k in ("version", "mode") if extractor.get(k)) or None
    for movie in payload.get("movies") or []:
        if not isinstance(movie, dict):
            continue
        # Files from the retired heuristic have no hostRatings: every rating is blank.
        ratings = movie.get("hostRatings") if isinstance(movie.get("hostRatings"), dict) else {}
        view["rows"].append({
            "title": movie.get("title"), "year": movie.get("year"),
            "status": movie.get("status", "accepted"),
            "reviewType": movie.get("reviewType"), "pickedBy": movie.get("pickedBy"),
            "ratings": {host: ratings.get(host) for host in cowork_handoff.HOSTS},
            "hasMovieId": bool(movie.get("matchedMovieId")),
        })
    return view


def episode(config: Dict[str, Any], stem: str) -> Optional[Dict[str, Any]]:
    """One episode's page, or None when ``stem`` is not a known episode."""
    stems = stage_status.known_stems(config)
    if stem not in stems:
        return None
    index = stems.index(stem)
    state = cowork_handoff.load_state(config)
    entry = state["episodes"].get(stem, {})
    number, title = _identity(config, stem)
    # Audio is found in episodes_dir; the state entry's episodePath can name a checkout that is gone.
    audio = stage_status.episode_audio(config, stem)
    thumbnail = stage_status.artifacts(config, stem)["thumbnail"]
    return {
        "stem": stem, "date": _date(stem), "number": number, "title": title,
        "prev": stems[index - 1] if index else None,
        "next": stems[index + 1] if index + 1 < len(stems) else None,
        "audio": {"file": audio.name, "bytes": audio.stat().st_size, "url": media_url(config, audio)} if audio else None,
        "audioEpisodes": sum(1 for s in stems if stage_status.episode_audio(config, s)),
        "thumbnail": media_url(config, thumbnail) if thumbnail.is_file() else None,
        "state": {key: entry[key] for key in _STATE_FIELDS if key in entry},
        "stages": stage_status.stage_statuses(config, stem, state),
        "cowork": cowork_handoff.check_episode(config, stem),
        "seo": _seo(config, stem),
        "movies": _movies(config, stem),
    }


# --------------------------------------------------------------------------- Settings

def settings(raw_config: Dict[str, Any], config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The Settings tab, from ``config.json`` as written (paths not anchored).

    Pass the anchored ``config`` as well to list the Lab's drafts, which live in the data directory.
    """
    configured = raw_config.get("settings") if isinstance(raw_config.get("settings"), dict) else {}

    def row(setting: settings_schema.Setting) -> Dict[str, Any]:
        key = setting.key
        return {
            "key": key, "type": setting.type,
            "value": settings_schema.value(configured, key), "default": setting.default,
            "source": settings_schema.source(configured, key),
            "stages": list(setting.stages),
            "minimum": setting.minimum, "maximum": setting.maximum, "choices": list(setting.choices),
            "problems": settings_schema.problems(key, configured[key]) if key in configured else [],
            "description": setting.description,
            "draft": setting.draft,  # a Lab draft may change it
        }

    return {
        "groups": [
            {"name": group, "settings": [row(s) for s in settings_schema.SETTINGS if s.group == group]}
            for group in settings_schema.GROUPS
        ],
        "check": settings_schema.config_check(configured),
        "guardrail": visual_prompts.ABSTRACT_VISUAL_GUARDRAIL,
        "docs": [{"name": f"docs/{name}", "url": f"/docs/{name}"} for name in DOCS],
        "drafts": lab.list_drafts(config, raw_config) if config is not None else [],
    }


# --------------------------------------------------------------------------- Lab

def lab_run(config: Dict[str, Any], run: Dict[str, Any]) -> Dict[str, Any]:
    """A run record plus the URLs of its clip and of the real clip it is compared with."""
    output = Path(config.get("paths", {}).get("output_dir", "./output"))
    rendered = lab.lab_dir(config) / run["id"] / run["clipFile"]
    real = output / "clips" / run["stem"] / run["realClipFile"] if run.get("realClipFile") else None
    return {
        **run,
        "clipUrl": media_url(config, rendered) if rendered.is_file() else None,
        "realClipUrl": media_url(config, real) if real is not None and real.is_file() else None,
    }


def lab_view(
    config: Dict[str, Any],
    raw_config: Dict[str, Any],
    active: Optional[str] = None,
    python: Optional[Path] = None,
    python_found: bool = False,
) -> Dict[str, Any]:
    """The Lab tab: what can be rendered, the drafts, and past runs. ``active`` is the run in progress."""
    configured = raw_config.get("settings") if isinstance(raw_config.get("settings"), dict) else {}
    provider = settings_schema.value(configured, "visuals_provider")
    model_key = f"{provider}_visual_model"
    episodes_ = []
    for stem in reversed(lab.lab_episodes(config)):
        number, title = _identity(config, stem)
        episodes_.append({
            "stem": stem, "date": _date(stem), "number": number, "title": title,
            "clips": [
                {key: choice[key] for key in ("id", "source", "index", "headline", "start", "end", "imagePrompt")}
                | {"hasStill": choice["still"] is not None,
                   "realClip": media_url(config, choice["realClip"]) if choice["realClip"] else None}
                for choice in lab.clip_choices(config, stem)
            ],
        })
    return {
        "stages": list(lab.LAB_STAGES),
        "neverInLab": list(lab.NEVER_IN_LAB),
        "python": {"path": str(python) if python else None, "found": python_found},
        "provider": {
            "name": provider,
            "model": settings_schema.value(configured, model_key) if model_key in settings_schema.BY_KEY else None,
            "paid": provider in lab.PAID_PROVIDERS,
        },
        "limits": {
            "minSeconds": float(settings_schema.value(configured, "min_clip_duration_seconds")),
            "maxSeconds": lab.MAX_CLIP_SECONDS,
        },
        "episodes": episodes_,
        "drafts": lab.list_drafts(config, raw_config),
        "runs": [lab_run(config, run) for run in lab.list_runs(config, active)],
        "active": active,
    }


# --------------------------------------------------------------------------- Shirts

_NO_RESCAN = {"running": False, "startedAt": None, "finishedAt": None, "returncode": None, "timedOut": False,
              "output": ""}


def _audio_url(config: Dict[str, Any], stem: Optional[str]) -> Optional[str]:
    audio = stage_status.episode_audio(config, stem) if stem else None
    return media_url(config, audio) if audio else None


def shirt_idea(config: Dict[str, Any], idea: Dict[str, Any]) -> Dict[str, Any]:
    """An idea with its licensing flags, where it came from in words, and its audio when the episode's is here."""
    came_from = idea.get("from") or {}
    url = _audio_url(config, came_from.get("stem")) if came_from.get("kind") == "episode" else None
    return {
        **idea,
        "flags": shirt_ideas.flags(idea),
        "fromText": shirt_ideas.source_text(idea),
        "hear": {"url": url, "start": came_from.get("start") or 0.0} if url else None,
    }


def shirts(config: Dict[str, Any], rescan: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """The Shirts tab: the shortlist and everything a phrase can be promoted from.

    ``rescan`` is the Rescan button's state, from the server's scan runner.
    """
    episodes_ = []
    for row in shirt_ideas.episode_phrases(config):
        number, title = _identity(config, row["stem"])
        episodes_.append({**row, "date": _date(row["stem"]), "number": number, "title": title,
                          "audioUrl": _audio_url(config, row["stem"])})
    path = shirt_ideas.ideas_path(config)
    return {
        "file": _label(path),
        "saved": path.is_file(),
        "statuses": list(shirt_ideas.STATUSES),
        "origins": list(shirt_ideas.ORIGINS),
        "ideas": [shirt_idea(config, idea) for idea in shirt_ideas.load(config)["ideas"]],
        "scan": {
            **phrase_scan.report_status(Path(config.get("paths", {}).get("output_dir", "./output")) / "phrases"),
            "sections": shirt_ideas.scan_sections(config),
        },
        "rescan": dict(rescan or _NO_RESCAN),
        "episodes": episodes_,
        "notes": {"file": _label(shirt_ideas.notes_path(config)), "lines": shirt_ideas.notes(config)},
    }


def shirt_phrases(
    config: Dict[str, Any], section: str, query: str = "", offset: int = 0, limit: int = shirt_ideas.PAGE_ROWS
) -> Dict[str, Any]:
    """A page of one section of the phrase report; an example can be heard when its episode's audio is here."""
    page = shirt_ideas.scan_rows(config, section, query, offset, limit)
    for row in page["rows"]:
        for example in row["examples"]:
            example["audioUrl"] = _audio_url(config, example["stem"])
    return page


# --------------------------------------------------------------------------- Clips

_COUNTS = ("rendered", "published", "skipped", "toReview", "untracked")


def _decision(decision: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """A recorded decision, with the address of the Short when it has one."""
    if decision is None:
        return None
    video = decision.get("youtubeId")
    return {**decision, "youtubeUrl": publish_log.short_url(video) if video else None}


def _clip_row(listed: Dict[str, Any], lab_clip: Optional[str], **fields: Any) -> Dict[str, Any]:
    clip = listed["clip"]
    return {
        "index": listed["index"], **fields,
        "headline": str(clip.get("headline") or ""), "start": float(clip["start"]), "end": float(clip["end"]),
        "seconds": listed["seconds"], "why": clip.get("why"),
        "decision": _decision(listed["decision"]), "longerThanPublished": listed["longerThanPublished"],
        "labClip": lab_clip,  # the Lab's id for this clip, when the Lab can render it
    }


def _published_first(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Published clips first; the sort is stable, so each group keeps its order."""
    return sorted(rows, key=lambda row: (row["decision"] or {}).get("decision") != "published")


def clips(config: Dict[str, Any], stem: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The Clips tab for one episode: its rendered picks, the other candidates, and what was decided.

    Published clips come first in both lists; otherwise they keep their order.

    With no ``stem`` it opens on the newest episode that has clips left to
    review, or the newest episode. None when ``stem`` has no clips folder and
    no decision.
    """
    tracked = publish_log.tracked_stems(config)
    reports = {row["stem"]: row for row in publish_log.report(config, tracked)}
    lengths = publish_log.published_lengths(config)
    if stem is None:
        newest = list(reversed(tracked))
        stem = next((s for s in newest if reports[s]["toReview"]), newest[0] if newest else None)
        if stem is None:
            return {"episodes": [], "stem": None, "lengths": lengths}
    if stem not in tracked:
        return None
    episodes_ = []
    for tracked_stem in reversed(tracked):
        number, title = _identity(config, tracked_stem)
        episodes_.append({"stem": tracked_stem, "date": _date(tracked_stem), "number": number, "title": title,
                          **{key: reports[tracked_stem][key] for key in _COUNTS}})
    listing = publish_log.listing(config, stem)
    in_lab = stem in lab.lab_episodes(config)
    lab_ids = {choice["id"] for choice in lab.clip_choices(config, stem)} if in_lab else set()
    clips_dir = Path(config.get("paths", {}).get("output_dir", "./output")) / "clips" / stem

    def lab_id(source: str, index: int) -> Optional[str]:
        return f"{source}-{index}" if f"{source}-{index}" in lab_ids else None

    index = tracked.index(stem)
    number, title = _identity(config, stem)
    return {
        "episodes": episodes_,
        "stem": stem, "date": _date(stem), "number": number, "title": title,
        "prev": tracked[index - 1] if index else None,
        "next": tracked[index + 1] if index + 1 < len(tracked) else None,
        "counts": reports[stem],
        "rendered": _published_first([
            _clip_row(row, lab_id("pick", row["index"]), file=row["file"], fileExists=row["fileExists"],
                      url=media_url(config, clips_dir / row["file"]) if row["fileExists"] else None)
            for row in listing["rendered"]
        ]),
        "candidates": _published_first([_clip_row(row, lab_id("candidate", row["index"]))
                                        for row in listing["candidates"] if row["rendered"] is None]),
        "candidateCount": len(listing["candidates"]),
        "untracked": [_decision(row) for row in listing["untracked"]],
        "lengths": lengths,
        "lab": in_lab,
    }


# --------------------------------------------------------------------------- Runs

def runs(config: Dict[str, Any], active: Optional[str], python: Optional[Path]) -> Dict[str, Any]:
    """The Runs tab: the episodes a run can name, the stages, and past runs, newest first.

    ``active`` is the id of the run this dashboard has going; ``python`` the
    venv python runs use.
    """
    state = cowork_handoff.load_state(config)["episodes"]
    reports = {row["stem"]: row for row in publish_log.report(config, publish_log.tracked_stems(config))}
    headless = cowork_headless.enabled(config)
    episodes_ = []
    for stem in reversed(stage_status.known_stems(config)):
        if stage_status.episode_audio(config, stem) is None:
            continue  # a run needs the mp3
        number, title = _identity(config, stem)
        status = _status(state.get(stem, {}), _shorts(reports, stem))
        episodes_.append({"stem": stem, "date": _date(stem), "number": number, "title": title, "status": status,
                          "resumable": status == "waiting" and (headless or cowork_handoff.outputs_ready(config, stem))})
    listed = pipeline_runs.list_runs(config, active)
    for run in listed:
        run["outcome"] = pipeline_runs.OUTCOMES.get(run["status"], run["status"])
    return {
        "episodes": episodes_,
        "stages": list(stage_status.STAGES),
        "headless": headless,
        "active": next((run for run in listed if run["id"] == active), None),
        "elsewhere": pipeline_runs.running_elsewhere(config, active),
        "runs": listed[:RUNS_LISTED],
        "runCount": len(listed),
        "runsDir": _label(pipeline_runs.runs_dir(config)),
        "python": str(python) if python else None,
        "pythonFound": bool(python) and Path(python).is_file(),
    }
