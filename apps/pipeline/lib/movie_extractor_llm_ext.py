#!/usr/bin/env python3
"""LLM-based extraction for BBPC movie extractor."""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

lib_path = Path(__file__).parent
if str(lib_path) not in sys.path:
    sys.path.insert(0, str(lib_path))

import movie_extractor
import runtime_config
runtime_config._ensure_env_loaded()

_normalize_basic = movie_extractor._normalize_basic
_llm_available = movie_extractor._llm_available
resolve_pipeline_llm_endpoints = runtime_config.resolve_pipeline_llm_endpoints
from openai import OpenAI

LLM_MODULE_LOADED = True


def _build_prompt(episode_label, segments, catalog_size):
    """Build prompt for LLM extraction."""
    lines = []
    for i, w in enumerate(segments[:800]):
        try:
            if hasattr(w, 'get'):
                s, e, t = w.get('start', 0), w.get('end', 0), w.get('text', '')
            elif hasattr(w, 'start'):
                s, e, t = w.start, w.end, w.text
            elif isinstance(w, (list, tuple)) and len(w) >= 3:
                s, e = w[0], w[1]
                t = w[2] if len(w) > 2 else ""
            else:
                s, e = getattr(w, 'start', 0), getattr(w, 'end', 0)
                t = str(getattr(w, 'text', w) if w else "")
            if t:
                lines.append(f"[{float(s):.1f}-{float(e):.1f}] {t}")
        except:
            continue

    trans = "\n".join(lines)
    return "You are an assistant extracting reviewed movie titles from a podcast transcript.\n\nTask: Extract ALL movies that were REVIEWED on this episode. Output ONLY a JSON object with a \"movies\" array.\n\nEpisode: " + episode_label + "\nTranscript segments: " + str(len(lines)) + "\n\nTranscript (first 45 minutes):\n" + trans + "\n\nOutput Format (STRICT JSON - NO MARKDOWN):\n{\"movies\": [{\"title\": \"Movie Title\", \"confidence\": 0.9, \"evidence\": {\"start\": 123, \"end\": 456, \"context\": \"quote\"}}]}\n\nRules:\n1. Output ONLY this JSON - no explanations, no markdown, no emojis\n2. Use EXACT movie titles from the canonical catalog\n3. Be comprehensive - 5-8 movies typical\n4. Only include movies actually reviewed\n\nStart now with JSON only:"


def _build_llm_full_transcript_prompt(
    episode_label: str,
    episode_meta: Any,
    windows: list,
    catalog: list,
    *,
    chunk_index: int = 0,
    chunk_count: int = 1,
) -> str:
    """Build a chunked full-transcript prompt with indexed evidence windows.

    Each window is prefixed with ``[N]`` so the LLM can reference them by index
    in ``evidenceWindowIndices``.
    """
    episode_title = episode_meta.title if episode_meta else episode_label
    header = (
        "You are an assistant extracting reviewed movie titles from a BBPC podcast transcript.\n"
        f"Episode: {episode_title}\n"
    )
    if chunk_count > 1:
        header += f"Transcript chunk: {chunk_index + 1} of {chunk_count}\n"

    # Indexed evidence lines
    evidence_lines = []
    for i, w in enumerate(windows):
        evidence_lines.append(
            f"[{i}] {w.start:.2f}-{w.end:.2f} {w.text}"
        )

    catalog_hint = ""
    if catalog:
        titles = []
        for c in catalog:
            title = c.title if hasattr(c, 'title') else c.get("title", "")
            year = c.year if hasattr(c, 'year') else c.get("year")
            if title:
                titles.append(f"{title} ({year})" if year else title)
        if titles:
            catalog_hint = "\nKnown movies in the canonical catalog:\n" + "\n".join(f"  - {t}" for t in titles[:50])

    return (
        header
        + catalog_hint
        + "\n\nTranscript windows:\n"
        + "\n".join(evidence_lines)
        + "\n\n"
        "Return strict JSON only with this shape:\n"
        "{\n"
        '  "movies": [\n'
        '    {"title": "Movie Title", "confidence": 0.9, "evidenceWindowIndices": [0, 1]}\n'
        "  ],\n"
        '  "unmatchedTitles": [\n'
        '    {"title": "Raw Title", "confidence": 0.7, "evidenceWindowIndices": [5]}\n'
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "1. Output ONLY this JSON — no explanations, no markdown, no emojis.\n"
        "2. Only include movies actually reviewed on this episode.\n"
        "3. Reject future-release chatter, trailer/news mentions, and casual references.\n"
        "4. Use evidenceWindowIndices to reference transcript windows above.\n"
    )


