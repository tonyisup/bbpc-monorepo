"""Episode content queries backed by the authenticated Convex service API."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lib.convex_client import ConvexPipelineClient, PipelineEpisode


@dataclass(frozen=True)
class EpisodeMovie:
    """A movie known to have been reviewed on a specific episode."""
    movie_id: str
    title: str
    year: int | None
    source: str          # "assignment" or "extra_review"
    assignment_type: str | None  # HOMEWORK, EXTRA_CREDIT, BONUS, or None


def _episode_dict(episode: PipelineEpisode) -> dict[str, Any]:
    return {
        "id": episode.id,
        "number": episode.number,
        "title": episode.title,
        "date": episode.date,
        "slug": episode.slug,
        "status": episode.status,
        "description": episode.description,
        "notes": episode.notes,
        "seoTitle": episode.seo_title,
        "seoDescription": episode.seo_description,
        "seoKeywords": episode.seo_keywords,
    }


def resolve_episode_by_date(
    client: ConvexPipelineClient,
    date_str: str,
) -> dict[str, Any] | None:
    """Look up an episode by exact calendar date."""
    episode = client.get_episode_by_date(date_str)
    return None if episode is None else _episode_dict(episode)


def resolve_episode_by_stem(
    client: ConvexPipelineClient,
    stem: str,
) -> dict[str, Any] | None:
    """Look up an episode by filename stem (YYYYMMDD)."""
    if len(stem) < 8 or not stem[:8].isdigit():
        return None
    date_str = f"{stem[:4]}-{stem[4:6]}-{stem[6:8]}"
    return resolve_episode_by_date(client, date_str)


def get_episode_movies(
    client: ConvexPipelineClient,
    episode_id: str,
) -> list[EpisodeMovie]:
    """Return the bounded assignment and extra-review movie context."""
    context = client.get_episode_context_by_id(episode_id)
    if context is None:
        return []
    _, movies = context
    return [
        EpisodeMovie(
            movie_id=movie.movie_id,
            title=movie.title,
            year=movie.year,
            source=movie.source,
            assignment_type=movie.assignment_type,
        )
        for movie in movies
    ]


def get_episode_movies_by_stem(
    client: ConvexPipelineClient,
    stem: str,
) -> tuple[dict[str, Any] | None, list[EpisodeMovie]]:
    """Convenience: resolve episode by stem, then fetch its movies."""
    if len(stem) < 8 or not stem[:8].isdigit():
        return None, []
    date_str = f"{stem[:4]}-{stem[4:6]}-{stem[6:8]}"
    context = client.get_episode_context_by_date(date_str)
    if context is None:
        return None, []
    episode, movies = context
    return (
        _episode_dict(episode),
        [
            EpisodeMovie(
                movie_id=movie.movie_id,
                title=movie.title,
                year=movie.year,
                source=movie.source,
                assignment_type=movie.assignment_type,
            )
            for movie in movies
        ],
    )


def get_episode_movies_with_fallback(
    client: ConvexPipelineClient,
    episode_id: str,
    full_catalog: list[Any] | None = None,
) -> list[EpisodeMovie]:
    """Get an episode's canonical movies, with optional catalog fallback.

    If the episode has no Convex assignments/extras (e.g. old episodes), falls
    back to the full Movie catalog so transcript extraction still works.
    """
    movies = get_episode_movies(client, episode_id)
    if movies:
        return movies

    return catalog_fallback_movies(full_catalog)


def catalog_fallback_movies(
    full_catalog: list[Any] | None,
) -> list[EpisodeMovie]:
    """Convert a supplied catalog into relationship-shaped fallback rows."""
    if full_catalog:
        result = []
        for item in full_catalog:
            if hasattr(item, 'movie_id'):
                result.append(EpisodeMovie(
                    movie_id=item.movie_id,
                    title=item.title,
                    year=item.year,
                    source="catalog_fallback",
                    assignment_type=None,
                ))
            elif isinstance(item, dict):
                result.append(EpisodeMovie(
                    movie_id=str(item.get("movie_id", item.get("id", ""))),
                    title=str(item.get("title", "")),
                    year=item.get("year"),
                    source="catalog_fallback",
                    assignment_type=None,
                ))
        return result

    return []
