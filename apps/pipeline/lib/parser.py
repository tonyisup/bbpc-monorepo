"""Parser stage – generates SEO-friendly summaries from transcripts."""
from __future__ import annotations

import json
import math
import random
import re
import time
from pathlib import Path
from typing import Any, Dict, List, cast

from openai import APIConnectionError, APITimeoutError, OpenAI

from lib.runtime_config import (
    resolve_llm_request_timeout,
    resolve_pipeline_llm_endpoints,
    resolve_seo_llm_model_name,
)
from lib import cowork_handoff
from lib.visual_prompts import normalize_clip_image_prompt, spoken_context_for_clip

MAX_PROMPT_CHARS = 18000
MAX_TRANSCRIPT_LINES = 1400
NUM_STRATA = 4  # quartiles for distributed sampling

# Clip duration bounds (seconds)
CLIP_MIN_DURATION = 20
CLIP_MAX_DURATION = 90
ALIGNMENT_WINDOW_SEGMENTS = 8
ALIGNMENT_SCORE_THRESHOLD = 0.45
DEFAULT_SEO_CLIP_OUTPUT_TOKENS = 4096
DEFAULT_SEO_METADATA_OUTPUT_TOKENS = 1200
_SEO_CLIP_SECTIONS = {"highlights", "clipAnalysis", "candidateClips"}

_ALIGNMENT_STOPWORDS = {
    "a", "an", "and", "are", "at", "be", "bro", "brother", "but", "for", "from",
    "got", "had", "has", "have", "he", "her", "him", "his", "i", "if", "in", "is",
    "it", "its", "just", "like", "look", "man", "me", "my", "of", "oh", "on", "or",
    "so", "that", "the", "them", "there", "they", "this", "to", "was", "we", "were",
    "what", "when", "with", "yo", "you", "your",
}

# Full SEO object shape (see _prepare_prompt). Order preserved for stable output.
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


def _is_section_empty(key: str, value: Any) -> bool:
    if key in ("title", "metaDescription", "callToAction"):
        return not (isinstance(value, str) and value.strip())
    if key in ("keywords", "highlights", "clipAnalysis", "candidateClips", "notableWorks"):
        return not (isinstance(value, list) and len(value) > 0)
    return True


def _missing_seo_sections(data: Dict[str, Any]) -> List[str]:
    return [k for k in _SEO_KEYS if _is_section_empty(k, data.get(k))]


def _schema_fragment_for_keys(keys: List[str]) -> str:
    """JSON schema snippets for a subset of keys (prompt text)."""
    fragments: List[str] = []
    for key in keys:
        if key == "title":
            fragments.append('  "title": "<60 character SEO title>"')
        elif key == "metaDescription":
            fragments.append('  "metaDescription": "~160 character SERP-friendly summary"')
        elif key == "keywords":
            fragments.append('  "keywords": ["comma separated", "phrases", "ranked by intent"]')
        elif key == "highlights":
            fragments.append(
                '  "highlights": [\n'
                '     {"start": "HH:MM:SS", "end": "HH:MM:SS", "headline": "", "summary": ""},\n'
                "     ... 3-5 entries total ...\n"
                "  ]"
            )
        elif key == "clipAnalysis":
            fragments.append(
                '  "clipAnalysis": [\n'
                "     {\n"
                '       "start": 0.0,\n'
                '       "end": 0.0,\n'
                '       "headline": "High-impact hook for TikTok",\n'
                '       "imagePrompt": "Abstract cinematic visual metaphor specific to what is spoken: symbolic objects, surreal setting, mood, lighting, and palette; never people podcasting or a recording studio; no readable text.",\n'
                '       "why": "Reasoning for picking this segment"\n'
                "     }\n"
                "     ... exactly 3 clips, randomly selected from candidateClips ...\n"
                "  ]"
            )
        elif key == "candidateClips":
            fragments.append(
                '  "candidateClips": [\n'
                "     {\n"
                '       "start": 0.0,\n'
                '       "end": 0.0,\n'
                '       "headline": "High-impact hook for TikTok",\n'
                '       "imagePrompt": "Abstract cinematic visual metaphor specific to what is spoken: symbolic objects, surreal setting, mood, lighting, and palette; never people podcasting or a recording studio; no readable text.",\n'
                '       "why": "Reasoning this segment is clip-worthy"\n'
                "     },\n"
                "     ... exactly 20 candidates covering the most engaging, funny, or controversial moments ...\n"
                "  ]"
            )
        elif key == "notableWorks":
            fragments.append('  "notableWorks": ["Movie/Show names mentioned"]')
        elif key == "callToAction":
            fragments.append('  "callToAction": "Engaging CTA pushing to Spotify or newsletter"')
    return ",\n".join(fragments)


