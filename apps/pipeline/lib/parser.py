"""Parse stage: adopt Cowork's SEO metadata and clip choices.

Cowork reads the whole transcript and writes ``<stem>.seo.json`` (see
``docs/cowork-handoff.md``). This stage validates it, refreshes each clip's
image prompt from the words spoken in that window, and writes the SEO artifact
that ``clip`` and ``publish`` read. There is no model-based fallback: without
the Cowork file the stage stops with ``AwaitingCowork``.
"""
from __future__ import annotations

import json
import math
import random
from pathlib import Path
from typing import Any, Dict, List, cast

from lib import cowork_handoff
from lib.visual_prompts import normalize_clip_image_prompt, spoken_context_for_clip

# Full SEO object shape (see docs/cowork-handoff.md). Order preserved for stable output.
_SEO_KEYS = (
    "title",
    "metaDescription",
    "keywords",
    "highlights",
    "clipAnalysis",
    "candidateClips",
    "notableWorks",
    "callToAction",
)


def _default_seo_shell() -> Dict[str, Any]:
    return {
        "title": "",
        "metaDescription": "",
        "keywords": [],
        "highlights": [],
        "clipAnalysis": [],
        "candidateClips": [],
        "notableWorks": [],
        "callToAction": "",
    }


def _normalize_seo(parsed: Any) -> Dict[str, Any]:
    """Merge unknown/failed parses into the canonical SEO shape with empty defaults."""
    shell = _default_seo_shell()
    if not isinstance(parsed, dict):
        return shell
    # Prior failed parse stored only {"raw": ...}
    if set(parsed.keys()) == {"raw"}:
        return shell
    out = {**shell}
    for key in _SEO_KEYS:
        if key in parsed:
            out[key] = parsed[key]
    return out


def _fmt(s: float) -> str:
    """Abbreviated timestamp for section headers."""
    s = int(s)
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _load_transcript(transcript_path: Path) -> List[Dict[str, Any]]:
    with transcript_path.open() as f:
        return json.load(f)


def _has_valid_clip_window(clip: Any) -> bool:
    """Return whether a model-produced clip has a finite, forward time window."""
    if not isinstance(clip, dict):
        return False
    clip_dict = cast(Dict[str, Any], clip)
    start_raw: Any = clip_dict.get("start")
    end_raw: Any = clip_dict.get("end")
    if start_raw is None or end_raw is None:
        return False
    try:
        start = float(start_raw)
        end = float(end_raw)
    except (TypeError, ValueError):
        return False
    return math.isfinite(start) and math.isfinite(end) and end > start


