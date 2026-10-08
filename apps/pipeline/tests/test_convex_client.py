from __future__ import annotations

from collections import deque
from types import SimpleNamespace
from typing import Any

import pytest
import requests

from lib.convex_client import (
    BBPC_API_VERSION,
    ClerkM2MTokenError,
    ClerkM2MTokenProvider,
    ConvexContractError,
    ConvexFunctionError,
    ConvexPipelineClient,
    ConvexTransportError,
    PipelineEpisode,
    PipelineEpisodeShow,
    stable_operation_id,
)


class FakeResponse:
    def __init__(self, status_code: int, payload: object) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> object:
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeSession:
    def __init__(self, *results: object) -> None:
        self.results = deque(results)
        self.calls: list[dict[str, Any]] = []

    def post(self, url: str, **kwargs: object) -> FakeResponse:
        self.calls.append({"url": url, **kwargs})
        result = self.results.popleft()
        if isinstance(result, Exception):
            raise result
        assert isinstance(result, FakeResponse)
        return result


def success(value: object) -> FakeResponse:
    return FakeResponse(200, {"status": "success", "value": value})


def domain_error(
    code: str,
    *,
    retryable: bool = False,
) -> FakeResponse:
    return FakeResponse(
        200,
        {
            "status": "error",
            "errorMessage": "Function failed",
            "errorData": {
                "code": code,
                "message": "Safe domain failure",
                "retryable": retryable,
            },
        },
    )


def episode_payload(**overrides: object) -> dict[str, object]:
    return {
        "id": "episode-1",
        "number": 42,
        "title": "The Answer",
        "date": "2026-07-24",
        "slug": "episode-42-the-answer",
        "status": "published",
        "description": None,
        "notes": None,
        "seoTitle": "Old title",
        "seoDescription": None,
        "seoKeywords": None,
        **overrides,
    }


def client(
    session: FakeSession,
    *,
    attempts: int = 3,
    sleeps: list[float] | None = None,
) -> ConvexPipelineClient:
    sleep_log = sleeps if sleeps is not None else []
    return ConvexPipelineClient(
        deployment_url="https://example.convex.cloud",
        access_token="secret-token",
        max_attempts=attempts,
        session=session,  # type: ignore[arg-type]
        sleeper=sleep_log.append,
    )


def test_authenticates_and_validates_episode_context() -> None:
    session = FakeSession(
        success(
            {
                "episode": episode_payload(number=42.0),
                "movies": [
                    {
                        "id": "movie-1",
                        "title": "Arrival",
                        "year": 2016.0,
                        "poster": None,
                        "source": "assignment",
                        "assignmentType": "HOMEWORK",
                    }
                ],
            }
        )
    )

    result = client(session).get_episode_context_by_date("2026-07-24")

    assert result is not None
    episode, movies = result
    assert episode.id == "episode-1"
    assert movies[0].movie_id == "movie-1"
    assert movies[0].assignment_type == "HOMEWORK"
    call = session.calls[0]
    assert call["url"] == "https://example.convex.cloud/api/query"
    assert call["headers"] == {
        "Accept": "application/json",
        "Authorization": "Bearer secret-token",
        "Content-Type": "application/json",
    }
    assert call["json"] == {
        "path": "pipeline/content:getEpisodeContextByDate",
        "args": {"date": "2026-07-24"},
        "format": "json",
    }


def test_reads_show_extras_from_the_episode_context() -> None:
    session = FakeSession(
        success(
            {
                "episode": episode_payload(),
                "movies": [],
                "shows": [
                    {
                        "id": "show-1",
                        "title": "Severance",
                        "year": 2022.0,
                        "poster": "https://example.test/severance.jpg",
                    }
                ],
            }
        )
    )

    shows = client(session).get_episode_shows_by_date("2026-07-24")

    assert shows == (
        PipelineEpisodeShow(
            show_id="show-1",
            title="Severance",
            year=2022,
            poster="https://example.test/severance.jpg",
        ),
    )
    assert session.calls[0]["json"] == {
        "path": "pipeline/content:getEpisodeContextByDate",
        "args": {"date": "2026-07-24"},
        "format": "json",
    }


@pytest.mark.parametrize(
    "context",
    [None, {"episode": episode_payload(), "movies": []}],
)
def test_show_extras_are_empty_without_an_episode_or_shows_field(
    context: object,
) -> None:
    session = FakeSession(success(context))

    assert client(session).get_episode_shows_by_date("2026-07-24") == ()


@pytest.mark.parametrize(
    "number",
    [
        42.5,
        float("inf"),
        float("nan"),
        True,
        9_007_199_254_740_992,
        10**1000,
    ],
)
def test_rejects_non_integral_or_unsafe_convex_numbers(
    number: object,
) -> None:
    session = FakeSession(success(episode_payload(number=number)))

    with pytest.raises(
        ConvexContractError,
        match="episode number must be an integer",
    ):
        client(session).get_episode_by_date("2026-07-24")