def _select_stratified_segments(
    segments: List[Dict[str, Any]],
    num_strata: int = NUM_STRATA,
    max_lines: int = MAX_TRANSCRIPT_LINES,
    max_chars: int = MAX_PROMPT_CHARS,
) -> str:
    """Select segments distributed evenly across the full episode timeline.
    
    Divides the episode into equal time quartiles, then samples from each.
    This forces the LLM to see content from the entire episode, not just the beginning.
    """
    if not segments:
        return ""
    
    total = len(segments)
    lines_per_stratum = max_lines // num_strata
    chars_per_stratum = max_chars // num_strata
    
    strata: List[str] = []
    
    for i in range(num_strata):
        start_idx = (i * total) // num_strata
        end_idx = ((i + 1) * total) // num_strata
        stratum_segments = segments[start_idx:end_idx]
        
        label = _fmt(float(stratum_segments[0].get("start", 0))) if stratum_segments else "??:??:??"
        end_label = _fmt(float(stratum_segments[-1].get("end", 0))) if stratum_segments else "??:??:??"
        header = f"\n=== SEGMENT [{label} → {end_label}] (Part {i+1}/{num_strata}) ===\n"
        
        selected: List[str] = []
        total_chars = 0
        
        # If stratum has few segments, take them all
        if len(stratum_segments) <= lines_per_stratum:
            for seg in stratum_segments:
                if not seg.get("text"):
                    continue
                timestamp = _format_seconds(seg.get("start", 0.0))
                line = f"[{timestamp}] {seg['text'].strip()}"
                selected.append(line)
                total_chars += len(line)
                if total_chars >= chars_per_stratum:
                    break
        else:
            # Sample evenly from within the stratum
            step = len(stratum_segments) / lines_per_stratum
            for j in range(lines_per_stratum):
                idx = int(j * step)
                if idx >= len(stratum_segments):
                    break
                seg = stratum_segments[idx]
                if not seg.get("text"):
                    continue
                timestamp = _format_seconds(seg.get("start", 0.0))
                line = f"[{timestamp}] {seg['text'].strip()}"
                selected.append(line)
                total_chars += len(line)
                if total_chars >= chars_per_stratum:
                    break
        
        strata.append(header + "\n".join(selected))
    
    return "\n".join(strata)


def _prepare_patch_prompt(
    segments: List[Dict[str, Any]],
    episode_name: str,
    existing: Dict[str, Any],
    missing_keys: List[str],
    likely_reviewed_movies: List[str] | None = None,
) -> str:
    """Ask the model only for the missing top-level keys, using transcript + partial JSON."""
    transcript_text = _select_stratified_segments(segments)

    schema = _schema_fragment_for_keys(missing_keys)
    existing_json = json.dumps(existing, indent=2, ensure_ascii=False)
    keys_json = json.dumps(missing_keys)
    movie_context = _likely_reviewed_movies_section(likely_reviewed_movies)

    prompt = f"""
You are an SEO editor for a cult-classic movie podcast called BBPC.
Below is partial SEO metadata for episode {episode_name} (JSON), then transcript lines.
The transcript is distributed across the full episode — you'll see segments marked [Part 1/4], [Part 2/4], etc.
Produce a single JSON object that includes ONLY these keys (no other top-level keys): {keys_json}.
Use this structure for those keys:

{{
{schema}
}}

Rules:
- Copy or align with non-requested fields only when helpful; your output must contain exactly the requested keys.
- For "candidateClips", find exactly 20 potential clip candidates (each 20-90 seconds) that are self-contained, funny, or controversial; use raw float seconds for "start"/"end" matching [HH:MM:SS] in the transcript.
- CRITICAL: Distribute your 20 candidates ACROSS the full episode — aim for ~5 from each time segment. Do NOT cluster all candidates in the first 15 minutes.
- For "clipAnalysis", randomly pick exactly 3 entries from candidateClips.
- For "highlights", use "HH:MM:SS" strings for start/end.
- For every "imagePrompt": create a distinct abstract visual metaphor for the specific topic and meaning spoken in that clip. Favor symbolic objects, surreal environments, texture, light, color, and motion. Never default to people podcasting, hosts, recording studios, microphones, or headphones. Include no readable text, titles, episode numbers, or typography; subtitles are added in post.

Partial existing JSON:
{existing_json}
{movie_context}

Transcript excerpts (distributed across the full episode):
{transcript_text}
"""
    return prompt.strip()


