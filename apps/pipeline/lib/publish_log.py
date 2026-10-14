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
_STEM = re.compile(r"\d{8}")
_CLIP = re.compile(r"(c?)(\d+)", re.IGNORECASE)


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


def short_url(video_id: str) -> str:
    """Where a published Short is watched."""
    return f"https://youtube.com/shorts/{video_id}"


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


def _stem(stem: Any) -> str:
    if not isinstance(stem, str) or not _STEM.fullmatch(stem):
        raise ValueError(f"episode must be a date like 20261005, not {stem!r}")
    return stem


def _words(name: str, value: Any) -> Optional[str]:
    """Optional free text: stripped, and None when there is nothing left."""
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text")
    return value.strip() or None


def mark_untracked(config: Dict[str, Any], stem: str, label: str,
                   youtube: Optional[str] = None, note: Optional[str] = None) -> Dict[str, Any]:
    """Record a published Short whose clip is no longer in the pipeline's output."""
    label = _words("label", label)
    if not label:
        raise ValueError("an untracked Short needs a label (the bit's name)")
    if not _words("youtube", youtube):
        raise ValueError("an untracked Short needs its YouTube URL or ID")
    return _record(config, {
        "stem": _stem(stem), "source": "untracked", "start": None, "end": None, "headline": label,
        "decision": "published", "youtubeId": youtube_id(youtube), "reason": _words("note", note),
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


def decide(config: Dict[str, Any], stem: str, clip: Any, decision: str,
           youtube: Optional[str] = None, reason: Optional[str] = None) -> List[Dict[str, Any]]:
    """Record ``decision`` for ``clip`` and return the rows written.

    ``clip`` is a rendered clip's number (its ``NN-`` file prefix), ``c`` and a
    candidate's position in ``candidateClips``, or ``rest`` for every rendered
    clip of the episode still undecided. Publishing needs the Short's address.
    """
    stem = _stem(stem)
    which = clip.strip().lower() if isinstance(clip, str) else clip
    numbered = _CLIP.fullmatch(str(which)) if isinstance(which, (str, int)) and not isinstance(which, bool) else None
    if which != "rest" and not numbered:
        raise ValueError(f"clip must be a rendered clip's number, c and a candidate's number, or rest, not {clip!r}")
    if decision not in DECISIONS:
        raise ValueError(f"decision must be one of {', '.join(DECISIONS)}, not {decision!r}")
    reason = _words("reason", reason)
    youtube = _words("youtube", youtube)
    if decision == "published" and which == "rest":
        raise ValueError("rest can only be skipped: each published Short has its own address")
    if decision == "published" and not youtube:
        raise ValueError("publish needs the Short's YouTube URL or ID")
    if which == "rest":
        return mark_rest(config, stem, decision, reason=reason)
    mark = mark_candidate if numbered.group(1) else mark_rendered
    return [mark(config, stem, int(numbered.group(2)), decision, youtube, reason)]


# --------------------------------------------------------------------------- reporting

def _seconds(clip: Dict[str, Any]) -> float:
    return round(float(clip["end"]) - float(clip["start"]), 2)


def published_lengths(config: Dict[str, Any]) -> Dict[str, Any]:
    """How long the published Shorts whose window is known ran: how many, the shortest and the longest."""
    lengths = [_seconds(d) for d in load(config)["decisions"]
               if d.get("decision") == "published" and d.get("start") is not None and d.get("end") is not None]
    return {"count": len(lengths), "shortest": min(lengths, default=None), "longest": max(lengths, default=None)}


def listing(config: Dict[str, Any], stem: str) -> Dict[str, Any]:
    """Everything decided or still to decide for ``stem``.

    ``rendered``: the clip stage's picks, by file number. ``candidates``: all
    of Cowork's candidates by position, each with the number of the pick it
    was ``rendered`` as (None when it was not). ``untracked``: published
    Shorts whose clip is gone. Each clip row has its ``decision`` (or None),
    its length in ``seconds``, and ``longerThanPublished``: longer than every
    Short published so far.
    """
    mine = [d for d in load(config)["decisions"] if d["stem"] == stem]
    decided = {decision_key(d): d for d in mine}
    longest = published_lengths(config)["longest"]

    def row(clip: Dict[str, Any], **fields: Any) -> Dict[str, Any]:
        seconds = _seconds(clip)
        return {**fields, "clip": clip, "seconds": seconds,
                "decision": decided.get(decision_key(clip_row(stem, clip, "pick", "skipped", None, None))),
                "longerThanPublished": longest is not None and seconds > longest}

    rendered = [row(r["clip"], index=r["index"], file=r["file"], fileExists=r["fileExists"])
                for r in rendered_clips(config, stem)]
    as_pick = {decision_key(clip_row(stem, r["clip"], "pick", "skipped", None, None)): r["index"] for r in rendered}
    candidates = [
        row(clip, index=index, rendered=as_pick.get(decision_key(clip_row(stem, clip, "candidate", "skipped", None, None))))
        for index, clip in enumerate(candidate_clips(config, stem))
    ]
    return {"rendered": rendered, "candidates": candidates,
            "untracked": [d for d in mine if d["source"] == "untracked"]}


def tracked_stems(config: Dict[str, Any]) -> List[str]:
    """Every episode with a clips folder or a recorded decision, oldest first."""
    clips_root = Path(config.get("paths", {}).get("output_dir", "./output")) / "clips"
    stems = ({p.name for p in clips_root.iterdir() if p.is_dir() and _STEM.fullmatch(p.name)}
             if clips_root.is_dir() else set())
    stems |= {d["stem"] for d in load(config)["decisions"]}
    return sorted(stems)


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
            # Undecided picks whose rendered file is still on disk: the clips left to review.
            "toReview": sum(1 for r, d in zip(rendered, picked) if d is None and r["fileExists"]),
            "publishedNotPicked": sum(1 for d in mine if d["source"] == "candidate" and d["decision"] == "published"),
            "untracked": sum(1 for d in mine if d["source"] == "untracked"),
        })
    return rows
