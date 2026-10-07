from __future__ import annotations

import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from openai import OpenAI, OpenAIError

from lib import cowork_handoff
from lib.convex_client import ConvexPipelineClient
from lib.runtime_config import (
    get_llm_provider_from_settings,
    get_openrouter_api_key,
    resolve_pipeline_llm_endpoints,
)

EXACT_TITLE_MATCH = 1.0
FUZZY_TITLE_MATCH = 0.4
REPEATED_MENTION = 0.12
REVIEW_CONTEXT = 0.5
STRONG_REVIEW_CONTEXT = 0.8
SECTION_REVIEW_CONTEXT = 0.55
YEAR_CONTEXT = 0.3
SYNOPSIS_STYLE_CONTEXT = 0.1
FUTURE_RELEASE_CONTEXT = -0.45
TRAILER_OR_NEWS_CONTEXT = -0.65
NEXT_WEEK_OR_ASSIGNMENT_FUTURE_CONTEXT = -0.65
FUTURE_ASSIGNMENT_CONTEXT = -0.9
SHORT_AMBIGUOUS_TITLE_PENALTY = -1.0

DEFAULT_ACCEPT_THRESHOLD = 1.5
DEFAULT_MAYBE_THRESHOLD = 1.2
DEFAULT_CANDIDATE_LIMIT = 25
DEFAULT_MAX_MOVIES = 8
REQUIRE_POSITIVE_REVIEW_EVIDENCE = True
REQUIRE_STRONG_EVIDENCE_FOR_SINGLE_WORD = True
SINGLE_WORD_MIN_MENTIONS = 2
YEAR_REQUIRED_TITLES = ('the thing', 'four', 'nope', 'and', 'friday')
EXTRACTOR_VERSION = "hybrid_v3_llm"
MUTATION_PROFILE = 'tight_topk_adaptive'

# Default extractor mode when not explicitly configured
DEFAULT_EXTRACTOR_MODE = "heuristic"

REVIEW_KEYWORDS = (
    "review",
    "reviewed",
    "watched",
    "gave it",
    "give it",
    "dollar",
    "slater",
    "imdb synopsis",
    "plot",
    "this movie",
)

STRONG_REVIEW_KEYWORDS = (
    "movie called",
    "checked out",
    "i checked out",
    "went to the theater",
    "i watched",
    "i saw",
    "i had ",
    "i had homework",
    "double homework week",
    "we got some movies to review",
    "extra review",
    "i saw an extra",
    "my extra",
    "my pick",
)

FUTURE_ASSIGNMENT_KEYWORDS = (
    "that s my homework",
    "thats my homework",
    "i assign",
    "i m assigning",
    "im assigning",
    "your homework is",
    "for next week",
)

STRONG_REVIEW_PATTERNS = (
    r"movie called {title}",
    r"review the movie called {title}",
    r"reviewing {title}",
    r"reviewed {title}",
    r"checked out (?:a little )?movie called {title}",
    r"checked out {title}",
    r"i checked out (?:a little )?movie called {title}",
    r"i checked out {title}",
    r"i watched {title}",
    r"i saw {title}",
    r"i had {title}",
    r"had {title}",
    r"my homework.*{title}",
    r"i assign {title}",
    r"homework assignment.*{title}",
    r"syllabus pick.*{title}",
    r"extra[s]?\b.*{title}",
    r"which one are we doing.*{title}",
    r"let s do {title}",
    r"my pick is {title}",
    r"picked {title}",
    r"i picked {title}",
    r"i picked {title} because",
    r"{title}.*that s my homework",
    r"{title}.*thats my homework",
    r"{title} was my homework",
    r"{title} was my extra",
)

FUTURE_ASSIGNMENT_PATTERNS = (
    r"your homework is {title}",
    r"going to pick (?:a )?(?:\d{{4}} )?movie called {title}",
    r"i m going to pick (?:a )?(?:\d{{4}} )?movie called {title}",
    r"i am going to pick (?:a )?(?:\d{{4}} )?movie called {title}",
    r"gonna pick {title}",
    r"next week.*{title}",
    r"for next week.*{title}",
)

SECTION_REVIEW_KEYWORDS = (
    "homework",
    "extra",
    "is this your homework",
    "we re doing",
    "which one are we doing",
    "let s do",
    "let me add an extra",
    "turn in our homework",
    "picked",
)

SYNOPSIS_KEYWORDS = (
    "when",
    "after",
    "a young",
    "follows",
    "explores",
    "must",
    "finds",
    "story of",
)

FUTURE_KEYWORDS = (
    "coming out",
    "upcoming",
    "release date",
    "out next",
)

TRAILER_OR_NEWS_KEYWORDS = (
    "trailer",
    "box office",
    "news",
)

NEXT_WEEK_KEYWORDS = (
    "next week",
    "next episode",
)

COMPARISON_PATTERNS = (
    "like {title}",
    "not like {title}",
    "remember the {title}",
)
UNMATCHED_TITLE_PATTERNS = (
    r"(?:movie called)\s+([a-z0-9][a-z0-9 '&:!\-]{2,80})",
    r"(?:i assign)\s+([a-z0-9][a-z0-9 '&:!\-]{2,80})",
    r"(?:my homework is)\s+([a-z0-9][a-z0-9 '&:!\-]{2,80})",
    r"(?:my pick is)\s+([a-z0-9][a-z0-9 '&:!\-]{2,80})",
    r"(?:i picked)\s+([a-z0-9][a-z0-9 '&:!\-]{2,80})",
    r"(?:review(?:ing)?)\s+([a-z0-9][a-z0-9 '&:!\-]{2,80})",
    r"(?:watched)\s+([a-z0-9][a-z0-9 '&:!\-]{2,80})",
)

LEADING_ARTICLES = ("the ", "a ", "an ")
STOPWORDS = {
    "a",
    "an",
    "and",
    "at",
    "for",
    "from",
    "in",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
}

ROMAN_TOKEN_MAP = {
    "i": "1",
    "ii": "2",
    "iii": "3",
    "iv": "4",
    "v": "5",
    "vi": "6",
    "vii": "7",
    "viii": "8",
    "ix": "9",
    "x": "10",
}

_CATALOG_CACHE: list["MovieCatalogItem"] | None = None
_CATALOG_TOKEN_INDEX: dict[str, list["MovieCatalogItem"]] | None = None


@dataclass(frozen=True)
class EpisodeMetadata:
    id: str
    number: int
    title: str
    date: str


@dataclass(frozen=True)
class MovieCatalogItem:
    movie_id: str
    title: str
    year: int | None
    variants: tuple[str, ...]
    tokens: tuple[str, ...]
    search_tokens: tuple[str, ...]
    short_ambiguous: bool


@dataclass(frozen=True)
class EvidenceWindow:
    index: int
    start: float
    end: float
    text: str
    normalized_text: str
    tokens: tuple[str, ...]
    window_type: str


@dataclass
class CandidateState:
    movie: MovieCatalogItem
    score: float = 0.0
    mention_count: int = 0
    matched_exact: bool = False
    matched_fuzzy: bool = False
    review_context_hits: int = 0
    synopsis_hits: int = 0
    year_hits: int = 0
    llm_confirmed: bool = False
    evidence: list[dict[str, Any]] = field(default_factory=list)
    signals: set[str] = field(default_factory=set)

    def confidence(self) -> float:
        return max(0.0, min(0.99, 1 - math.exp(-max(self.score, 0.0) / 1.5)))