def _format_seconds(total_seconds: float) -> str:
    total_seconds = int(total_seconds)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def _fmt(s: float) -> str:
    """Abbreviated timestamp for section headers."""
    s = int(s)
    h, rem = divmod(s, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _load_transcript(transcript_path: Path) -> List[Dict[str, Any]]:
    with transcript_path.open() as f:
        return json.load(f)


def _normalize_alignment_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9\s]+", " ", str(value or "").lower()).strip()


def _alignment_tokens(value: Any) -> List[str]:
    tokens = [t for t in _normalize_alignment_text(value).split() if len(t) >= 4 and t not in _ALIGNMENT_STOPWORDS]
    return tokens


def _align_clip_bounds_to_transcript(clip: Dict[str, Any], segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Snap quoted clip moments back onto transcript time if the LLM picked the wrong offset."""
    if not isinstance(clip, dict) or clip.get("source") == "laughter_audio":
        return clip
    if not segments:
        return clip

    headline_tokens = _alignment_tokens(clip.get("headline", ""))
    if len(headline_tokens) < 2:
        return clip

    best_score = 0.0
    best_start: float | None = None
    for idx, segment in enumerate(segments):
        segment_norm = _normalize_alignment_text(segment.get("text", ""))
        if not segment_norm:
            continue
        segment_matches = sum(1 for token in headline_tokens if token in segment_norm)
        if segment_matches == 0:
            continue
        window = segments[idx: idx + ALIGNMENT_WINDOW_SEGMENTS]
        window_text = " ".join(str(part.get("text", "")) for part in window)
        window_norm = _normalize_alignment_text(window_text)
        if not window_norm:
            continue
        matched = sum(1 for token in headline_tokens if token in window_norm)
        coverage = matched / max(len(headline_tokens), 1)
        if coverage <= 0:
            continue
        phrase_bonus = 0.0
        headline_norm = _normalize_alignment_text(clip.get("headline", ""))
        if headline_norm and headline_norm[:48] in window_norm:
            phrase_bonus = 0.2
        score = coverage + phrase_bonus
        if score > best_score:
            best_score = score
            best_start = float(segment.get("start", 0.0))

    if best_start is None or best_score < ALIGNMENT_SCORE_THRESHOLD:
        return clip

    current_start = float(clip.get("start", 0.0))
    current_end = float(clip.get("end", current_start))
    duration = max(CLIP_MIN_DURATION, min(CLIP_MAX_DURATION, current_end - current_start))
    if abs(best_start - current_start) < 15.0:
        return clip

    updated = dict(clip)
    updated["start"] = round(best_start, 2)
    updated["end"] = round(best_start + duration, 2)
    updated["_autoAlignedFrom"] = round(current_start, 2)
    return updated


def _align_generated_clips_to_transcript(parsed: Dict[str, Any], segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    result = dict(parsed)
    for key in ("candidateClips", "clipAnalysis"):
        clips = result.get(key)
        if not isinstance(clips, list):
            continue
        result[key] = [_align_clip_bounds_to_transcript(clip, segments) for clip in clips]
    return result


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


def _likely_reviewed_movies_section(likely_reviewed_movies: List[str] | None) -> str:
    if not likely_reviewed_movies:
        return ""
    return "\nReviewed movies (from Convex + transcript): " + ", ".join(likely_reviewed_movies)


def _format_db_episode_movies(db_movies: list) -> List[str]:
    """Format canonical episode movies for the SEO prompt."""
    if not db_movies:
        return []

    # Group by assignment type
    by_type: dict[str, list[str]] = {}
    for em in db_movies:
        if hasattr(em, 'assignment_type'):
            atype = em.assignment_type or "reviewed"
            title = em.title
            year = em.year
        else:
            atype = em.get("assignment_type") or "reviewed"
            title = em.get("title", "")
            year = em.get("year")
        label = f"{title} ({year})" if year else title
        by_type.setdefault(atype, []).append(label)

    # Format: "HOMEWORK: Anora (2024); EXTRA_CREDIT: Baby Boy (2001)"
    sections = []
    for atype in ("HOMEWORK", "EXTRA_CREDIT", "BONUS", "reviewed"):
        if atype in by_type:
            sections.append(f"{atype}: {', '.join(by_type[atype])}")

    # Flatten to a single list for the existing prompt format
    all_labels = []
    for labels in by_type.values():
        all_labels.extend(labels)
    return all_labels


def _load_likely_reviewed_movies(context: Dict[str, Any], transcript_file: Path) -> List[str]:
    # Priority 1: Convex relationships passed from movie_extractor.
    db_movies = context.get("db_episode_movies", [])
    if db_movies:
        return _format_db_episode_movies(db_movies)

    # Priority 2: legacy pre-resolved context supplied by callers.
    db_reviewed = context.get("db_reviewed_movies", [])
    if db_reviewed:
        return db_reviewed

    # Priority 3: Fall back to movie extraction JSON artifact
    configured_path = context.get("movie_extraction_path")
    config = context.get("config", {})
    if configured_path:
        candidate_paths = [Path(configured_path)]
    else:
        movie_dir = (
            Path(config.get("paths", {}).get("movie_extractions_dir", "./output/movies"))
            .expanduser()
            .resolve()
        )
        candidate_paths = [movie_dir / f"{transcript_file.stem}.movies.json"]

    for path in candidate_paths:
        if not path.is_file():
            continue
        try:
            with path.open() as f:
                payload = json.load(f)
        except Exception:
            continue
        movies = payload.get("movies", [])
        if not isinstance(movies, list):
            continue
        labels: List[str] = []
        for movie in movies:
            if not isinstance(movie, dict):
                continue
            title = str(movie.get("title", "")).strip()
            if not title:
                continue
            year = movie.get("year")
            labels.append(f"{title} ({year})" if year else title)
        if labels:
            return labels
    return []


def _prepare_prompt(
    segments: List[Dict[str, Any]],
    episode_name: str,
    laughter_clips: List[Dict[str, Any]] | None = None,
    likely_reviewed_movies: List[str] | None = None,
) -> str:
    transcript_text = _select_stratified_segments(segments)

    laugh_section = ""
    if laughter_clips:
        laugh_lines = []
        for c in laughter_clips:
            start = _fmt(float(c.get("start", 0)))
            end = _fmt(float(c.get("end", 0)))
            laugh_lines.append(f'  - [{start} → {end}] {c.get("headline", "")}')
        laugh_section = "\n🎉 Audio-based laughter moments detected (include these in your candidates):\n" + "\n".join(laugh_lines)
    movie_section = _likely_reviewed_movies_section(likely_reviewed_movies)

    prompt = f"""
You are an SEO editor for a cult-classic movie podcast called BBPC.
Given the raw transcript snippets below, produce a JSON object with the
following structure (and no extra commentary):

{{
  "title": "<60 character SEO title>",
  "metaDescription": "~160 character SERP-friendly summary",
  "keywords": ["comma separated", "phrases", "ranked by intent"],
  "highlights": [
     {{"start": "HH:MM:SS", "end": "HH:MM:SS", "headline": "", "summary": ""}},
     ... 3-5 entries total ...
  ],
  "candidateClips": [
     {{
       "start": 0.0,
       "end": 0.0,
       "headline": "High-impact hook for TikTok",
       "imagePrompt": "Abstract cinematic visual metaphor specific to what is spoken: symbolic objects, surreal setting, mood, lighting, and palette; never people podcasting or a recording studio; no readable text.",
       "why": "Reasoning this segment is clip-worthy"
     }}
     ... exactly 20 candidates total, each 20-90s ...
  ],
  "clipAnalysis": [
     {{
       "start": 0.0,
       "end": 0.0,
       "headline": "High-impact hook for TikTok",
       "imagePrompt": "Abstract cinematic visual metaphor specific to what is spoken: symbolic objects, surreal setting, mood, lighting, and palette; never people podcasting or a recording studio; no readable text.",
       "why": "Reasoning for picking this segment"
     }}
     ... exactly 3 clips, randomly chosen from candidateClips ...
  ],
  "notableWorks": ["Movie/Show names mentioned"],
  "callToAction": "Engaging CTA pushing to Spotify or newsletter"
}}

Instructions:
1. "candidateClips": Find exactly 20 potential clip candidates (each 20-90 seconds) that are self-contained, funny, or controversial. Provide raw float timestamps (seconds) based on the [HH:MM:SS] markers provided.
2. ⚠️ CRITICAL DISTRIBUTION REQUIREMENT: The transcript is divided into [Part 1], [Part 2], [Part 3], [Part 4] spanning the FULL episode. You MUST distribute your 20 candidates across ALL parts — aim for roughly 5 candidates from each part. Do NOT cluster all candidates in the beginning.
3. "clipAnalysis": Randomly pick exactly 3 entries from candidateClips.{laugh_section}
4. For "highlights", use "HH:MM:SS" strings for start/end.
5. For every "imagePrompt" in candidateClips and clipAnalysis: create a distinct abstract cinematic visual metaphor for the specific topic and meaning spoken in that exact clip. Favor symbolic objects, surreal environments, texture, light, color, and motion. Never default to people podcasting, hosts, recording studios, microphones, or headphones. Prefer no people unless a human presence is essential to the subject. Never ask for posters, title cards, episode numbers, captions, logos, or readable words—the subtitles are added in post.

Transcript excerpts for episode {episode_name} (distributed across the full runtime):
{movie_section}
{transcript_text}
"""
    return prompt.strip()


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


def _build_client(config: Dict[str, Any]) -> OpenAI:
    settings = config.get("settings") if isinstance(config.get("settings"), dict) else {}
    base_url, api_key = resolve_pipeline_llm_endpoints(settings)
    timeout = resolve_llm_request_timeout(settings, operation="seo")
    return OpenAI(base_url=base_url, api_key=api_key, timeout=timeout, max_retries=0)


def _is_retryable_llm_error(exc: Exception) -> bool:
    return isinstance(exc, (APITimeoutError, APIConnectionError))


def _call_model(
    client: OpenAI,
    prompt: str,
    model: str,
    *,
    max_output_tokens: int = DEFAULT_SEO_METADATA_OUTPUT_TOKENS,
    reasoning_effort: str | None = None,
) -> str:
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            request: Dict[str, Any] = {
                "model": model,
                "temperature": 0.35,
                "max_tokens": max_output_tokens,
                "messages": [
                    {"role": "system", "content": "Respond with strict JSON only."},
                    {"role": "user", "content": prompt},
                ],
            }
            if reasoning_effort:
                request["reasoning_effort"] = reasoning_effort
            response = client.chat.completions.create(**request)
            choices = getattr(response, "choices", None) or []
            if not choices:
                raise RuntimeError(
                    f"Chat completion returned no choices for model={model!r}. "
                    "The LLM server may be rate-limiting, the model may be unavailable, or the response was empty."
                )
            first = choices[0]
            message = getattr(first, "message", None)
            if message is None:
                fr = getattr(first, "finish_reason", None)
                raise RuntimeError(
                    f"Chat completion missing message for model={model!r} (finish_reason={fr!r})."
                )
            content = getattr(message, "content", None)
            if content:
                return content
            finish_reason = getattr(first, "finish_reason", None)
            if finish_reason == "length":
                raise RuntimeError(
                    f"Chat completion exhausted max_output_tokens={max_output_tokens} for model={model!r} "
                    "before emitting JSON (finish_reason='length'). Increase settings.seo_max_output_tokens "
                    "or reduce the requested payload."
                )
            raise RuntimeError(
                f"Chat completion returned empty content for model={model!r} "
                f"(finish_reason={finish_reason!r})."
            )
        except Exception as exc:
            if not _is_retryable_llm_error(exc) or attempt >= max_attempts:
                raise
            delay_seconds = float(attempt * 2)
            print(
                f"  LLM request failed ({type(exc).__name__}) on attempt "
                f"{attempt}/{max_attempts}; retrying in {delay_seconds:.0f}s..."
            )
            time.sleep(delay_seconds)
    raise RuntimeError(f"Chat completion failed unexpectedly for model={model!r}.")


def _parse_model_json(raw_output: str) -> Dict[str, Any]:
    clean_output = raw_output.strip()
    if clean_output.startswith("```"):
        clean_output = clean_output.split("```")[1]
        if clean_output.startswith("json"):
            clean_output = clean_output[4:]
        clean_output = clean_output.strip()
    try:
        out = json.loads(clean_output)
        return out if isinstance(out, dict) else {}
    except json.JSONDecodeError:
        return {}


def _resolve_seo_output_token_budget(settings: Dict[str, Any], missing: List[str]) -> int:
    """Use the configured budget only when the response must include clip payloads."""
    if not _SEO_CLIP_SECTIONS.intersection(missing):
        return DEFAULT_SEO_METADATA_OUTPUT_TOKENS
    configured = settings.get("seo_max_output_tokens", DEFAULT_SEO_CLIP_OUTPUT_TOKENS)
    try:
        parsed = int(configured)
    except (TypeError, ValueError):
        return DEFAULT_SEO_CLIP_OUTPUT_TOKENS
    return parsed if parsed > 0 else DEFAULT_SEO_CLIP_OUTPUT_TOKENS


def _merge_seo_patch(base: Dict[str, Any], patch: Dict[str, Any], keys: List[str]) -> Dict[str, Any]:
    merged = {**base}
    for key in keys:
        if key in patch and not _is_section_empty(key, patch[key]):
            merged[key] = patch[key]
    return merged


def _seo_output_path(config: Dict[str, Any], episode_name: str) -> Path:
    seo_dir = Path(config.get("paths", {}).get("output_dir", "./output")) / "seo"
    seo_dir = seo_dir.expanduser().resolve()
    seo_dir.mkdir(parents=True, exist_ok=True)
    return seo_dir / f"{episode_name}.seo.json"


def _prepare_cowork_seo(cowork: Dict[str, Any], segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalize a validated Cowork SEO file through the same post-processing as model output.

    Cowork reads the whole transcript and cuts clips on segment boundaries, so
    transcript re-alignment (built for hallucinated model timestamps) is skipped.
    """
    parsed = _normalize_seo(cowork)
    parsed = _filter_invalid_clip_windows(parsed)
    parsed = _pick_random_clips(parsed)
    parsed = _refresh_clip_visual_prompts(parsed, segments)
    for warning in cowork_handoff.clip_duration_warnings(parsed):
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
    likely_reviewed_movies = _load_likely_reviewed_movies(context, transcript_file)

    config = context.get("config", {})

    cowork_mode = cowork_handoff.resolve_mode(config, context)
    if cowork_mode != "off":
        duration = max((float(seg.get("end", 0.0)) for seg in segments), default=None)
        cowork_seo = cowork_handoff.load_seo(config, episode_name, duration)
        if cowork_seo is not None:
            print(f"Using Cowork SEO/clip analysis: {cowork_handoff.seo_path(config, episode_name)}")
            parsed = _prepare_cowork_seo(cowork_seo, segments)
            _log_candidate_summary(parsed, episode_name)
            seo_path = _seo_output_path(config, episode_name)
            with seo_path.open("w") as f:
                json.dump(parsed, f, indent=2)
            print(f"SEO JSON written to {seo_path}")
            context["seo_path"] = str(seo_path)
            return
        if cowork_mode == "require":
            raise cowork_handoff.AwaitingCowork(
                episode_name, "parse", cowork_handoff.seo_path(config, episode_name)
            )

    # Audio-based laughter detection
    episode_audio = context.get("episode_audio") or context.get("episode_path")
    laughter_clips = []
    laughter_params: Dict[str, Any] | None = None
    tuned_params_path = (
        Path(config.get("paths", {}).get("output_dir", "./output")).expanduser().resolve()
        / "laughter"
        / "best_params.json"
    )
    if tuned_params_path.is_file():
        try:
            with tuned_params_path.open() as f:
                tuned_payload = json.load(f)
            if isinstance(tuned_payload, dict):
                if isinstance(tuned_payload.get("params"), dict):
                    laughter_params = tuned_payload["params"]
                else:
                    laughter_params = tuned_payload
        except Exception as e:
            print(f"  Could not load tuned laughter params ({tuned_params_path}): {e}")

    if episode_audio:
        try:
            print(f"\n  🔍 Detecting laughter moments from audio...")
            from lib import laughter_detector
            laughter_clips = laughter_detector.detect_laughter(
                audio_path=episode_audio,
                max_detections=10,
                params=laughter_params,
                collect_diagnostics=True,
            )
            print(f"  Found {len(laughter_clips)} laughter moments.")
            if laughter_clips and isinstance(laughter_clips[0].get("_laughterDiagnostics"), list):
                laughter_diag = laughter_clips[0]["_laughterDiagnostics"]
                diag_text = ", ".join(
                    f"pass{d.get('pass')}={d.get('detections')}" for d in laughter_diag
                )
                print(f"  Laughter pass diagnostics: {diag_text}")
                for clip in laughter_clips:
                    clip.pop("_laughterDiagnostics", None)
        except Exception as e:
            print(f"  Laughter detection skipped: {e}")
    else:
        print(f"  Laughter detection skipped (no episode_audio in context)")

    seo_path = _seo_output_path(config, episode_name)

    if seo_path.is_file():
        with seo_path.open() as f:
            parsed = json.load(f)
        print(f"Loaded SEO JSON: {seo_path}")
    else:
        parsed = {}

    parsed = _normalize_seo(parsed)
    missing = _missing_seo_sections(parsed)

    settings = config.get("settings", {})
    settings = settings if isinstance(settings, dict) else {}
    model_name = resolve_seo_llm_model_name(settings)
    reasoning_effort = str(settings.get("seo_reasoning_effort") or "").strip() or None
    client = _build_client(config)
    dirty = False
    attempts = 0
    max_attempts = 3

    while missing and attempts < max_attempts:
        attempts += 1
        dirty = True
        if len(missing) == len(_SEO_KEYS):
            prompt = _prepare_prompt(
                segments,
                episode_name,
                laughter_clips if laughter_clips else None,
                likely_reviewed_movies,
            )
            max_tokens = _resolve_seo_output_token_budget(settings, missing)
        else:
            prompt = _prepare_patch_prompt(
                segments,
                episode_name,
                parsed,
                missing,
                likely_reviewed_movies,
            )
            max_tokens = _resolve_seo_output_token_budget(settings, missing)

        raw_output = _call_model(
            client,
            prompt,
            model_name,
            max_output_tokens=max_tokens,
            reasoning_effort=reasoning_effort,
        )
        patch = _parse_model_json(raw_output)
        if not patch:
            print(
                f"Warning: Could not parse model output as JSON (attempt {attempts}). "
                f"Preview: {raw_output[:200]}..."
            )
            continue
        parsed = _merge_seo_patch(parsed, patch, missing)
        parsed = _normalize_seo(parsed)
        missing = _missing_seo_sections(parsed)

    # Inject laughter clips into candidateClips if they're missing from LLM output
    if laughter_clips:
        existing_candidates = parsed.get("candidateClips", [])
        # Deduplicate by start time
        existing_starts = {float(c.get("start", 0)) for c in existing_candidates}
        new_clips = [c for c in laughter_clips if float(c.get("start", 0)) not in existing_starts]
        if new_clips:
            # Take up to 5 laughs, replace weakest if needed to keep total at 20
            target_total = 20
            laugh_to_add = new_clips[:5]
            combined = existing_candidates + laugh_to_add
            if len(combined) > target_total:
                # Remove some text candidates to make room for laughs
                text_candidates = [c for c in combined if c.get("source") != "laughter_audio"]
                laugh_candidates = [c for c in combined if c.get("source") == "laughter_audio"]
                keep_text = target_total - len(laugh_candidates)
                combined = text_candidates[:keep_text] + laugh_candidates
            parsed["candidateClips"] = combined
            dirty = True

    parsed = _filter_invalid_clip_windows(parsed)

    # If we have candidates but no clipAnalysis, pick randomly
    parsed = _pick_random_clips(parsed)
    parsed = _align_generated_clips_to_transcript(parsed, segments)
    parsed = _refresh_clip_visual_prompts(parsed, segments)
    dirty = True

    # Log candidate clips for human review
    _log_candidate_summary(parsed, episode_name)

    if missing:
        print(
            f"Warning: SEO JSON still missing sections after {max_attempts} attempt(s): {missing}"
        )

    if dirty:
        with seo_path.open("w") as f:
            json.dump(parsed, f, indent=2)
        print(f"SEO JSON written to {seo_path}")
    else:
        print(f"SEO JSON complete (no changes): {seo_path}")

    context["seo_path"] = str(seo_path)
