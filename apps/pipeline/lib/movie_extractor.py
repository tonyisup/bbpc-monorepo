"""Movies stage: adopt Cowork's reviewed-movie judgement and attach Convex IDs.

Cowork reads the whole transcript and writes ``<stem>.movies.json`` (see
``docs/cowork-handoff.md``). This stage matches those titles to Convex movie
IDs, adds any Convex-assigned movie Cowork did not list, and writes the movie
artifact that ``review_clip`` and ``thumbnail`` read. Without a transcript it
falls back to the episode's Convex assignments so thumbnails can still be built.
There is no heuristic or model-based extraction: when a transcript exists but
the Cowork file does not, the stage stops with ``AwaitingCowork``.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Sequence

from lib import cowork_handoff
from lib.convex_client import ConvexPipelineClient

EXTRACTOR_VERSION = "cowork_v1"

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


def _load_movie_catalog(
    client: ConvexPipelineClient,
) -> list[MovieCatalogItem]:
    global _CATALOG_CACHE
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
    return _CATALOG_CACHE


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
) -> dict[str, Any]:
    """Build the artifact from canonical episode movies when no transcript exists."""
    movies: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    _append_missing_catalog_movies(movies, candidates, catalog)
    return {
        "episode": _episode_payload(stem, episode_meta),
        "extractor": {
            "version": EXTRACTOR_VERSION,
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


def _source(em: Any) -> Any:
    return em.source if hasattr(em, "source") else em.get("source")


def _resolve_convex_episode(context: dict, stem: str) -> tuple[dict | None, list]:
    """Use pre-resolved episode context when given; otherwise ask Convex."""
    db_episode = context.get("db_episode")
    db_movies = context.get("db_episode_movies") or []
    if db_episode and db_movies:
        return db_episode, db_movies
    convex = context.get("convex_client") or ConvexPipelineClient.from_environment()
    from lib import episode_db

    if not db_episode and not db_movies:
        return episode_db.get_episode_movies_by_stem(convex, stem)
    if not db_episode:
        return episode_db.resolve_episode_by_stem(convex, stem), db_movies
    return db_episode, episode_db.get_episode_movies(convex, db_episode["id"])


def _episode_meta(db_episode: dict | None) -> EpisodeMetadata | None:
    if not db_episode:
        return None
    return EpisodeMetadata(
        id=str(db_episode.get("id", "")),
        number=int(db_episode["number"]) if db_episode.get("number") is not None else 0,
        title=str(db_episode.get("title", "")),
        date=str(db_episode.get("date", "")),
    )


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

    # Check for Cowork's file before any Convex traffic: waiting is the common case.
    cowork_payload = cowork_handoff.load_movies(config, stem) if has_transcript else None
    if has_transcript and cowork_payload is None:
        raise cowork_handoff.AwaitingCowork(stem, "movies", cowork_handoff.movies_path(config, stem))

    db_episode, db_movies = _resolve_convex_episode(context, stem)
    db_movies = db_movies or []
    episode_meta = _episode_meta(db_episode)
    assigned_catalog = _build_catalog_from_episode_movies(db_movies) if db_movies else []

    if cowork_payload is not None:
        def _full_catalog():
            client = context.get("convex_client") or ConvexPipelineClient.from_environment()
            return _load_movie_catalog(client)

        print(f"Using Cowork movie extraction: {cowork_handoff.movies_path(config, stem)}")
        payload = _cowork_result(cowork_payload, stem, episode_meta, assigned_catalog, _full_catalog)
    else:
        if not assigned_catalog:
            raise FileNotFoundError(
                f"Transcript not found: {transcript_file} "
                f"(and no Convex episode movies found for {stem})"
            )
        print(f"Transcript not found; using {len(assigned_catalog)} Convex episode movie(s) for {stem}.")
        payload = _db_only_result(stem, episode_meta, assigned_catalog)
    payload["extractor"]["dbMovieCount"] = len(assigned_catalog)
    payload["extractor"]["dbSources"] = _summarize_db_sources(db_movies)

    _write_output(output_path, payload)
    context["movie_extraction_path"] = str(output_path)
    context["extracted_movies"] = payload["movies"]
    context["db_episode"] = db_episode
    context["db_episode_movies"] = db_movies
    print(f"Movie extraction JSON written to {output_path}")