def _extract_llm(episode_stem, episode_meta, segments, catalog, settings):
    """Pure LLM extraction."""
    if not LLM_MODULE_LOADED:
        return [], False

    if not _llm_available(settings):
        return [], False

    if not catalog or not segments:
        return [], False

    episode_label = episode_meta.title if episode_meta else episode_stem
    prompt = _build_prompt(episode_label, segments, len(catalog))

    try:
        base_url, api_key = resolve_pipeline_llm_endpoints(settings)
        client = OpenAI(base_url=base_url, api_key=api_key)
        response = client.chat.completions.create(
            model=settings.get("movie_extractor_model", "qwen/qwen3.5-flash-02-23"),
            temperature=0.0,
            max_tokens=2000,
            messages=[
                {"role": "system", "content": "Respond with JSON ONLY - no markdown."},
                {"role": "user", "content": prompt},
            ],
        )

        if not response or not response.choices or not response.choices[0]:
            print("  [LLM] No response from API")
            return [], True

        content = response.choices[0].message.content or ""
        clean = content.strip()
        clean = clean.replace("</think>", "").strip()

        if clean.startswith("```"):
            clean = clean.split("```", 1)[1].strip()
            if clean.startswith("json"):
                clean = clean[4:].strip()

        first_brace = clean.find("{")
        if first_brace >= 0:
            clean = clean[first_brace:]

        try:
            data = json.loads(clean)
            movies_list = data.get("movies", []) if isinstance(data, dict) else []
        except:
            return [], True

        if not isinstance(movies_list, list):
            return [], True

        # Build lookup
        catalog_by_norm = {}
        for c in catalog:
            if isinstance(c, dict):
                title, mid, year = c.get("title", ""), c.get("movie_id", ""), c.get("year")
            else:
                title, mid, year = c.title, c.movie_id, c.year
            catalog_by_norm[_normalize_basic(title)] = {"title": title, "movie_id": mid, "year": year}

        extracted = []
        seen = set()

        for item in movies_list:
            if not isinstance(item, dict):
                continue
            title = item.get("title", "")
            if not title:
                continue

            norm = _normalize_basic(title)
            if norm in seen:
                continue

            ci = catalog_by_norm.get(norm)
            if not ci:
                for nk, vc in catalog_by_norm.items():
                    if norm.startswith(nk) or nk.startswith(norm) or (len(norm) > 5 and norm in nk):
                        ci = vc
                        break

            if not ci:
                continue

            seen.add(norm)
            extracted.append({
                "matchedMovieId": ci["movie_id"],
                "title": ci["title"],
                "year": ci.get("year"),
                "confidence": min(1.0, max(0.0, float(item.get("confidence", 0.7)))),
                "status": "accepted",
                "signals": ["llm_full_transcript"],
                "evidence": [item.get("evidence", {})],
            })

        return extracted, True

    except Exception as e:
        print(f"LLM error: {e}")
        import traceback
        traceback.print_exc()
        return [], True


def llm_only_result(stem, episode_meta, windows, catalog, settings):
    """LLM-only extraction result."""
    extracted, used = _extract_llm(stem, episode_meta, windows, catalog, settings)
    return {
        "episode": {
            "stem": stem,
            "date": episode_meta.date if episode_meta else None,
            "dbEpisodeId": episode_meta.id if episode_meta else None,
            "dbEpisodeNumber": episode_meta.number if episode_meta else None,
            "dbEpisodeTitle": episode_meta.title if episode_meta else None,
        },
        "extractor": {"version": "hybrid_v3_llm", "llmEnabled": True, "llmUsed": used, "mode": "llm_only"},
        "movies": extracted[:8],
        "unmatchedTitles": [],
        "candidates": [],
    }


def extract_movies_and_unmatched(stem, episode_meta, windows, catalog, settings):
    """LLM extraction for hybrid mode."""
    extracted, used = _extract_llm(stem, episode_meta, windows, catalog, settings)
    return extracted, [], used


