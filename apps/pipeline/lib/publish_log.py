"""Record what Tony did with each rendered clip: published as a Short, or skipped.

The log lives in the data directory at ``output/publish-decisions.json`` and is
the only record of which judgments led to a published Short. It feeds the
clip-picking review (does Cowork's top 3 contain what Tony posts?) and,
later, any clip rubric. Standard library only.

Clips are identified by episode stem plus window and headline, copied from
the SEO file at decision time, so a decision survives the rendered file being
deleted. ``source`` says where the clip came from:

- ``pick``: one of the clips the clip stage rendered (``clipAnalysis``).
- ``candidate``: one of Cowork's 20 candidates that was not rendered.
- ``untracked``: a Short whose clip is no longer in the pipeline's output.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from lib import clip_files

DECISIONS = ("published", "skipped")
LOG_VERSION = 1
_YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_URL_ID = re.compile(r"(?:youtu\.be/|/shorts/|[?&]v=|/embed/)([A-Za-z0-9_-]{11})")


# --------------------------------------------------------------------------- paths and storage

def log_path(config: Dict[str, Any]) -> Path:
    return Path(config.get("paths", {}).get("output_dir", "./output")) / "publish-decisions.json"


def _seo_path(config: Dict[str, Any], stem: str) -> Path:
    return Path(config.get("paths", {}).get("seo_dir", "./output/seo")) / f"{stem}.seo.json"


def _clips_dir(config: Dict[str, Any], stem: str) -> Path:
    return Path(config.get("paths", {}).get("output_dir", "./output")) / "clips" / stem


def load(config: Dict[str, Any]) -> Dict[str, Any]:
    path = log_path(config)
    if not path.is_file():
        return {"version": LOG_VERSION, "decisions": []}
    with path.open(encoding="utf-8") as f:
        log = json.load(f)
    log.setdefault("decisions", [])
    return log


def _save(config: Dict[str, Any], log: Dict[str, Any]) -> None:
    path = log_path(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".publish-decisions.", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


# --------------------------------------------------------------------------- what was rendered

def _load_seo(config: Dict[str, Any], stem: str) -> Optional[Dict[str, Any]]:
    path = _seo_path(config, stem)
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def rendered_clips(config: Dict[str, Any], stem: str) -> List[Dict[str, Any]]:
    """The clips the clip stage renders for ``stem``, numbered as their files are."""
    seo = _load_seo(config, stem)
    if not seo:
        return []
    kept, _ = clip_files.renderable_clips(seo.get("clipAnalysis") or [], clip_files.min_clip_duration(config))
    clips_dir = _clips_dir(config, stem)
    rows = []
    for index, clip in enumerate(kept, start=1):
        name = clip_files.clip_file_name(index, clip)
        rows.append({"index": index, "file": name, "fileExists": (clips_dir / name).is_file(), "clip": clip})
    return rows


def candidate_clips(config: Dict[str, Any], stem: str) -> List[Dict[str, Any]]:
    seo = _load_seo(config, stem)
    return list((seo or {}).get("candidateClips") or [])


# --------------------------------------------------------------------------- decisions

def youtube_id(value: Optional[str]) -> Optional[str]:
    """Accept a bare video ID or any youtube.com / youtu.be URL."""
    if value is None:
        return None
    value = value.strip()
    if _YOUTUBE_ID.match(value):
        return value
    match = _YOUTUBE_URL_ID.search(value)
    if match:
        return match.group(1)
    raise ValueError(f"not a YouTube video ID or URL: {value!r}")


def decision_key(row: Dict[str, Any]) -> tuple:
    if row["source"] == "untracked":
        return (row["stem"], "untracked", row["headline"])
    return (row["stem"], row["start"], row["end"], row["headline"])


def _record(config: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    if row["decision"] not in DECISIONS:
        raise ValueError(f"decision must be one of {', '.join(DECISIONS)}, not {row['decision']!r}")
    row = {k: v for k, v in row.items() if v is not None or k in ("start", "end")}
    row["decidedAt"] = _now()
    log = load(config)
    key = decision_key(row)
    log["decisions"] = [d for d in log["decisions"] if decision_key(d) != key] + [row]
    log["version"] = LOG_VERSION
    _save(config, log)
    return row


def clip_row(stem: str, clip: Dict[str, Any], source: str, decision: str,
              youtube: Optional[str], reason: Optional[str], file: Optional[str] = None) -> Dict[str, Any]:
    return {
        "stem": stem,
        "source": source,
        "start": float(clip["start"]),
        "end": float(clip["end"]),
        "headline": str(clip.get("headline") or ""),
        "file": file,
        "decision": decision,
        "youtubeId": youtube_id(youtube),
        "reason": reason,
    }


def _pick(rows: Sequence[Dict[str, Any]], index: int, what: str) -> Dict[str, Any]:
    if not 1 <= index <= len(rows):
        raise ValueError(f"{what} {index} does not exist (1-{len(rows)})")
    return rows[index - 1]


def mark_rendered(config: Dict[str, Any], stem: str, index: int, decision: str,
                  youtube: Optional[str] = None, reason: Optional[str] = None) -> Dict[str, Any]:
    """Decide rendered clip ``index`` (the ``NN-`` file prefix)."""
    rendered = _pick(rendered_clips(config, stem), index, f"rendered clip for {stem}")
    return _record(config, clip_row(stem, rendered["clip"], "pick", decision, youtube, reason, rendered["file"]))


def mark_candidate(config: Dict[str, Any], stem: str, index: int, decision: str,
                   youtube: Optional[str] = None, reason: Optional[str] = None) -> Dict[str, Any]:
    """Decide candidate ``index`` (0-based position in ``candidateClips``).

    A candidate that was also rendered is recorded as that rendered pick.
    """
    candidates = candidate_clips(config, stem)
    clip = _pick(candidates, index + 1, f"candidate for {stem}")
    row = clip_row(stem, clip, "candidate", decision, youtube, reason)
    for rendered in rendered_clips(config, stem):
        if decision_key(clip_row(stem, rendered["clip"], "pick", decision, None, None)) == decision_key(row):
            row.update(source="pick", file=rendered["file"])
    return _record(config, row)


def mark_untracked(config: Dict[str, Any], stem: str, label: str,
                   youtube: Optional[str] = None, note: Optional[str] = None) -> Dict[str, Any]:
    """Record a published Short whose clip is no longer in the pipeline's output."""
    return _record(config, {
        "stem": stem, "source": "untracked", "start": None, "end": None, "headline": label,
        "decision": "published", "youtubeId": youtube_id(youtube), "reason": note,
    })