def _filter_invalid_clip_windows(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """Drop malformed model clips before selection, alignment, logging, or rendering."""
    result = dict(parsed)
    for key in ("candidateClips", "clipAnalysis"):
        clips = result.get(key)
        if not isinstance(clips, list):
            continue
        valid_clips = [clip for clip in clips if _has_valid_clip_window(clip)]
        dropped_count = len(clips) - len(valid_clips)
        if dropped_count:
            print(f"Warning: Dropped {dropped_count} invalid clip window(s) from {key}.")
        result[key] = valid_clips
    return result


def _refresh_clip_visual_prompts(
    parsed: Dict[str, Any], segments: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Replace missing/generic podcast visuals with metaphors based on spoken content."""
    result = dict(parsed)
    for key in ("candidateClips", "clipAnalysis"):
        clips = result.get(key)
        if not isinstance(clips, list):
            continue
        refreshed = []
        for clip in clips:
            if not isinstance(clip, dict):
                refreshed.append(clip)
                continue
            try:
                start = float(clip.get("start", 0.0))
                end = float(clip.get("end", start))
            except (TypeError, ValueError):
                refreshed.append(clip)
                continue
            if not math.isfinite(start) or not math.isfinite(end):
                refreshed.append(clip)
                continue
            context = spoken_context_for_clip(segments, start, end)
            updated = dict(clip)
            updated["imagePrompt"] = normalize_clip_image_prompt(updated, context)
            refreshed.append(updated)
        result[key] = refreshed
    return result


def _pick_random_clips(parsed: Dict[str, Any]) -> Dict[str, Any]:
    """If candidateClips exists but clipAnalysis is empty, pick up to 3, prioritizing laughter clips."""
    candidates = parsed.get("candidateClips", [])
    if not candidates or parsed.get("clipAnalysis"):
        return parsed
    result = {**parsed}
    count = min(3, len(candidates))
    laugh_candidates = [c for c in candidates if c.get("source") == "laughter_audio"]
    other_candidates = [c for c in candidates if c.get("source") != "laughter_audio"]

    selected = random.sample(laugh_candidates, min(count, len(laugh_candidates)))
    remaining = count - len(selected)
    if remaining > 0:
        selected.extend(random.sample(other_candidates, min(remaining, len(other_candidates))))

    result["clipAnalysis"] = selected
    return result


def _log_candidate_summary(parsed: Dict[str, Any], episode_name: str) -> None:
    """Print a human-readable summary of candidate clips for review."""
    candidates = parsed.get("candidateClips", [])
    if not candidates:
        return
    
    laugh_candidates = [c for c in candidates if c.get("source") == "laughter_audio"]
    text_candidates = [c for c in candidates if c.get("source") != "laughter_audio"]
    
    print(f"\n  Candidate clips for {episode_name} ({len(candidates)} found):")
    print(f"    🎬 From content analysis: {len(text_candidates)}")
    print(f"    🎉 From audio laughter detection: {len(laugh_candidates)}")
    print()
    
    for i, clip in enumerate(candidates, 1):
        start = _fmt(float(clip.get("start", 0)))
        end = _fmt(float(clip.get("end", 0)))
        headline = clip.get("headline", "?")
        source = "🎉" if clip.get("source") == "laughter_audio" else "  "
        print(f"    {source} {i:02d}. [{start} \u2192 {end}] {headline}")
    
    selected = parsed.get("clipAnalysis", [])
    if selected:
        print(f"\n  Randomly selected for rendering ({len(selected)}):")
        for i, clip in enumerate(selected, 1):
            start = _fmt(float(clip.get("start", 0)))
            end = _fmt(float(clip.get("end", 0)))
            headline = clip.get("headline", "?")
            source = "🎉" if clip.get("source") == "laughter_audio" else "  "
            print(f"    {source} {i:02d}. [{start} \u2192 {end}] {headline}")
    print()


def _seo_output_path(config: Dict[str, Any], episode_name: str) -> Path:
    seo_dir = Path(config.get("paths", {}).get("output_dir", "./output")) / "seo"
    seo_dir = seo_dir.expanduser().resolve()
    seo_dir.mkdir(parents=True, exist_ok=True)
    return seo_dir / f"{episode_name}.seo.json"


def _prepare_cowork_seo(cowork: Dict[str, Any], segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalize a validated Cowork SEO file through the same post-processing as model output.

    Cowork reads the whole transcript and cuts clips on segment boundaries, so
    no timestamp re-alignment is needed.
    """
    parsed = _normalize_seo(cowork)
    parsed = _filter_invalid_clip_windows(parsed)
    parsed = _pick_random_clips(parsed)
    parsed = _refresh_clip_visual_prompts(parsed, segments)
    for warning in cowork_handoff.seo_warnings(parsed):
        print(f"Warning (Cowork SEO): {warning}")
    return parsed


def run(context: dict) -> None:
    transcript_path = context.get("transcript_path")
    if not transcript_path:
        raise RuntimeError("Parser stage requires transcript_path in context")

    transcript_file = Path(transcript_path)
    if not transcript_file.is_file():
        raise FileNotFoundError(f"Transcript not found: {transcript_file}")

    segments = _load_transcript(transcript_file)
    episode_name = Path(context.get("episode_path", transcript_file.stem)).stem
    config = context.get("config", {})

    cowork_seo = cowork_handoff.load_seo(config, episode_name, segments=segments)
    if cowork_seo is None:
        raise cowork_handoff.AwaitingCowork(
            episode_name, "parse", cowork_handoff.seo_path(config, episode_name)
        )

    print(f"Using Cowork SEO/clip analysis: {cowork_handoff.seo_path(config, episode_name)}")
    parsed = _prepare_cowork_seo(cowork_seo, segments)
    _log_candidate_summary(parsed, episode_name)
    seo_path = _seo_output_path(config, episode_name)
    with seo_path.open("w") as f:
        json.dump(parsed, f, indent=2)
    print(f"SEO JSON written to {seo_path}")
    context["seo_path"] = str(seo_path)
