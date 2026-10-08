from __future__ import annotations

from lib import episode_db
from lib.convex_client import (
    PipelineEpisode,
    PipelineEpisodeMovie,
    PipelineEpisodeShow,
    PipelineMovie,
)


def _episode() -> PipelineEpisode:
    return PipelineEpisode(
        id="episode-1",
        number=42,
        title="The Answer",
        date="2026-07-24",
        slug="episode-42-the-answer",
        status="published",
        description=None,
        notes=None,
        seo_title=None,
        seo_description=None,
        seo_keywords=None,
    )


def _episode_movie() -> PipelineEpisodeMovie:
    return PipelineEpisodeMovie(
        movie_id="movie-1",
        title="Arrival",
        year=2016,
        poster=None,
        source="assignment",
        assignment_type="HOMEWORK",
    )


def _episode_show() -> PipelineEpisodeShow:
    return PipelineEpisodeShow(
        show_id="show-1",
        title="Severance",
        year=2022,
        poster="https://example.test/severance.jpg",
    )


class FakeEpisodeClient:
    def __init__(self) -> None:
        self.dates: list[str] = []
        self.ids: list[str] = []

    def get_episode_by_date(self, date: str) -> PipelineEpisode | None:
        self.dates.append(date)
        return _episode()

    def get_episode_context_by_date(
        self, date: str
    ) -> tuple[PipelineEpisode, tuple[PipelineEpisodeMovie, ...]] | None:
        self.dates.append(date)
        return _episode(), (_episode_movie(),)

    def get_episode_context_by_id(
        self, episode_id: str
    ) -> tuple[PipelineEpisode, tuple[PipelineEpisodeMovie, ...]] | None:
        self.ids.append(episode_id)
        return _episode(), (_episode_movie(),)

    def get_episode_shows_by_date(
        self, date: str
    ) -> tuple[PipelineEpisodeShow, ...]:
        self.dates.append(date)
        return (_episode_show(),)


def test_resolves_episode_stem_and_preserves_legacy_mapping() -> None:
    client = FakeEpisodeClient()

    resolved = episode_db.resolve_episode_by_stem(client, "20260724")

    assert client.dates == ["2026-07-24"]
    assert resolved == {
        "id": "episode-1",
        "number": 42,
        "title": "The Answer",
        "date": "2026-07-24",
        "slug": "episode-42-the-answer",
        "status": "published",
        "description": None,
        "notes": None,
        "seoTitle": None,
        "seoDescription": None,
        "seoKeywords": None,
    }
    assert episode_db.resolve_episode_by_stem(client, "not-a-date") is None


def test_maps_bounded_episode_relationships() -> None:
    client = FakeEpisodeClient()

    movies = episode_db.get_episode_movies(client, "episode-1")

    assert client.ids == ["episode-1"]
    assert movies == [
        episode_db.EpisodeMovie(
            movie_id="movie-1",
            title="Arrival",
            year=2016,
            source="assignment",
            assignment_type="HOMEWORK",
        )
    ]


def test_resolves_episode_and_movies_from_one_date_context() -> None:
    client = FakeEpisodeClient()

    episode, movies = episode_db.get_episode_movies_by_stem(
        client,
        "20260724",
    )

    assert client.dates == ["2026-07-24"]
    assert episode is not None
    assert episode["id"] == "episode-1"
    assert [movie.movie_id for movie in movies] == ["movie-1"]


def test_resolves_show_extras_by_stem() -> None:
    client = FakeEpisodeClient()

    shows = episode_db.get_episode_shows_by_stem(client, "20260724")

    assert client.dates == ["2026-07-24"]
    assert shows == [_episode_show()]
    assert episode_db.get_episode_shows_by_stem(client, "not-a-date") == []
    assert client.dates == ["2026-07-24"]


def test_fallback_catalog_only_applies_without_relationships() -> None:
    class EmptyClient(FakeEpisodeClient):
        def get_episode_context_by_id(
            self, episode_id: str
        ) -> tuple[PipelineEpisode, tuple[PipelineEpisodeMovie, ...]] | None:
            self.ids.append(episode_id)
            return _episode(), ()

    fallback = [
        PipelineMovie(
            movie_id="movie-2",
            title="Moon",
            year=2009,
            poster=None,
        ),
        {"id": "movie-3", "title": "Heat", "year": 1995},
    ]

    movies = episode_db.get_episode_movies_with_fallback(
        EmptyClient(),
        "episode-1",
        fallback,
    )

    assert [movie.movie_id for movie in movies] == ["movie-2", "movie-3"]
    assert {movie.source for movie in movies} == {"catalog_fallback"}