def mark_rest(config: Dict[str, Any], stem: str, decision: str,
              reason: Optional[str] = None) -> List[Dict[str, Any]]:
    """Give every still-undecided rendered clip of ``stem`` the same decision."""
    decided = {decision_key(d) for d in load(config)["decisions"]}
    rows = []
    for rendered in rendered_clips(config, stem):
        row = clip_row(stem, rendered["clip"], "pick", decision, None, reason, rendered["file"])
        if decision_key(row) not in decided:
            rows.append(_record(config, row))
    return rows


# --------------------------------------------------------------------------- reporting

def report(config: Dict[str, Any], stems: Sequence[str]) -> List[Dict[str, Any]]:
    decisions = load(config)["decisions"]
    rows = []
    for stem in stems:
        mine = [d for d in decisions if d["stem"] == stem]
        by_key = {decision_key(d): d for d in mine}
        rendered = rendered_clips(config, stem)
        picked = [by_key.get(decision_key(clip_row(stem, r["clip"], "pick", "skipped", None, None))) for r in rendered]
        rows.append({
            "stem": stem,
            "rendered": len(rendered),
            "published": sum(1 for d in picked if d and d["decision"] == "published"),
            "skipped": sum(1 for d in picked if d and d["decision"] == "skipped"),
            "undecided": sum(1 for d in picked if d is None),
            "publishedNotPicked": sum(1 for d in mine if d["source"] == "candidate" and d["decision"] == "published"),
            "untracked": sum(1 for d in mine if d["source"] == "untracked"),
        })
    return rows