def test_clerk_machine_tokens_are_cached_and_refreshed() -> None:
    now = [1_000.0]
    mint_calls: list[tuple[str, int]] = []

    def mint(secret: str, ttl_seconds: int) -> tuple[str, int]:
        mint_calls.append((secret, ttl_seconds))
        return (
            f"jwt-{len(mint_calls)}",
            int((now[0] + ttl_seconds) * 1000),
        )

    provider = ClerkM2MTokenProvider(
        machine_secret_key="machine-secret",
        ttl_seconds=120,
        refresh_margin_seconds=30,
        clock=lambda: now[0],
        mint_token=mint,
    )

    assert provider() == "jwt-1"
    assert provider() == "jwt-1"
    assert mint_calls == [("machine-secret", 120)]

    now[0] = 1_091.0
    assert provider() == "jwt-2"
    assert mint_calls == [
        ("machine-secret", 120),
        ("machine-secret", 120),
    ]


def test_clerk_machine_token_provider_rejects_unsafe_lifetime() -> None:
    provider = ClerkM2MTokenProvider(
        machine_secret_key="machine-secret",
        ttl_seconds=120,
        refresh_margin_seconds=30,
        clock=lambda: 1_000.0,
        mint_token=lambda _secret, _ttl: (
            "jwt",
            1_020_000,
        ),
    )

    with pytest.raises(ClerkM2MTokenError, match="safe lifetime"):
        provider()


def test_clerk_sdk_mint_requests_scoped_jwt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import clerk_backend_api

    calls: list[dict[str, object]] = []

    class FakeM2M:
        def create_token(self, **kwargs: object) -> object:
            calls.append(kwargs)
            return SimpleNamespace(
                token="minted-jwt",
                expiration=1_234_567,
            )

    class FakeClerk:
        def __init__(self, *, bearer_auth: str) -> None:
            assert bearer_auth == "machine-secret"
            self.m2m = FakeM2M()

        def __enter__(self) -> "FakeClerk":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(clerk_backend_api, "Clerk", FakeClerk)

    token, expiration = ClerkM2MTokenProvider._mint_with_clerk(
        "machine-secret",
        900,
    )

    assert (token, expiration) == ("minted-jwt", 1_234_567)
    assert calls == [
        {
            "token_format": clerk_backend_api.TokenFormat.JWT,
            "seconds_until_expiration": 900,
        }
    ]


def test_convex_client_uses_dynamic_token_provider() -> None:
    session = FakeSession(success(None), success(None))
    tokens = iter(["jwt-1", "jwt-2"])
    convex = ConvexPipelineClient(
        deployment_url="https://example.convex.cloud",
        access_token_provider=lambda: next(tokens),
        session=session,  # type: ignore[arg-type]
    )

    assert convex.get_episode_by_date("2026-07-24") is None
    assert convex.get_episode_by_date("2026-07-31") is None
    assert session.calls[0]["headers"]["Authorization"] == "Bearer jwt-1"
    assert session.calls[1]["headers"]["Authorization"] == "Bearer jwt-2"


def test_retries_transport_and_retryable_domain_failures() -> None:
    sleeps: list[float] = []
    session = FakeSession(
        requests.Timeout("timeout"),
        FakeResponse(503, {}),
        success(
            {
                "permissions": [
                    "pipeline:heartbeat",
                    "pipeline:publish",
                ]
            }
        ),
    )

    assert client(session, sleeps=sleeps).capabilities() == (
        "pipeline:heartbeat",
        "pipeline:publish",
    )
    assert len(session.calls) == 3
    assert sleeps == [0.25, 0.5]

    domain_session = FakeSession(
        domain_error("SERVICE_UNAVAILABLE", retryable=True),
        success(None),
    )
    assert (
        client(domain_session).get_episode_by_date("2026-07-24")
        is None
    )
    assert len(domain_session.calls) == 2


def test_does_not_retry_nonretryable_domain_or_http_failures() -> None:
    session = FakeSession(domain_error("CONFLICT"))
    with pytest.raises(ConvexFunctionError) as exc_info:
        client(session).get_episode_by_date("2026-07-24")
    assert exc_info.value.code == "CONFLICT"
    assert exc_info.value.retryable is False
    assert len(session.calls) == 1

    http_session = FakeSession(FakeResponse(401, {}))
    with pytest.raises(ConvexTransportError, match="HTTP status 401"):
        client(http_session).capabilities()
    assert len(http_session.calls) == 1