def _settings(config: dict[str, Any]) -> dict[str, Any]:
    settings = dict(config.get("settings", {}))
    settings.setdefault("movie_extractor_llm_enabled", True)
    # Only set default if NOT already specified in settings
    if "movie_extractor_mode" not in settings:
        settings["movie_extractor_mode"] = DEFAULT_EXTRACTOR_MODE
    settings["movie_extractor_candidate_limit"] = min(
        int(settings.get("movie_extractor_candidate_limit", DEFAULT_CANDIDATE_LIMIT)),
        DEFAULT_CANDIDATE_LIMIT,
    )
    settings["movie_extractor_max_movies"] = min(
        int(settings.get("movie_extractor_max_movies", DEFAULT_MAX_MOVIES)),
        DEFAULT_MAX_MOVIES,
    )
    settings["movie_extractor_accept_threshold"] = max(
        float(settings.get("movie_extractor_accept_threshold", DEFAULT_ACCEPT_THRESHOLD)),
        DEFAULT_ACCEPT_THRESHOLD,
    )
    settings["movie_extractor_maybe_threshold"] = max(
        float(settings.get("movie_extractor_maybe_threshold", DEFAULT_MAYBE_THRESHOLD)),
        DEFAULT_MAYBE_THRESHOLD,
    )
    if not settings.get("movie_extractor_model"):
        settings["movie_extractor_model"] = settings.get("seo_model")
    return settings


