"""Shared rules for content-led clip imagery."""
from __future__ import annotations

import re
from typing import Any, Dict, List


GENERIC_PODCAST_PATTERNS = (
    r"\bpodcast(?:er|ers|ing)?\b",
    r"\b(?:recording|broadcast|audio|sound)\s+(?:studio|booth|room)\b",
    r"\b(?:microphone|microphones|mic|mics)\b",
    r"\bboom arms?\b",
    r"\bheadphones?\b",
    r"\bmixing console\b",
    r"\b(?:radio show|control room|soundboard|studio gear)\b",
    r"\b(?:host|hosts|presenter|presenters)\b.*\b(?:talk(?:ing)?|laugh(?:ing)?|speak(?:ing)?)\b",
)

ABSTRACT_VISUAL_GUARDRAIL = (
    "Make the imagery an abstract, cinematic visual metaphor for the specific subject being spoken about. "
    "Favor symbolic objects, surreal environments, texture, light, color, and motion. Never depict people "
    "podcasting, hosts talking or laughing, a recording studio, microphones, boom arms, or headphones."
)


def looks_like_generic_podcast_imagery(prompt: str) -> bool:
    """Return whether a prompt falls back to generic podcast production imagery."""
    normalized = " ".join((prompt or "").lower().split())
    return any(re.search(pattern, normalized) for pattern in GENERIC_PODCAST_PATTERNS)


def spoken_context_for_clip(
    segments: List[Dict[str, Any]],
    start: float,
    end: float,
    *,
    max_chars: int = 420,
) -> str:
    """Collect a compact transcript excerpt overlapping a clip window."""
    parts: List[str] = []
    for segment in segments:
        seg_start = float(segment.get("start", 0.0))
        seg_end = float(segment.get("end", seg_start))
        if seg_end <= start or seg_start >= end:
            continue
        text = re.sub(r"\s+", " ", str(segment.get("text", ""))).strip()
        if text:
            parts.append(text)

    context = " ".join(parts).strip()
    max_chars = max(int(max_chars), 0)
    if len(context) <= max_chars:
        return context
    if max_chars == 0:
        return ""
    if max_chars == 1:
        return "…"
    prefix = context[: max_chars - 1]
    shortened = prefix.rsplit(" ", 1)[0] if " " in prefix else prefix
    shortened = shortened.rstrip(" ,.;:-")
    return f"{shortened}…"


def build_content_metaphor_prompt(context: str) -> str:
    """Turn spoken context into an image prompt without visualizing the speakers."""
    context = re.sub(r"\s+", " ", context or "").strip()
    if not context:
        context = "the emotional idea and tension in the clip"
    return (
        "Create an abstract cinematic visual metaphor inspired by this spoken passage: "
        f"{context}. Translate the meaning into symbolic objects, a surreal environment, "
        "expressive lighting, color, texture, and motion; do not show the speakers or render the quoted words."
    )


def normalize_clip_image_prompt(clip: Dict[str, Any], spoken_context: str = "") -> str:
    """Keep specific prompts, replacing generic podcast imagery with content-led art."""
    current = str(clip.get("imagePrompt") or "").strip()
    if current and not looks_like_generic_podcast_imagery(current):
        return current

    context = spoken_context.strip()
    if not context:
        why = str(clip.get("why") or "").strip()
        if not why.lower().startswith("audio-laughter detected"):
            context = why
    return build_content_metaphor_prompt(context)