def test_paginates_catalog_and_dates_and_validates_posters() -> None:
    session = FakeSession(
        success(
            {
                "page": [
                    {
                        "id": "movie-1",
                        "title": "Arrival",
                        "year": 2016,
                        "poster": "https://example.test/arrival.jpg",
                    }
                ],
                "isDone": False,
                "continueCursor": "cursor-1",
            }
        ),
        success(
            {
                "page": [
                    {
                        "id": "movie-2",
                        "title": "Moon",
                        "year": 2009,
                        "poster": None,
                    }
                ],
                "isDone": True,
                "continueCursor": "",
            }
        ),
        success(
            {
                "page": [
                    {"id": "episode-1", "date": "2026-07-24"},
                    {"id": "episode-2", "date": "2026-07-31"},
                ],
                "isDone": True,
                "continueCursor": "",
            }
        ),
        success(
            [
                {
                    "id": "movie-1",
                    "poster": "https://example.test/arrival.jpg",
                }
            ]
        ),
    )
    convex = client(session)

    assert [movie.title for movie in convex.iter_movie_catalog()] == [
        "Arrival",
        "Moon",
    ]
    assert convex.list_episode_dates() == {
        "2026-07-24",
        "2026-07-31",
    }
    assert convex.get_movie_posters(["movie-1", "movie-2"]) == {
        "movie-1": "https://example.test/arrival.jpg"
    }
    assert session.calls[1]["json"]["args"]["paginationOpts"]["cursor"] == (
        "cursor-1"
    )


def test_mutations_send_exact_snapshots_and_stable_operation_ids() -> None:
    published = episode_payload(
        seoTitle="New title",
        seoDescription="Description",
        seoKeywords="movie, podcast",
    )
    session = FakeSession(
        success({"episode": published, "changed": True}),
        success(
            {
                "episode": episode_payload(
                    id="episode-2",
                    date="2026-07-31",
                    number=43,
                    title="Next Episode",
                    seoTitle=None,
                ),
                "created": True,
            }
        ),
    )
    convex = client(session)
    loaded = PipelineEpisode(
        id="episode-1",
        number=42,
        title="The Answer",
        date="2026-07-24",
        slug="episode-42-the-answer",
        status="published",
        description=None,
        notes=None,
        seo_title="Old title",
        seo_description=None,
        seo_keywords=None,
    )

    updated, changed = convex.publish_episode_seo(
        episode=loaded,
        seo_title="New title",
        seo_description="Description",
        seo_keywords="movie, podcast",
    )
    created, was_created = convex.upsert_episode_from_audio(
        date="2026-07-31",
        number=43,
        title="Next Episode",
    )

    assert changed is True
    assert updated.seo_title == "New title"
    assert was_created is True
    assert created.id == "episode-2"
    seo_args = session.calls[0]["json"]["args"]
    assert seo_args["clientApiVersion"] == BBPC_API_VERSION
    assert seo_args["expected"] == {
        "seoTitle": "Old title",
        "seoDescription": None,
        "seoKeywords": None,
    }
    assert seo_args["operationId"] == stable_operation_id(
        "seo:2026-07-24",
        {
            "date": "2026-07-24",
            "seoTitle": "New title",
            "seoDescription": "Description",
            "seoKeywords": "movie, podcast",
        },
    )
    assert session.calls[1]["json"]["args"]["operationId"] == (
        stable_operation_id(
            "episode:2026-07-31",
            {
                "date": "2026-07-31",
                "number": 43,
                "title": "Next Episode",
            },
        )
    )


def test_rejects_contract_drift_and_unsafe_configuration() -> None:
    with pytest.raises(ConvexContractError, match="movies must be an array"):
        client(
            FakeSession(
                success(
                    {
                        "episode": episode_payload(),
                        "movies": "not-an-array",
                    }
                )
            )
        ).get_episode_context_by_date("2026-07-24")

    with pytest.raises(ConvexContractError, match="shows must be an array"):
        client(
            FakeSession(
                success(
                    {
                        "episode": episode_payload(),
                        "movies": [],
                        "shows": "not-an-array",
                    }
                )
            )
        ).get_episode_shows_by_date("2026-07-24")

    with pytest.raises(ValueError, match="must use HTTPS"):
        ConvexPipelineClient(
            deployment_url="http://remote.example.test",
            access_token="token",
        )
    with pytest.raises(ValueError, match="access token"):
        ConvexPipelineClient(
            deployment_url="https://example.convex.cloud",
            access_token="",
        )
    with pytest.raises(ValueError, match="exactly one"):
        ConvexPipelineClient(
            deployment_url="https://example.convex.cloud",
        )
    with pytest.raises(ValueError, match="exactly one"):
        ConvexPipelineClient(
            deployment_url="https://example.convex.cloud",
            access_token="token",
            access_token_provider=lambda: "other-token",
        )