def _normalize_basic(text: str) -> str:
    lowered = text.lower().replace("&", " and ")
    lowered = re.sub(r"\([^)]*\)", " ", lowered)
    lowered = re.sub(r"[^a-z0-9]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _normalize_with_roman_variants(text: str) -> str:
    tokens = _normalize_basic(text).split()
    normalized = [ROMAN_TOKEN_MAP.get(token, token) for token in tokens]
    return " ".join(normalized)


def _tokenize(text: str) -> tuple[str, ...]:
    normalized = _normalize_with_roman_variants(text)
    return tuple(token for token in normalized.split() if token)


def _strip_leading_article(text: str) -> str:
    for article in LEADING_ARTICLES:
        if text.startswith(article):
            return text[len(article) :]
    return text


def _build_variants(title: str) -> tuple[str, ...]:
    base_normalized = _normalize_basic(title)
    normalized = _normalize_with_roman_variants(title)
    variants = {base_normalized, normalized}
    for source in (base_normalized, normalized):
        article_stripped = _strip_leading_article(source)
        if article_stripped and article_stripped != source:
            variants.add(article_stripped)
        no_subtitle = re.sub(r"\s+", " ", re.sub(r"[:,-]+", " ", source)).strip()
        if no_subtitle and no_subtitle != source:
            variants.add(no_subtitle)
            stripped_subtitle = _strip_leading_article(no_subtitle)
            if stripped_subtitle and stripped_subtitle != no_subtitle:
                variants.add(stripped_subtitle)
    for here_i_come in (" here i come", " here 1 come"):
        if here_i_come in base_normalized or here_i_come in normalized:
            variants.add(base_normalized.replace(" here i come", " 2"))
            variants.add(base_normalized.replace(" here i come", " 2 here i come"))
            variants.add(normalized.replace(" here 1 come", " 2"))
            variants.add(normalized.replace(" here 1 come", " 2 here 1 come"))
    if base_normalized == "sew torn" or normalized == "sew torn":
        variants.add("so torn")
    if base_normalized.startswith("friday the 13th part ") or normalized.startswith("friday the 13th part "):
        match = re.search(r"friday the 13th part (\d+)", base_normalized) or re.search(
            r"friday the 13th part (\d+)", normalized
        )
        if match:
            variants.add(f"part {match.group(1)}")
    if "jason lives" in base_normalized or "jason lives" in normalized:
        variants.add("jason lives")
    return tuple(sorted(v for v in variants if v))


def _is_short_ambiguous(tokens: Sequence[str]) -> bool:
    if len(tokens) != 1:
        return False
    token = tokens[0]
    return len(token) <= 3 or (token.isdigit() and len(token) <= 4)


def _build_catalog(rows: Iterable[Sequence[Any]]) -> list[MovieCatalogItem]:
    items: list[MovieCatalogItem] = []
    for row in rows:
        movie_id, title, year = row
        tokens = _tokenize(title)
        if not tokens:
            continue
        search_tokens = tuple(token for token in tokens if token not in STOPWORDS) or tokens
        items.append(
            MovieCatalogItem(
                movie_id=str(movie_id),
                title=str(title),
                year=int(year) if year is not None else None,
                variants=_build_variants(str(title)),
                tokens=tokens,
                search_tokens=search_tokens,
                short_ambiguous=_is_short_ambiguous(tokens),
            )
        )
    return items


def _build_catalog_index(catalog: Sequence[MovieCatalogItem]) -> dict[str, list[MovieCatalogItem]]:
    index: dict[str, list[MovieCatalogItem]] = defaultdict(list)
    for item in catalog:
        for token in set(item.search_tokens):
            index[token].append(item)
    return index


def _load_movie_catalog(
    client: ConvexPipelineClient,
) -> list[MovieCatalogItem]:
    global _CATALOG_CACHE, _CATALOG_TOKEN_INDEX
    if _CATALOG_CACHE is not None:
        return _CATALOG_CACHE
    _CATALOG_CACHE = _build_catalog(
        (
            movie.movie_id,
            movie.title,
            movie.year,
        )
        for movie in client.iter_movie_catalog()
    )
    _CATALOG_TOKEN_INDEX = _build_catalog_index(_CATALOG_CACHE)
    return _CATALOG_CACHE


def _catalog_index(catalog: Sequence[MovieCatalogItem]) -> dict[str, list[MovieCatalogItem]]:
    return _build_catalog_index(catalog)


def _load_transcript(transcript_path: Path) -> list[dict[str, Any]]:
    with transcript_path.open(encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def _window_text(parts: Sequence[str]) -> str:
    return " ".join(part.strip() for part in parts if isinstance(part, str) and part.strip()).strip()


def _build_evidence_windows(segments: Sequence[dict[str, Any]]) -> list[EvidenceWindow]:
    windows: list[EvidenceWindow] = []
    next_index = 0
    for idx, segment in enumerate(segments):
        text = _window_text([segment.get("text", "")])
        if text:
            windows.append(
                EvidenceWindow(
                    index=next_index,
                    start=float(segment.get("start", 0.0)),
                    end=float(segment.get("end", 0.0)),
                    text=text,
                    normalized_text=_normalize_with_roman_variants(text),
                    tokens=_tokenize(text),
                    window_type="single",
                )
            )
            next_index += 1
        for merge_size in (2, 3, 4, 5):
            merged = segments[idx : idx + merge_size]
            if len(merged) != merge_size:
                continue
            text = _window_text([part.get("text", "") for part in merged])
            if not text:
                continue
            windows.append(
                EvidenceWindow(
                    index=next_index,
                    start=float(merged[0].get("start", 0.0)),
                    end=float(merged[-1].get("end", 0.0)),
                    text=text,
                    normalized_text=_normalize_with_roman_variants(text),
                    tokens=_tokenize(text),
                    window_type=f"merged_{merge_size}",
                )
            )
            next_index += 1
    return windows


def _contains_phrase(text: str, phrase: str) -> bool:
    haystack = f" {text} "
    needle = f" {phrase} "
    return needle in haystack


def _matching_variants(text: str, variants: Sequence[str]) -> tuple[str, ...]:
    return tuple(variant for variant in variants if _contains_phrase(text, variant))


def _context_hits(text: str, phrases: Sequence[str]) -> int:
    return sum(1 for phrase in phrases if phrase in text)


def _pattern_hits(text: str, variants: Sequence[str], patterns: Sequence[str]) -> int:
    hits = 0
    for variant in variants:
        for pattern in patterns:
            if re.search(pattern.format(title=re.escape(variant)), text):
                hits += 1
    return hits


def _ordered_token_coverage(title_tokens: Sequence[str], window_tokens: Sequence[str]) -> float:
    if not title_tokens or not window_tokens:
        return 0.0
    window_positions: dict[str, list[int]] = defaultdict(list)
    for idx, token in enumerate(window_tokens):
        window_positions[token].append(idx)
    found_positions: list[int] = []
    last_position = -1
    for token in title_tokens:
        candidates = window_positions.get(token)
        if not candidates:
            return 0.0
        next_position = None
        for position in candidates:
            if position > last_position:
                next_position = position
                break
        if next_position is None:
            next_position = candidates[-1]
        found_positions.append(next_position)
        last_position = next_position
    span = found_positions[-1] - found_positions[0] + 1
    if span <= 0:
        return 0.0
    return len(title_tokens) / span


def _candidate_window_score(window: EvidenceWindow, movie: MovieCatalogItem) -> tuple[float, list[str]]:
    score = 0.0
    signals: list[str] = []
    context_text = _normalize_basic(window.text)
    matched_variants = _matching_variants(window.normalized_text, movie.variants)
    exact = bool(matched_variants)
    if exact:
        score += EXACT_TITLE_MATCH
        signals.append("exact_title")
    fuzzy = False
    if not exact and len(movie.tokens) > 1:
        overlap = sum(1 for token in movie.search_tokens if token in window.tokens)
        coverage = overlap / max(len(movie.search_tokens), 1)
        ordered = _ordered_token_coverage(movie.tokens, window.tokens)
        if coverage >= 0.75 and ordered >= 0.60:
            fuzzy = True
            score += FUZZY_TITLE_MATCH
            signals.append("fuzzy_title")
    if not exact and not fuzzy:
        return 0.0, signals
    review_hits = _context_hits(context_text, REVIEW_KEYWORDS)
    if review_hits:
        score += REVIEW_CONTEXT
        signals.append("review_context")
    strong_review_hits = _pattern_hits(context_text, matched_variants or movie.variants, STRONG_REVIEW_PATTERNS)
    if strong_review_hits:
        score += STRONG_REVIEW_CONTEXT
        signals.append("strong_review_context")
    section_review_hits = _context_hits(context_text, SECTION_REVIEW_KEYWORDS)
    if section_review_hits:
        score += SECTION_REVIEW_CONTEXT
        signals.append("section_review_context")
    synopsis_hits = _context_hits(context_text, SYNOPSIS_KEYWORDS)
    if synopsis_hits:
        score += SYNOPSIS_STYLE_CONTEXT
        signals.append("synopsis_context")
    if movie.year and str(movie.year) in context_text:
        score += YEAR_CONTEXT
        signals.append("year_context")
    future_assignment_hits = _pattern_hits(context_text, matched_variants or movie.variants, FUTURE_ASSIGNMENT_PATTERNS)
    if future_assignment_hits:
        score += FUTURE_ASSIGNMENT_CONTEXT
        signals.append("future_assignment_context")
    future_hits = _context_hits(context_text, FUTURE_KEYWORDS)
    if future_hits:
        score += FUTURE_RELEASE_CONTEXT
        signals.append("future_release_context")
    trailer_hits = _context_hits(context_text, TRAILER_OR_NEWS_KEYWORDS)
    if trailer_hits:
        score += TRAILER_OR_NEWS_CONTEXT
        signals.append("trailer_or_news_context")
    next_week_hits = _context_hits(context_text, NEXT_WEEK_KEYWORDS)
    if next_week_hits:
        score += NEXT_WEEK_OR_ASSIGNMENT_FUTURE_CONTEXT
        signals.append("next_week_context")
    comparison_hits = _pattern_hits(window.normalized_text, matched_variants or movie.variants, COMPARISON_PATTERNS)
    if comparison_hits:
        score += TRAILER_OR_NEWS_CONTEXT
        signals.append("comparison_context")
    if movie.short_ambiguous:
        score += SHORT_AMBIGUOUS_TITLE_PENALTY
        signals.append("short_ambiguous_penalty")
        has_disambiguator = any(
            key in signals for key in ("review_context", "strong_review_context", "year_context", "exact_title")
        ) and (review_hits or strong_review_hits or (movie.year and str(movie.year) in context_text))
        if not has_disambiguator:
            score = min(score, 0.0)
    return score, signals


def _candidate_window_ids(
    windows: Sequence[EvidenceWindow],
    catalog: Sequence[MovieCatalogItem],
) -> dict[str, list[int]]:
    index = _catalog_index(catalog)
    candidate_ids: dict[str, list[int]] = defaultdict(list)
    for window in windows:
        seen: set[str] = set()
        for token in set(window.tokens):
            for item in index.get(token, []):
                if item.movie_id in seen:
                    continue
                candidate_ids[item.movie_id].append(window.index)
                seen.add(item.movie_id)
    return candidate_ids


def _top_review_windows(windows: Sequence[EvidenceWindow], limit: int = 20) -> list[EvidenceWindow]:
    ranked: list[tuple[int, EvidenceWindow]] = []
    for window in windows:
        context_text = _normalize_basic(window.text)
        score = (
            _context_hits(context_text, STRONG_REVIEW_KEYWORDS) * 3
            + _context_hits(context_text, FUTURE_ASSIGNMENT_KEYWORDS) * 2
            + _context_hits(context_text, REVIEW_KEYWORDS) * 2
            + _context_hits(context_text, SYNOPSIS_KEYWORDS)
        )
        if score > 0:
            ranked.append((score, window))
    ranked.sort(key=lambda pair: (-pair[0], pair[1].start))
    return [window for _, window in ranked[:limit]]


def _extract_unmatched_titles(
    review_windows: Sequence[EvidenceWindow],
    catalog: Sequence[MovieCatalogItem],
) -> list[dict[str, Any]]:
    known_titles = set()
    for movie in catalog:
        known_titles.update(movie.variants)
    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for window in review_windows:
        searchable_text = _normalize_basic(window.text)
        for pattern in UNMATCHED_TITLE_PATTERNS:
            for match in re.finditer(pattern, searchable_text, flags=re.IGNORECASE):
                candidate = match.group(1).strip(" .,!?:;-")
                candidate = re.split(
                    r"\b(?:when|after|where|because|and then|and i|and it|that)\b",
                    candidate,
                    maxsplit=1,
                )[0].strip()
                candidate = re.sub(
                    r"^(?:my homework|my pick|i assign|i picked|watched|reviewing?|movie called)\s+",
                    "",
                    candidate,
                ).strip()
                candidate = re.sub(r"^\d+\s+", "", candidate).strip()
                candidate = re.sub(r"\b\d{4}\b$", "", candidate).strip()
                if not candidate or len(candidate.split()) > 8:
                    continue
                if candidate in known_titles or candidate in seen:
                    continue
                seen.add(candidate)
                results.append(
                    {
                        "title": " ".join(word.capitalize() for word in candidate.split()),
                        "confidence": 0.58,
                        "evidence": [
                            {
                                "windowIndex": window.index,
                                "start": round(window.start, 2),
                                "end": round(window.end, 2),
                                "text": window.text,
                                "windowType": window.window_type,
                            }
                        ],
                    }
                )
    return results[:10]


def _selection_score(state: CandidateState) -> float:
    score = state.score
    if "strong_review_context" in state.signals:
        score += 0.5
    if "section_review_context" in state.signals:
        score += 0.4
    if "year_context" in state.signals:
        score += 0.15
    if "synopsis_context" in state.signals:
        score += 0.05
    if "future_assignment_context" in state.signals:
        score -= 1.0
    if "next_week_context" in state.signals:
        score -= 0.9
    if "future_release_context" in state.signals:
        score -= 0.7
    if "trailer_or_news_context" in state.signals:
        score -= 0.5
    if "comparison_context" in state.signals:
        score -= 0.6
    if len(state.movie.tokens) == 1 and "year_context" not in state.signals:
        score -= 0.35
    score += min(state.mention_count * 0.05, 0.2)
    return score


def _score_catalog_movies(
    windows: Sequence[EvidenceWindow],
    catalog: Sequence[MovieCatalogItem],
) -> tuple[list[CandidateState], list[EvidenceWindow]]:
    items_by_id = {item.movie_id: item for item in catalog}
    candidate_window_ids = _candidate_window_ids(windows, catalog)
    window_map = {window.index: window for window in windows}
    states: list[CandidateState] = []

    for movie_id, window_ids in candidate_window_ids.items():
        movie = items_by_id[movie_id]
        state = CandidateState(movie=movie)
        best_score = float("-inf")
        mention_markers: set[tuple[str, float, float]] = set()
        evidence_by_key: dict[tuple[float, float, str], dict[str, Any]] = {}
        for window_id in window_ids:
            window = window_map[window_id]
            score, signals = _candidate_window_score(window, movie)
            if score <= 0:
                continue
            best_score = max(best_score, score)
            state.matched_exact = state.matched_exact or ("exact_title" in signals)
            state.matched_fuzzy = state.matched_fuzzy or ("fuzzy_title" in signals)
            state.review_context_hits += int("review_context" in signals)
            state.synopsis_hits += int("synopsis_context" in signals)
            state.year_hits += int("year_context" in signals)
            state.signals.update(signals)
            if window.window_type == "single":
                mention_markers.add((window.window_type, round(window.start, 2), round(window.end, 2)))
            evidence_key = (round(window.start, 2), round(window.end, 2), window.text)
            evidence_by_key[evidence_key] = {
                "windowIndex": window.index,
                "start": round(window.start, 2),
                "end": round(window.end, 2),
                "text": window.text,
                "windowType": window.window_type,
            }
        if best_score == float("-inf"):
            continue
        state.score = best_score
        mention_count = max(len(mention_markers), 1)
        if mention_count > 1:
            repeat_bonus = min(REPEATED_MENTION * (mention_count - 1), 0.5)
            state.score += repeat_bonus
            state.signals.add("repeated_mention")
        state.mention_count = mention_count
        state.evidence = sorted(
            evidence_by_key.values(),
            key=lambda item: (item["start"], item["windowType"] != "single"),
        )
        states.append(state)
    states.sort(key=lambda state: (-_selection_score(state), -state.score, state.movie.title.lower()))
    return states, _top_review_windows(windows)


def _llm_available(settings: dict[str, Any]) -> bool:
    if not settings.get("movie_extractor_llm_enabled") or not settings.get("movie_extractor_model"):
        return False
    if get_llm_provider_from_settings(settings) == "ollama":
        return True
    try:
        return bool(get_openrouter_api_key())
    except Exception:
        return False


def _build_llm_prompt(
    episode_stem: str,
    episode_meta: EpisodeMetadata | None,
    candidates: Sequence[CandidateState],
    review_windows: Sequence[EvidenceWindow],
) -> str:
    episode_label = episode_meta.title if episode_meta else episode_stem
    candidate_lines = []
    for idx, candidate in enumerate(candidates):
        evidence = candidate.evidence[:3]
        evidence_text = "\n".join(
            f"    - window {e['windowIndex']}: [{e['start']} -> {e['end']}] {e['text']}"
            for e in evidence
        )
        candidate_lines.append(
            f"- candidateIndex: {idx}\n"
            f"  title: {candidate.movie.title}\n"
            f"  year: {candidate.movie.year}\n"
            f"  score: {candidate.score:.2f}\n"
            f"  signals: {', '.join(sorted(candidate.signals))}\n"
            f"  evidence:\n{evidence_text}"
        )

    review_lines = [
        f"- windowIndex: {window.index}\n"
        f"  span: [{window.start} -> {window.end}]\n"
        f"  text: {window.text}"
        for window in review_windows[:20]
    ]

    return (
        "You are reviewing transcript evidence for a BBPC podcast episode.\n"
        f"Episode: {episode_label}\n"
        "Return strict JSON only with this shape:\n"
        '{\n'
        '  "acceptedCandidateIndices": [0, 2],\n'
        '  "unmatchedTitles": [\n'
        '    {"title": "Raw title", "evidenceWindowIndices": [12]}\n'
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Accept only movies actually reviewed on this episode.\n"
        "- Reject future release chatter, trailer/news mentions, and casual references.\n"
        "- You may only accept candidate indices listed below.\n"
        "- For unmatchedTitles, only include raw titles clearly supported by review-style windows.\n\n"
        "Candidates:\n"
        + "\n".join(candidate_lines)
        + "\n\nReview-looking windows:\n"
        + "\n".join(review_lines)
    )


def _parse_llm_json(raw_output: str) -> dict[str, Any]:
    clean = raw_output.strip()
    if clean.startswith("```"):
        parts = clean.split("```")
        clean = parts[1] if len(parts) > 1 else clean
        if clean.startswith("json"):
            clean = clean[4:]
        clean = clean.strip()
    try:
        data = json.loads(clean)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _rerank_with_llm(
    episode_stem: str,
    episode_meta: EpisodeMetadata | None,
    candidates: Sequence[CandidateState],
    review_windows: Sequence[EvidenceWindow],
    settings: dict[str, Any],
) -> tuple[set[int], list[dict[str, Any]], bool]:
    if not _llm_available(settings) or not candidates:
        return set(), [], False
    base_url, api_key = resolve_pipeline_llm_endpoints(settings)
    client = OpenAI(base_url=base_url, api_key=api_key)
    prompt = _build_llm_prompt(episode_stem, episode_meta, candidates, review_windows)
    response = client.chat.completions.create(
        model=settings["movie_extractor_model"],
        temperature=0.0,
        max_tokens=1200,
        messages=[
            {"role": "system", "content": "Respond with strict JSON only."},
            {"role": "user", "content": prompt},
        ],
    )
    choices = getattr(response, "choices", None) or []
    if not choices:
        return set(), [], True
    msg = getattr(choices[0], "message", None)
    content = (getattr(msg, "content", None) or "") if msg is not None else ""
    data = _parse_llm_json(content)
    accepted: set[int] = set()
    for idx in data.get("acceptedCandidateIndices", []):
        if isinstance(idx, int) and 0 <= idx < len(candidates):
            accepted.add(idx)
    unmatched_titles: list[dict[str, Any]] = []
    review_window_map = {window.index: window for window in review_windows}
    for item in data.get("unmatchedTitles", []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        if not title:
            continue
        evidence_rows: list[dict[str, Any]] = []
        for window_index in item.get("evidenceWindowIndices", []):
            if not isinstance(window_index, int):
                continue
            window = review_window_map.get(window_index)
            if not window:
                continue
            evidence_rows.append(
                {
                    "windowIndex": window.index,
                    "start": round(window.start, 2),
                    "end": round(window.end, 2),
                    "text": window.text,
                    "windowType": window.window_type,
                }
            )
        if evidence_rows:
            unmatched_titles.append(
                {
                    "title": title,
                    "confidence": 0.7,
                    "evidence": evidence_rows,
                }
            )
    return accepted, unmatched_titles, True


def _candidate_status(
    state: CandidateState,
    accepted_indices: set[int],
    position: int,
    settings: dict[str, Any],
) -> str:
    normalized_title = _normalize_with_roman_variants(state.movie.title)
    has_positive_review_evidence = bool(
        state.signals & {"review_context", "strong_review_context", "section_review_context", "year_context"}
    )
    strong_review_evidence = bool(
        "strong_review_context" in state.signals
        or ("section_review_context" in state.signals and ("review_context" in state.signals or "repeated_mention" in state.signals))
        or ("review_context" in state.signals and ("year_context" in state.signals or "repeated_mention" in state.signals))
        or ("year_context" in state.signals and "repeated_mention" in state.signals)
    )
    negative_only = bool(state.signals & {"future_release_context", "trailer_or_news_context", "next_week_context"}) and not has_positive_review_evidence
    single_word_title = len(state.movie.tokens) == 1
    strong_short_title_override = (
        single_word_title
        and "exact_title" in state.signals
        and (
            "review_context" in state.signals
            or "strong_review_context" in state.signals
            or "section_review_context" in state.signals
        )
        and "year_context" in state.signals
        and state.mention_count >= 2
    )
    if state.score < 0:
        return "rejected"
    if negative_only:
        return "rejected"
    if "future_assignment_context" in state.signals:
        return "rejected"
    if "comparison_context" in state.signals and "strong_review_context" not in state.signals and "section_review_context" not in state.signals:
        return "rejected"
    if REQUIRE_POSITIVE_REVIEW_EVIDENCE and not has_positive_review_evidence:
        return "rejected"
    if normalized_title in YEAR_REQUIRED_TITLES and "year_context" not in state.signals:
        return "rejected"
    if REQUIRE_STRONG_EVIDENCE_FOR_SINGLE_WORD and single_word_title and not strong_review_evidence and not strong_short_title_override:
        return "rejected"
    if single_word_title and state.mention_count < SINGLE_WORD_MIN_MENTIONS and "year_context" not in state.signals:
        return "rejected"
    if strong_short_title_override:
        return "accepted"
    if state.score >= settings["movie_extractor_accept_threshold"] and strong_review_evidence:
        return "accepted"
    if position in accepted_indices and state.score >= settings["movie_extractor_maybe_threshold"]:
        return "accepted"
    if state.score >= settings["movie_extractor_maybe_threshold"] and (
        strong_review_evidence or state.mention_count > 1
    ):
        return "maybe"
    return "rejected"


def _candidate_payload(
    state: CandidateState,
    status: str,
) -> dict[str, Any]:
    return {
        "matchedMovieId": state.movie.movie_id,
        "title": state.movie.title,
        "year": state.movie.year,
        "score": round(state.score, 3),
        "confidence": round(state.confidence(), 3),
        "status": status,
        "signals": sorted(state.signals),
        "evidence": state.evidence[:5],
    }


def _merge_movie_rows(
    heuristic_movies: Sequence[dict[str, Any]],
    llm_movies: Sequence[dict[str, Any]],
    *,
    max_movies: int,
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    positions: dict[str, int] = {}

    def row_key(row: dict[str, Any]) -> str:
        matched_id = row.get("matchedMovieId")
        if matched_id:
            return f"id:{matched_id}"
        return f"title:{_normalize_basic(str(row.get('title', '')))}"

    for row in heuristic_movies:
        copied = dict(row)
        copied["signals"] = list(row.get("signals", []))
        copied["evidence"] = list(row.get("evidence", []))
        key = row_key(copied)
        positions[key] = len(merged)
        merged.append(copied)

    for row in llm_movies:
        copied = dict(row)
        copied["signals"] = list(row.get("signals", []))
        copied["evidence"] = list(row.get("evidence", []))
        if "llm_full_transcript" not in copied["signals"]:
            copied["signals"].append("llm_full_transcript")
        key = row_key(copied)
        existing_index = positions.get(key)
        if existing_index is not None:
            existing = merged[existing_index]
            existing["confidence"] = max(float(existing.get("confidence", 0.0)), float(copied.get("confidence", 0.0)))
            existing_signals = sorted(set(existing.get("signals", [])) | set(copied.get("signals", [])))
            existing["signals"] = existing_signals
            seen_evidence = {
                (item.get("windowIndex"), item.get("start"), item.get("end"), item.get("text"))
                for item in existing.get("evidence", [])
            }
            combined = list(existing.get("evidence", []))
            for item in copied.get("evidence", []):
                key_tuple = (item.get("windowIndex"), item.get("start"), item.get("end"), item.get("text"))
                if key_tuple in seen_evidence:
                    continue
                seen_evidence.add(key_tuple)
                combined.append(item)
            existing["evidence"] = combined[:5]
            continue
        if len(merged) >= max_movies:
            continue
        positions[key] = len(merged)
        merged.append(copied)
    return merged[:max_movies]


def _merge_unmatched_rows(
    heuristic_unmatched: Sequence[dict[str, Any]],
    llm_unmatched: Sequence[dict[str, Any]],
    *,
    limit: int = 10,
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for row in list(heuristic_unmatched) + list(llm_unmatched):
        key = _normalize_basic(str(row.get("title", "")))
        if not key:
            continue
        current = merged.get(key)
        copied = {
            "title": row.get("title"),
            "confidence": row.get("confidence", 0.0),
            "evidence": list(row.get("evidence", []))[:5],
        }
        if current is None or float(copied["confidence"]) > float(current.get("confidence", 0.0)):
            merged[key] = copied
    return sorted(merged.values(), key=lambda row: float(row.get("confidence", 0.0)), reverse=True)[:limit]


def _merge_candidate_rows(
    candidates: Sequence[dict[str, Any]],
    llm_movies: Sequence[dict[str, Any]],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    merged = [dict(candidate) for candidate in candidates]
    seen_keys = {
        candidate.get("matchedMovieId") or _normalize_basic(str(candidate.get("title", "")))
        for candidate in merged
    }
    for row in llm_movies:
        key = row.get("matchedMovieId") or _normalize_basic(str(row.get("title", "")))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        merged.append(
            {
                "matchedMovieId": row.get("matchedMovieId"),
                "title": row.get("title"),
                "year": row.get("year"),
                "score": round(float(row.get("confidence", 0.0)), 3),
                "confidence": round(float(row.get("confidence", 0.0)), 3),
                "status": "accepted",
                "signals": sorted(set(row.get("signals", [])) | {"llm_full_transcript"}),
                "evidence": list(row.get("evidence", []))[:5],
            }
        )
    return merged[:limit]


def _resolve_episode_from_filename(
    client: ConvexPipelineClient,
    stem: str,
) -> EpisodeMetadata | None:
    if len(stem) < 8 or not stem[:8].isdigit():
        return None
    episode_date = f"{stem[:4]}-{stem[4:6]}-{stem[6:8]}"
    episode = client.get_episode_by_date(episode_date)
    if episode is None:
        return None
    return EpisodeMetadata(
        id=episode.id,
        number=episode.number,
        title=episode.title,
        date=episode.date or episode_date,
    )


def _movie_output_path(config: dict[str, Any], stem: str) -> Path:
    output_dir = (
        Path(config.get("paths", {}).get("movie_extractions_dir", "./output/movies"))
        .expanduser()
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / f"{stem}.movies.json"


def _write_output(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def _append_missing_catalog_movies(
    accepted_movies: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    catalog: Sequence[MovieCatalogItem],
) -> None:
    """Include canonically assigned movies that had no transcript evidence."""
    accepted_ids = {movie.get("matchedMovieId") for movie in accepted_movies}
    candidate_ids = {candidate.get("matchedMovieId") for candidate in candidates}
    for item in catalog:
        if item.movie_id in accepted_ids:
            continue
        row = {
            "matchedMovieId": item.movie_id,
            "title": item.title,
            "year": item.year,
            "confidence": 0.0,
            "status": "db_assigned",
            "signals": ["db_episode_movie"],
            "evidence": [],
        }
        accepted_movies.append(row)
        accepted_ids.add(item.movie_id)
        if item.movie_id not in candidate_ids:
            candidates.append({**row, "score": 0.0})
            candidate_ids.add(item.movie_id)


def _episode_payload(stem: str, episode_meta: EpisodeMetadata | None) -> dict[str, Any]:
    return {
        "stem": stem,
        "date": episode_meta.date if episode_meta else (
            f"{stem[:4]}-{stem[4:6]}-{stem[6:8]}" if len(stem) >= 8 and stem[:8].isdigit() else None
        ),
        "dbEpisodeId": episode_meta.id if episode_meta else None,
        "dbEpisodeNumber": episode_meta.number if episode_meta else None,
        "dbEpisodeTitle": episode_meta.title if episode_meta else None,
    }


def _db_only_result(
    stem: str,
    episode_meta: EpisodeMetadata | None,
    catalog: Sequence[MovieCatalogItem],
    settings: dict[str, Any],
) -> dict[str, Any]:
    """Build the artifact from canonical episode movies when no transcript exists."""
    movies: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    _append_missing_catalog_movies(movies, candidates, catalog)
    return {
        "episode": _episode_payload(stem, episode_meta),
        "extractor": {
            "version": EXTRACTOR_VERSION,
            "llmEnabled": bool(settings.get("movie_extractor_llm_enabled")),
            "llmUsed": False,
            "mode": "db_only",
            "dbEpisodeId": episode_meta.id if episode_meta else None,
            "dbEpisodeNumber": episode_meta.number if episode_meta else None,
            "dbEpisodeTitle": episode_meta.title if episode_meta else None,
        },
        "movies": movies,
        "unmatchedTitles": [],
        "candidates": candidates,
    }


def _cowork_title_keys(row: dict[str, Any]) -> set[str]:
    keys: set[str] = set()
    for field in ("title", "originalTitle"):
        value = str(row.get(field) or "").strip()
        if value:
            keys.update(_build_variants(value))
    return keys


def _match_catalog_item(
    row: dict[str, Any],
    catalog: Sequence[MovieCatalogItem],
    *,
    require_year: bool,
) -> MovieCatalogItem | None:
    keys = _cowork_title_keys(row)
    if not keys:
        return None
    year = row.get("year")
    matches = [item for item in catalog if keys.intersection(item.variants)]
    if year is not None:
        same_year = [item for item in matches if item.year == year]
        if same_year:
            return same_year[0]
        if require_year:
            return None
    return matches[0] if len(matches) == 1 else None


def _resolve_cowork_ids(
    rows: list[dict[str, Any]],
    assigned_catalog: Sequence[MovieCatalogItem],
    full_catalog: Sequence[MovieCatalogItem] | None,
) -> None:
    for row in rows:
        if row.get("matchedMovieId"):
            continue
        item = _match_catalog_item(row, assigned_catalog, require_year=False)
        if item is None and full_catalog:
            # Outside the episode's assignments, insist on a year match.
            item = _match_catalog_item(row, full_catalog, require_year=True)
        if item is not None:
            row["matchedMovieId"] = item.movie_id
            if row.get("year") is None:
                row["year"] = item.year


def _cowork_result(
    cowork: dict[str, Any],
    stem: str,
    episode_meta: EpisodeMetadata | None,
    assigned_catalog: Sequence[MovieCatalogItem],
    full_catalog_loader,
) -> dict[str, Any]:
    """Adopt Cowork's reviewed-movie judgement, adding Convex IDs and DB assignments."""
    movies = [dict(m) for m in cowork.get("movies", []) if isinstance(m, dict)]
    candidates = [dict(c) for c in cowork.get("candidates", []) if isinstance(c, dict)]
    accepted = [m for m in movies if m.get("status", "accepted") == "accepted"]

    _resolve_cowork_ids(movies + candidates, assigned_catalog, None)
    if any(not m.get("matchedMovieId") for m in accepted):
        try:
            full_catalog = full_catalog_loader()
        except Exception as exc:  # network/credentials: keep going without IDs
            print(f"Cowork movies: full-catalog lookup skipped ({exc})")
            full_catalog = None
        _resolve_cowork_ids(movies + candidates, assigned_catalog, full_catalog)

    assigned_ids = {item.movie_id for item in assigned_catalog}
    for movie in accepted:
        if not movie.get("matchedMovieId"):
            print(f"Cowork movies: no Convex match for '{movie.get('title')}' ({movie.get('year')}); thumbnail will skip it.")
        elif assigned_ids and movie["matchedMovieId"] not in assigned_ids:
            print(f"Cowork movies: '{movie.get('title')}' is not assigned to this episode in Convex.")
    before = len(movies)
    _append_missing_catalog_movies(movies, candidates, assigned_catalog)
    for movie in movies[before:]:
        print(f"Cowork movies: Convex assigns '{movie['title']}' but Cowork did not list it; added as db_assigned.")

    episode = _episode_payload(stem, episode_meta)
    for key, value in (cowork.get("episode") or {}).items():
        if episode.get(key) is None and value is not None:
            episode[key] = value
    extractor = dict(cowork.get("extractor") or {})
    extractor.setdefault("version", "cowork")
    extractor.update({
        "mode": "cowork",
        "source": "cowork",
        "dbEpisodeId": episode.get("dbEpisodeId"),
        "dbEpisodeNumber": episode.get("dbEpisodeNumber"),
        "dbEpisodeTitle": episode.get("dbEpisodeTitle"),
    })
    return {
        "episode": episode,
        "extractor": extractor,
        "movies": movies,
        "unmatchedTitles": cowork.get("unmatchedTitles", []),
        "candidates": candidates,
    }


def _extract_result(
    stem: str,
    episode_meta: EpisodeMetadata | None,
    segments: Sequence[dict[str, Any]],
    catalog: Sequence[MovieCatalogItem],
    settings: dict[str, Any],
    *,
    ensure_catalog_movies: bool = False,
) -> dict[str, Any]:
    windows = _build_evidence_windows(segments)
    extractor_mode = settings.get("movie_extractor_mode")
    if extractor_mode == "llm_only":
        from lib.movie_extractor_llm_ext import llm_only_result

        print(f"[LLM_ONLY] About to call llm_only_result")
        return llm_only_result(stem, episode_meta, windows, catalog, settings)

    # Standard heuristic+LLM-rerank mode
    states, review_windows = _score_catalog_movies(windows, catalog)
    candidate_limit = int(settings["movie_extractor_candidate_limit"])
    top_states = states[:candidate_limit]
    try:
        accepted_indices, unmatched_titles, llm_used = _rerank_with_llm(
            stem,
            episode_meta,
            top_states,
            review_windows,
            settings,
        )
    except OpenAIError as exc:
        # The rerank only confirms borderline candidates; the heuristic scores stand without it.
        print(f"Movie extractor: LLM rerank failed ({exc}); using heuristic results.")
        accepted_indices, unmatched_titles, llm_used = set(), [], False
    heuristic_unmatched = _extract_unmatched_titles(review_windows, catalog)

    candidates: list[dict[str, Any]] = []
    accepted_movies: list[dict[str, Any]] = []
    accepted_title_keys: set[str] = set()
    max_movies = max(1, int(settings.get("movie_extractor_max_movies", 8)))
    for idx, state in enumerate(top_states):
        status = _candidate_status(state, accepted_indices, idx, settings)
        if idx in accepted_indices:
            state.llm_confirmed = True
            state.signals.add("llm_confirmed")
        payload = _candidate_payload(state, status)
        candidates.append(payload)
        if status == "accepted" and len(accepted_movies) < max_movies:
            title_key = _normalize_basic(payload["title"])
            if title_key in accepted_title_keys:
                continue
            accepted_title_keys.add(title_key)
            accepted_movies.append(
                {
                    "matchedMovieId": payload["matchedMovieId"],
                    "title": payload["title"],
                    "year": payload["year"],
                    "confidence": payload["confidence"],
                    "status": "accepted",
                    "signals": payload["signals"],
                    "evidence": payload["evidence"],
                }
            )

    result = {
        "episode": _episode_payload(stem, episode_meta),
        "extractor": {
            "version": EXTRACTOR_VERSION,
            "llmEnabled": bool(settings.get("movie_extractor_llm_enabled")),
            "llmUsed": llm_used,
            "mode": "heuristic",
        },
        "movies": accepted_movies,
        "unmatchedTitles": (heuristic_unmatched + unmatched_titles)[:10],
        "candidates": candidates,
    }
    if extractor_mode == "hybrid_full_transcript":
        from lib.movie_extractor_llm_ext import extract_movies_and_unmatched_with_llm_full_transcript

        llm_movies, llm_unmatched, llm_full_used = extract_movies_and_unmatched_with_llm_full_transcript(
            stem,
            episode_meta,
            windows,
            catalog,
            settings,
        )
        if llm_full_used:
            result["movies"] = _merge_movie_rows(
                result["movies"],
                llm_movies,
                max_movies=max_movies,
            )
            result["unmatchedTitles"] = _merge_unmatched_rows(
                result["unmatchedTitles"],
                llm_unmatched,
                limit=10,
            )
            result["candidates"] = _merge_candidate_rows(
                result["candidates"],
                llm_movies,
                limit=candidate_limit,
            )
            result["extractor"]["llmUsed"] = True
            result["extractor"]["mode"] = "hybrid_full_transcript"
    if ensure_catalog_movies:
        _append_missing_catalog_movies(result["movies"], result["candidates"], catalog)
    return result


def _build_catalog_from_episode_movies(
    episode_movies: list,
) -> list[MovieCatalogItem]:
    """Build a targeted MovieCatalogItem list from EpisodeMovie records."""
    items: list[MovieCatalogItem] = []
    seen_ids: set[str] = set()
    for em in episode_movies:
        mid = em.movie_id if hasattr(em, 'movie_id') else str(em.get("movie_id", ""))
        if mid in seen_ids:
            continue
        seen_ids.add(mid)
        title = em.title if hasattr(em, 'title') else str(em.get("title", ""))
        year = em.year if hasattr(em, 'year') else em.get("year")
        tokens = _tokenize(title)
        if not tokens:
            continue
        search_tokens = tuple(t for t in tokens if t not in STOPWORDS) or tokens
        items.append(MovieCatalogItem(
            movie_id=mid,
            title=title,
            year=int(year) if year is not None else None,
            variants=_build_variants(title),
            tokens=tokens,
            search_tokens=search_tokens,
            short_ambiguous=_is_short_ambiguous(tokens),
        ))
    return items


def _summarize_db_sources(db_movies: list) -> dict[str, int]:
    """Return a summary of where the episode's movies came from."""
    counts: dict[str, int] = {}
    for em in db_movies:
        src = em.source if hasattr(em, 'source') else em.get("source", "unknown")
        counts[src] = counts.get(src, 0) + 1
    return counts


def run(context: dict) -> None:
    transcript_path = context.get("transcript_path")
    if not transcript_path:
        raise RuntimeError("Movie extraction stage requires transcript_path in context")
    transcript_file = Path(transcript_path)
    # Without a transcript, the stage can still emit Convex-assigned movies.
    has_transcript = transcript_file.is_file()

    config = context.get("config", {})
    stem = transcript_file.stem
    output_path = _movie_output_path(config, stem)
    settings = _settings(config)

    # Resolve canonical episode context and reviewed movies from Convex.
    db_episode = context.get("db_episode")  # optional pre-resolved
    db_movies = context.get("db_episode_movies", [])  # optional pre-fetched

    if not db_episode or not db_movies:
        convex = context.get("convex_client")
        if convex is None:
            convex = ConvexPipelineClient.from_environment()
        if not db_episode and not db_movies:
            from lib.episode_db import (
                get_episode_movies_by_stem,
            )

            db_episode, db_movies = get_episode_movies_by_stem(
                convex,
                stem,
            )
            if (
                has_transcript
                and db_episode
                and not db_movies
                and settings.get(
                    "movie_extractor_db_fallback_catalog",
                    True,
                )
            ):
                from lib.episode_db import catalog_fallback_movies

                db_movies = catalog_fallback_movies(
                    _load_movie_catalog(convex)
                )
        elif not db_episode:
            from lib.episode_db import resolve_episode_by_stem

            db_episode = resolve_episode_by_stem(convex, stem)
        elif not db_movies:
            from lib.episode_db import (
                get_episode_movies,
                get_episode_movies_with_fallback,
            )

            episode_movies = get_episode_movies(
                convex, db_episode["id"]
            )
            if episode_movies:
                db_movies = episode_movies
            elif has_transcript and settings.get(
                "movie_extractor_db_fallback_catalog", True
            ):
                full_catalog = _load_movie_catalog(convex)
                db_movies = get_episode_movies_with_fallback(
                    convex,
                    db_episode["id"],
                    full_catalog,
                )

    # Build a targeted catalog from canonical episode relationships.
    if db_movies:
        catalog = _build_catalog_from_episode_movies(db_movies)
        if db_episode:
            episode_meta = EpisodeMetadata(
                id=str(db_episode.get("id", "")),
                number=int(db_episode["number"]) if db_episode.get("number") is not None else 0,
                title=str(db_episode.get("title", "")),
                date=str(db_episode.get("date", "")),
            )
        else:
            episode_meta = None
    else:
        # No relationship data: use full-catalog extraction.
        catalog = None
        episode_meta = None

    cowork_mode = cowork_handoff.resolve_mode(config, context)
    cowork_payload = (
        cowork_handoff.load_movies(config, stem)
        if has_transcript and cowork_mode != "off"
        else None
    )
    if has_transcript and cowork_payload is None and cowork_mode == "require":
        raise cowork_handoff.AwaitingCowork(stem, "movies", cowork_handoff.movies_path(config, stem))

    if cowork_payload is not None:
        assigned_rows = [
            em for em in (db_movies or [])
            if (em.source if hasattr(em, "source") else em.get("source")) != "catalog_fallback"
        ]
        assigned_catalog = _build_catalog_from_episode_movies(assigned_rows) if assigned_rows else []

        def _full_catalog():
            client = context.get("convex_client") or ConvexPipelineClient.from_environment()
            return _load_movie_catalog(client)

        print(f"Using Cowork movie extraction: {cowork_handoff.movies_path(config, stem)}")
        payload = _cowork_result(cowork_payload, stem, episode_meta, assigned_catalog, _full_catalog)
        payload["extractor"]["dbMovieCount"] = len(assigned_catalog)
        payload["extractor"]["dbSources"] = _summarize_db_sources(db_movies or [])
    elif not has_transcript:
        assigned = [
            em for em in db_movies
            if (em.source if hasattr(em, "source") else em.get("source")) != "catalog_fallback"
        ]
        if not assigned:
            raise FileNotFoundError(
                f"Transcript not found: {transcript_file} "
                f"(and no Convex episode movies found for {stem})"
            )
        catalog = _build_catalog_from_episode_movies(assigned)
        print(f"Transcript not found; using {len(catalog)} Convex episode movie(s) for {stem}.")
        payload = _db_only_result(stem, episode_meta, catalog, settings)
        payload["extractor"]["dbMovieCount"] = len(catalog)
        payload["extractor"]["dbSources"] = _summarize_db_sources(assigned)
    else:
        payload = _extract_with_transcript(
            context, transcript_file, config, settings, stem, catalog, episode_meta, db_movies,
        )

    _write_output(output_path, payload)
    context["movie_extraction_path"] = str(output_path)
    context["extracted_movies"] = payload["movies"]
    context["db_episode"] = db_episode
    context["db_episode_movies"] = db_movies
    print(f"Movie extraction JSON written to {output_path}")


def _extract_with_transcript(
    context: dict,
    transcript_file: Path,
    config: dict[str, Any],
    settings: dict[str, Any],
    stem: str,
    catalog: list[MovieCatalogItem] | None,
    episode_meta: EpisodeMetadata | None,
    db_movies: list,
) -> dict[str, Any]:
    if catalog is not None:
        # A whole-catalog fallback widens what can be matched; only real episode
        # assignments are listed without transcript evidence.
        has_assignments = any(
            (em.source if hasattr(em, "source") else em.get("source")) != "catalog_fallback"
            for em in db_movies
        )
        # Target extraction to known episode movies.
        payload = extract_movies_from_segments(
            _load_transcript(transcript_file),
            catalog,
            config=config,
            stem=stem,
            episode_meta=episode_meta,
            ensure_catalog_movies=has_assignments,
        )
        # Preserve legacy artifact field names while sourcing from Convex.
        payload["extractor"]["dbEpisodeId"] = episode_meta.id if episode_meta else None
        payload["extractor"]["dbEpisodeNumber"] = episode_meta.number if episode_meta else None
        payload["extractor"]["dbEpisodeTitle"] = episode_meta.title if episode_meta else None
        payload["extractor"]["dbMovieCount"] = len(catalog)
        payload["extractor"]["dbSources"] = _summarize_db_sources(db_movies)
    else:
        # Fallback: full catalog extraction
        payload = extract_movies_from_transcript(
            transcript_file,
            config=config,
            episode_path=context.get("episode_path"),
        )
    return payload


def resolve_episode_from_filename(
    stem: str,
    client: ConvexPipelineClient,
) -> EpisodeMetadata | None:
    return _resolve_episode_from_filename(client, stem)


def load_movie_catalog(
    client: ConvexPipelineClient,
) -> list[MovieCatalogItem]:
    return _load_movie_catalog(client)


def build_evidence_windows(segments: Sequence[dict[str, Any]]) -> list[EvidenceWindow]:
    return _build_evidence_windows(segments)


def score_catalog_movies(
    windows: Sequence[EvidenceWindow],
    catalog: Sequence[MovieCatalogItem],
) -> tuple[list[CandidateState], list[EvidenceWindow]]:
    return _score_catalog_movies(windows, catalog)


def rerank_with_llm(
    episode_stem: str,
    episode_meta: EpisodeMetadata | None,
    candidates: Sequence[CandidateState],
    review_windows: Sequence[EvidenceWindow],
    settings: dict[str, Any],
) -> tuple[set[int], list[dict[str, Any]], bool]:
    return _rerank_with_llm(episode_stem, episode_meta, candidates, review_windows, settings)


def write_output(path: Path, payload: dict[str, Any]) -> None:
    _write_output(path, payload)


def extract_movies_from_transcript(
    transcript_path: Path | str,
    *,
    config: Optional[dict[str, Any]] = None,
    episode_path: Optional[Path | str] = None,
    client: Optional[ConvexPipelineClient] = None,
    catalog: Optional[Sequence[MovieCatalogItem]] = None,
) -> dict[str, Any]:
    transcript_file = Path(transcript_path).expanduser().resolve()
    if not transcript_file.is_file():
        raise FileNotFoundError(f"Transcript not found: {transcript_file}")

    config = config or {}
    settings = _settings(config)
    stem = Path(episode_path).stem if episode_path else transcript_file.stem
    segments = _load_transcript(transcript_file)

    if client is None and catalog is not None:
        return _extract_result(stem, None, segments, list(catalog), settings)

    convex = client or ConvexPipelineClient.from_environment()
    episode_meta = _resolve_episode_from_filename(convex, stem)
    active_catalog = (
        list(catalog)
        if catalog is not None
        else _load_movie_catalog(convex)
    )
    return _extract_result(
        stem,
        episode_meta,
        segments,
        active_catalog,
        settings,
    )


def extract_movies_from_segments(
    segments: Sequence[dict[str, Any]],
    catalog: Sequence[MovieCatalogItem],
    *,
    config: Optional[dict[str, Any]] = None,
    stem: str = "20260101",
    episode_meta: EpisodeMetadata | None = None,
    ensure_catalog_movies: bool = False,
) -> dict[str, Any]:
    return _extract_result(
        stem,
        episode_meta,
        segments,
        list(catalog),
        _settings(config or {}),
        ensure_catalog_movies=ensure_catalog_movies,
    )
