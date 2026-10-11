"""Which clips the clip stage renders, and the file name each one gets.

Shared by ``lib/clipper.py`` (which writes the files) and
``lib/publish_log.py`` (which records what Tony did with them), so a clip
can be found again from the SEO file alone. Standard library only.
"""
from __future__ import annotations

from typing import Any, Dict, List, Sequence, Tuple

DEFAULT_MIN_CLIP_DURATION = 20.0


def slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "clip"


def clip_file_name(index: int, clip: Dict[str, Any]) -> str:
    """``NN-<headline-slug>.mp4``, numbered from 1 in render order."""
    return f"{index:02d}-{slugify(clip.get('headline') or f'clip-{index:02d}')}.mp4"


def min_clip_duration(config: Dict[str, Any]) -> float:
    return float(config.get("settings", {}).get("min_clip_duration_seconds", DEFAULT_MIN_CLIP_DURATION))


def renderable_clips(
    clips: Sequence[Dict[str, Any]],
    min_duration: float,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Split clips into (rendered, skipped-as-too-short), keeping order.

    Clips with a missing or backwards window are dropped from both lists.
    """
    kept: List[Dict[str, Any]] = []
    too_short: List[Dict[str, Any]] = []
    for clip in clips:
        start, end = clip.get("start"), clip.get("end")
        if start is None or end is None or float(end) <= float(start):
            continue
        if float(end) - float(start) < min_duration:
            too_short.append(clip)
            continue
        kept.append(clip)
    return kept, too_short