def extract_movies_and_unmatched_with_llm_full_transcript(
    stem: str,
    episode_meta: Any,
    windows: list,
    catalog: list,
    settings: dict,
    *,
    client: Any = None,
) -> tuple[list, list, bool]:
    """Full-transcript LLM extraction with chunked prompting.

    Returns ``(movies, unmatched_titles, llm_used)``.
    """
    if not catalog or not windows:
        return [], [], False

    if not _llm_available(settings):
        return [], [], False

    episode_label = episode_meta.title if episode_meta else stem
    prompt = _build_llm_full_transcript_prompt(
        episode_label, episode_meta, windows, catalog,
        chunk_index=0, chunk_count=1,
    )

    try:
        if client is None:
            base_url, api_key = resolve_pipeline_llm_endpoints(settings)
            client = OpenAI(base_url=base_url, api_key=api_key)

        response = client.chat.completions.create(
            model=settings.get("movie_extractor_model", "qwen/qwen3.5-flash-02-23"),
            temperature=0.0,
            max_tokens=2000,
            messages=[
                {"role": "system", "content": "Respond with strict JSON only."},
                {"role": "user", "content": prompt},
            ],
        )

        if not response or not response.choices or not response.choices[0]:
            return [], [], True

        content = response.choices[0].message.content or ""
        clean = content.strip()
        clean = clean.replace("</think>", "").strip()

        if clean.startswith("```"):
            clean = clean.split("```", 1)[1].strip()
            if clean.startswith("json"):
                clean = clean[4:].strip()

        first_brace = clean.find("{")
        if first_brace >= 0:
            clean = clean[first_brace:]

        try:
            data = json.loads(clean)
        except json.JSONDecodeError:
            return [], [], True

        if not isinstance(data, dict):
            return [], [], True

        # Build catalog lookup
        catalog_by_norm: dict[str, dict] = {}
        for c in catalog:
            if isinstance(c, dict):
                title, mid, year = c.get("title", ""), c.get("movie_id", ""), c.get("year")
            else:
                title, mid, year = c.title, c.movie_id, c.year
            catalog_by_norm[_normalize_basic(title)] = {"title": title, "movie_id": mid, "year": year}

        window_map = {i: w for i, w in enumerate(windows)}

        movies_out: list = []
        seen_ids: set[str] = set()

        for item in data.get("movies", []):
            if not isinstance(item, dict):
                continue
            raw_title = str(item.get("title", "")).strip()
            if not raw_title:
                continue

            norm = _normalize_basic(raw_title)
            ci = catalog_by_norm.get(norm)
            if not ci:
                # Fuzzy: try stripping sequel numbers and re-matching
                norm_no_nums = _normalize_basic(
                    re.sub(r'\b\d+\b', '', raw_title).strip()
                )
                for nk, vc in catalog_by_norm.items():
                    # Direct substring match
                    if norm.startswith(nk) or nk.startswith(norm):
                        ci = vc
                        break
                    # Match without sequel numbers
                    nk_no_nums_norm = _normalize_basic(
                        re.sub(r'\b\d+\b', '', vc["title"]).strip()
                    )
                    if norm_no_nums == nk_no_nums_norm:
                        ci = vc
                        break
                    # Partial overlap for long titles
                    if len(norm) > 5 and (norm in nk or nk in norm):
                        ci = vc
                        break
            if not ci:
                continue

            if ci["movie_id"] in seen_ids:
                continue
            seen_ids.add(ci["movie_id"])

            evidence = []
            for idx in item.get("evidenceWindowIndices", []):
                w = window_map.get(idx)
                if w:
                    evidence.append({
                        "windowIndex": idx,
                        "start": round(w.start, 2),
                        "end": round(w.end, 2),
                        "text": w.text,
                        "windowType": w.window_type,
                    })

            movies_out.append({
                "matchedMovieId": ci["movie_id"],
                "title": ci["title"],
                "year": ci.get("year"),
                "confidence": min(1.0, max(0.0, float(item.get("confidence", 0.7)))),
                "status": "accepted",
                "signals": ["llm_full_transcript"],
                "evidence": evidence,
            })

        unmatched_out: list = []
        for item in data.get("unmatchedTitles", []):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "")).strip()
            if not title:
                continue
            evidence = []
            for idx in item.get("evidenceWindowIndices", []):
                w = window_map.get(idx)
                if w:
                    evidence.append({
                        "windowIndex": idx,
                        "start": round(w.start, 2),
                        "end": round(w.end, 2),
                        "text": w.text,
                        "windowType": w.window_type,
                    })
            unmatched_out.append({
                "title": title,
                "confidence": min(1.0, max(0.0, float(item.get("confidence", 0.5)))),
                "evidence": evidence,
            })

        return movies_out, unmatched_out, True

    except Exception as e:
        print(f"LLM full-transcript error: {e}")
        import traceback
        traceback.print_exc()
        return [], [], True
