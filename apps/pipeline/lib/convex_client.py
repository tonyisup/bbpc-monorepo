"""Authenticated, runtime-validated Convex client for the BBPC pipeline."""
from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterator, Mapping, Sequence

import requests

BBPC_API_VERSION = "0.1.0"
DEFAULT_PAGE_SIZE = 100
MAX_SAFE_INTEGER = 9_007_199_254_740_991
RETRYABLE_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})


class ConvexPipelineError(RuntimeError):
    """Base class for safe pipeline-facing Convex failures."""


class ConvexTransportError(ConvexPipelineError):
    """Raised when the Convex HTTP boundary cannot be reached safely."""


class ConvexContractError(ConvexPipelineError):
    """Raised when Convex returns a response outside the pinned contract."""


class ConvexFunctionError(ConvexPipelineError):
    """A structured domain error returned by a Convex function."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        retryable: bool,
        details: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = dict(details or {})


class ClerkM2MTokenError(ConvexPipelineError):
    """Raised when a short-lived Clerk machine JWT cannot be minted safely."""


TokenMint = Callable[[str, int], tuple[str, int]]


class ClerkM2MTokenProvider:
    """Caches and refreshes short-lived Clerk JWTs for a scoped receiver."""

    def __init__(
        self,
        *,
        machine_secret_key: str,
        ttl_seconds: int = 900,
        refresh_margin_seconds: int = 60,
        clock: Callable[[], float] = time.time,
        mint_token: TokenMint | None = None,
    ) -> None:
        secret = machine_secret_key.strip()
        if not secret:
            raise ValueError("Clerk machine secret key is required.")
        if ttl_seconds < 60 or ttl_seconds > 3600:
            raise ValueError(
                "Clerk M2M token TTL must be between 60 and 3600 seconds."
            )
        if (
            refresh_margin_seconds < 1
            or refresh_margin_seconds >= ttl_seconds
        ):
            raise ValueError(
                "Clerk M2M refresh margin must be positive and below the TTL."
            )
        self._machine_secret_key = secret
        self._ttl_seconds = ttl_seconds
        self._refresh_margin_seconds = refresh_margin_seconds
        self._clock = clock
        self._mint_token = mint_token or self._mint_with_clerk
        self._cached_token: str | None = None
        self._cached_expiration_ms = 0
        self._lock = threading.Lock()

    @staticmethod
    def _mint_with_clerk(
        machine_secret_key: str,
        ttl_seconds: int,
    ) -> tuple[str, int]:
        try:
            import clerk_backend_api
            from clerk_backend_api import Clerk
        except ImportError as exc:
            raise ClerkM2MTokenError(
                "The clerk-backend-api dependency is required to mint "
                "pipeline JWTs."
            ) from exc

        try:
            with Clerk(bearer_auth=machine_secret_key) as clerk:
                response = clerk.m2m.create_token(
                    token_format=clerk_backend_api.TokenFormat.JWT,
                    seconds_until_expiration=ttl_seconds,
                )
        except Exception as exc:
            raise ClerkM2MTokenError(
                "Clerk could not mint a pipeline M2M JWT."
            ) from exc

        token = getattr(response, "token", None)
        expiration = getattr(response, "expiration", None)
        if (
            not isinstance(token, str)
            or not token
            or isinstance(expiration, bool)
            or not isinstance(expiration, (int, float))
        ):
            raise ClerkM2MTokenError(
                "Clerk returned an invalid pipeline M2M token response."
            )
        return token, int(expiration)

    def __call__(self) -> str:
        with self._lock:
            now_ms = int(self._clock() * 1000)
            refresh_at_ms = (
                self._cached_expiration_ms
                - self._refresh_margin_seconds * 1000
            )
            if (
                self._cached_token is not None
                and now_ms < refresh_at_ms
            ):
                return self._cached_token

            token, expiration_ms = self._mint_token(
                self._machine_secret_key,
                self._ttl_seconds,
            )
            token = token.strip()
            if (
                not token
                or expiration_ms
                <= now_ms + self._refresh_margin_seconds * 1000
            ):
                raise ClerkM2MTokenError(
                    "Clerk returned a pipeline JWT without a safe lifetime."
                )
            self._cached_token = token
            self._cached_expiration_ms = expiration_ms
            return token


@dataclass(frozen=True)
class PipelineEpisode:
    id: str
    number: int
    title: str
    date: str | None
    slug: str | None
    status: str | None
    description: str | None
    notes: str | None
    seo_title: str | None
    seo_description: str | None
    seo_keywords: str | None


@dataclass(frozen=True)
class PipelineEpisodeMovie:
    movie_id: str
    title: str
    year: int
    poster: str | None
    source: str
    assignment_type: str | None


@dataclass(frozen=True)
class PipelineEpisodeShow:
    show_id: str
    title: str
    year: int
    poster: str | None


@dataclass(frozen=True)
class PipelineMovie:
    movie_id: str
    title: str
    year: int
    poster: str | None


@dataclass(frozen=True)
class PipelinePage:
    items: tuple[Mapping[str, object], ...]
    is_done: bool
    continue_cursor: str


def stable_operation_id(
    prefix: str,
    payload: Mapping[str, object],
) -> str:
    """Build a portable idempotency label without embedding content values."""
    encoded = json.dumps(
        payload,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()[:24]
    safe_prefix = prefix.strip().replace("/", ":")
    return f"{safe_prefix}:{digest}"


def _require_mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ConvexContractError(f"{label} must be an object.")
    return value


def _require_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ConvexContractError(f"{label} must be a non-empty string.")
    return value


def _require_text(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ConvexContractError(f"{label} must be a string.")
    return value


def _require_nullable_string(value: object, label: str) -> str | None:
    if value is None:
        return None
    return _require_text(value, label)


def _require_int(value: object, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or abs(value) > MAX_SAFE_INTEGER
        or not math.isfinite(value)
        or not float(value).is_integer()
    ):
        raise ConvexContractError(f"{label} must be an integer.")
    return int(value)


def _require_bool(value: object, label: str) -> bool:
    if not isinstance(value, bool):
        raise ConvexContractError(f"{label} must be a boolean.")
    return value


def _episode(value: object) -> PipelineEpisode:
    item = _require_mapping(value, "Pipeline episode")
    return PipelineEpisode(
        id=_require_string(item.get("id"), "Pipeline episode id"),
        number=_require_int(item.get("number"), "Pipeline episode number"),
        title=_require_string(item.get("title"), "Pipeline episode title"),
        date=_require_nullable_string(item.get("date"), "Pipeline episode date"),
        slug=_require_nullable_string(item.get("slug"), "Pipeline episode slug"),
        status=_require_nullable_string(
            item.get("status"), "Pipeline episode status"
        ),
        description=_require_nullable_string(
            item.get("description"), "Pipeline episode description"
        ),
        notes=_require_nullable_string(item.get("notes"), "Pipeline episode notes"),
        seo_title=_require_nullable_string(
            item.get("seoTitle"), "Pipeline episode SEO title"
        ),
        seo_description=_require_nullable_string(
            item.get("seoDescription"), "Pipeline episode SEO description"
        ),
        seo_keywords=_require_nullable_string(
            item.get("seoKeywords"), "Pipeline episode SEO keywords"
        ),
    )


def _episode_movie(value: object) -> PipelineEpisodeMovie:
    item = _require_mapping(value, "Pipeline episode movie")
    source = _require_string(item.get("source"), "Pipeline movie source")
    if source not in {"assignment", "extra_review"}:
        raise ConvexContractError("Pipeline movie source is unsupported.")
    return PipelineEpisodeMovie(
        movie_id=_require_string(item.get("id"), "Pipeline movie id"),
        title=_require_string(item.get("title"), "Pipeline movie title"),
        year=_require_int(item.get("year"), "Pipeline movie year"),
        poster=_require_nullable_string(
            item.get("poster"), "Pipeline movie poster"
        ),
        source=source,
        assignment_type=_require_nullable_string(
            item.get("assignmentType"), "Pipeline assignment type"
        ),
    )


def _episode_show(value: object) -> PipelineEpisodeShow:
    item = _require_mapping(value, "Pipeline episode show")
    return PipelineEpisodeShow(
        show_id=_require_string(item.get("id"), "Pipeline show id"),
        title=_require_string(item.get("title"), "Pipeline show title"),
        year=_require_int(item.get("year"), "Pipeline show year"),
        poster=_require_nullable_string(
            item.get("poster"), "Pipeline show poster"
        ),
    )


def _movie(value: object) -> PipelineMovie:
    item = _require_mapping(value, "Pipeline movie")
    return PipelineMovie(
        movie_id=_require_string(item.get("id"), "Pipeline movie id"),
        title=_require_string(item.get("title"), "Pipeline movie title"),
        year=_require_int(item.get("year"), "Pipeline movie year"),
        poster=_require_nullable_string(
            item.get("poster"), "Pipeline movie poster"
        ),
    )


def _episode_context(
    value: object,
) -> tuple[PipelineEpisode, tuple[PipelineEpisodeMovie, ...]] | None:
    if value is None:
        return None
    context = _require_mapping(value, "Pipeline episode context")
    movies = context.get("movies")
    if not isinstance(movies, list):
        raise ConvexContractError(
            "Pipeline episode context movies must be an array."
        )
    return (
        _episode(context.get("episode")),
        tuple(_episode_movie(movie) for movie in movies),
    )


def _episode_shows(value: object) -> tuple[PipelineEpisodeShow, ...]:
    if value is None:
        return ()
    context = _require_mapping(value, "Pipeline episode context")
    # A backend deployed before show extras were added omits the field.
    shows = context.get("shows", [])
    if not isinstance(shows, list):
        raise ConvexContractError(
            "Pipeline episode context shows must be an array."
        )
    return tuple(_episode_show(show) for show in shows)


class ConvexPipelineClient:
    """Synchronous Functions API client with bounded retries."""

    @classmethod
    def from_environment(cls) -> "ConvexPipelineClient":
        from lib.runtime_config import (
            get_clerk_m2m_refresh_margin_seconds,
            get_clerk_m2m_token_ttl_seconds,
            get_convex_max_attempts,
            get_convex_timeout_seconds,
            get_convex_url,
            resolve_convex_pipeline_auth,
        )

        token, machine_secret = resolve_convex_pipeline_auth()
        token_provider = None
        if machine_secret is not None:
            ttl_seconds = get_clerk_m2m_token_ttl_seconds()
            token_provider = ClerkM2MTokenProvider(
                machine_secret_key=machine_secret,
                ttl_seconds=ttl_seconds,
                refresh_margin_seconds=(
                    get_clerk_m2m_refresh_margin_seconds(ttl_seconds)
                ),
            )
        return cls(
            deployment_url=get_convex_url(),
            access_token=token,
            access_token_provider=token_provider,
            timeout_seconds=get_convex_timeout_seconds(),
            max_attempts=get_convex_max_attempts(),
        )

    def __init__(
        self,
        *,
        deployment_url: str,
        access_token: str | None = None,
        access_token_provider: Callable[[], str] | None = None,
        timeout_seconds: float = 30.0,
        max_attempts: int = 3,
        session: requests.Session | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        url = deployment_url.strip().rstrip("/")
        token = None if access_token is None else access_token.strip()
        if not url.startswith(("https://", "http://127.0.0.1:", "http://localhost:")):
            raise ValueError(
                "Convex deployment URL must use HTTPS or an explicit local host."
            )
        if (token is None) == (access_token_provider is None):
            raise ValueError(
                "Provide exactly one Convex access token or token provider."
            )
        if token is not None and not token:
            raise ValueError("Convex pipeline access token is required.")
        if timeout_seconds <= 0:
            raise ValueError("Convex timeout must be greater than zero.")
        if max_attempts < 1 or max_attempts > 5:
            raise ValueError("Convex max attempts must be between 1 and 5.")
        self._deployment_url = url
        self._access_token_provider = (
            access_token_provider
            if access_token_provider is not None
            else lambda: token or ""
        )
        self._timeout_seconds = timeout_seconds
        self._max_attempts = max_attempts
        self._session = session or requests.Session()
        self._sleeper = sleeper

    def _sleep_before_retry(self, attempt: int) -> None:
        self._sleeper(min(0.25 * (2 ** (attempt - 1)), 2.0))

    def _request(
        self,
        function_type: str,
        path: str,
        args: Mapping[str, object],
        *,
        idempotent: bool,
    ) -> object:
        can_retry = function_type == "query" or idempotent
        endpoint = f"{self._deployment_url}/api/{function_type}"
        for attempt in range(1, self._max_attempts + 1):
            access_token = self._access_token_provider().strip()
            if not access_token:
                raise ConvexTransportError(
                    "The Convex pipeline token provider returned no token."
                )
            try:
                response = self._session.post(
                    endpoint,
                    headers={
                        "Accept": "application/json",
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json={"path": path, "args": dict(args), "format": "json"},
                    timeout=self._timeout_seconds,
                )
            except requests.RequestException as exc:
                if can_retry and attempt < self._max_attempts:
                    self._sleep_before_retry(attempt)
                    continue
                raise ConvexTransportError(
                    "Convex request failed before a response was received."
                ) from exc

            if response.status_code in RETRYABLE_HTTP_STATUSES:
                if can_retry and attempt < self._max_attempts:
                    self._sleep_before_retry(attempt)
                    continue
                raise ConvexTransportError(
                    f"Convex returned retryable HTTP status {response.status_code}."
                )
            if response.status_code < 200 or response.status_code >= 300:
                raise ConvexTransportError(
                    f"Convex returned HTTP status {response.status_code}."
                )
            try:
                envelope = _require_mapping(
                    response.json(), "Convex response envelope"
                )
            except (ValueError, TypeError) as exc:
                raise ConvexContractError(
                    "Convex response was not valid JSON."
                ) from exc
            status = envelope.get("status")
            if status == "success":
                if "value" not in envelope:
                    raise ConvexContractError(
                        "Convex success response omitted its value."
                    )
                return envelope["value"]
            if status != "error":
                raise ConvexContractError(
                    "Convex response status is outside the pinned contract."
                )
            data = _require_mapping(
                envelope.get("errorData"), "Convex error data"
            )
            code = _require_string(data.get("code"), "Convex error code")
            message = _require_string(
                data.get("message"), "Convex error message"
            )
            retryable = _require_bool(
                data.get("retryable"), "Convex retryable flag"
            )
            details_value = data.get("details")
            details = (
                None
                if details_value is None
                else _require_mapping(details_value, "Convex error details")
            )
            error = ConvexFunctionError(
                code=code,
                message=message,
                retryable=retryable,
                details=details,
            )
            if retryable and can_retry and attempt < self._max_attempts:
                self._sleep_before_retry(attempt)
                continue
            raise error
        raise AssertionError("Convex retry loop exited unexpectedly.")

    def _query(self, path: str, args: Mapping[str, object]) -> object:
        return self._request("query", path, args, idempotent=True)

    def _mutation(self, path: str, args: Mapping[str, object]) -> object:
        return self._request("mutation", path, args, idempotent=True)

    def capabilities(self) -> tuple[str, ...]:
        value = _require_mapping(
            self._query("pipeline/status:capabilities", {}),
            "Pipeline capabilities",
        )
        permissions = value.get("permissions")
        if not isinstance(permissions, list):
            raise ConvexContractError(
                "Pipeline capabilities permissions must be an array."
            )
        return tuple(
            _require_string(item, "Pipeline permission")
            for item in permissions
        )

    def get_episode_by_date(self, date: str) -> PipelineEpisode | None:
        value = self._query(
            "pipeline/content:getEpisodeByDate", {"date": date}
        )
        return None if value is None else _episode(value)

    def get_episode_context_by_date(
        self, date: str
    ) -> tuple[PipelineEpisode, tuple[PipelineEpisodeMovie, ...]] | None:
        return _episode_context(
            self._query(
                "pipeline/content:getEpisodeContextByDate", {"date": date}
            )
        )

    def get_episode_context_by_id(
        self, episode_id: str
    ) -> tuple[PipelineEpisode, tuple[PipelineEpisodeMovie, ...]] | None:
        return _episode_context(
            self._query(
                "pipeline/content:getEpisodeContextById",
                {"id": episode_id},
            )
        )

    def get_episode_shows_by_date(
        self, date: str
    ) -> tuple[PipelineEpisodeShow, ...]:
        """Return the TV shows reviewed as extras on the dated episode."""
        return _episode_shows(
            self._query(
                "pipeline/content:getEpisodeContextByDate", {"date": date}
            )
        )

    def _page(
        self, path: str, cursor: str | None, page_size: int
    ) -> PipelinePage:
        value = _require_mapping(
            self._query(
                path,
                {
                    "paginationOpts": {
                        "cursor": cursor,
                        "numItems": page_size,
                    }
                },
            ),
            "Pipeline page",
        )
        page = value.get("page")
        if not isinstance(page, list):
            raise ConvexContractError("Pipeline page items must be an array.")
        return PipelinePage(
            items=tuple(
                _require_mapping(item, "Pipeline page item")
                for item in page
            ),
            is_done=_require_bool(value.get("isDone"), "Pipeline page done flag"),
            continue_cursor=_require_text(
                value.get("continueCursor"), "Pipeline continue cursor"
            ),
        )

    def iter_movie_catalog(
        self, page_size: int = DEFAULT_PAGE_SIZE
    ) -> Iterator[PipelineMovie]:
        cursor: str | None = None
        while True:
            page = self._page(
                "pipeline/content:listMovieCatalogPage",
                cursor,
                page_size,
            )
            for item in page.items:
                yield _movie(item)
            if page.is_done:
                return
            if page.continue_cursor == cursor:
                raise ConvexContractError(
                    "Pipeline movie pagination did not advance."
                )
            cursor = page.continue_cursor

    def list_episode_dates(
        self, page_size: int = DEFAULT_PAGE_SIZE
    ) -> set[str]:
        cursor: str | None = None
        dates: set[str] = set()
        while True:
            page = self._page(
                "pipeline/content:listEpisodeDatesPage",
                cursor,
                page_size,
            )
            for item in page.items:
                dates.add(
                    _require_string(item.get("date"), "Pipeline episode date")
                )
            if page.is_done:
                return dates
            if page.continue_cursor == cursor:
                raise ConvexContractError(
                    "Pipeline episode pagination did not advance."
                )
            cursor = page.continue_cursor

    def get_movie_posters(
        self, movie_ids: Sequence[str]
    ) -> dict[str, str]:
        value = self._query(
            "pipeline/content:getMoviePosters",
            {"movieIds": list(movie_ids)},
        )
        if not isinstance(value, list):
            raise ConvexContractError(
                "Pipeline poster response must be an array."
            )
        posters: dict[str, str] = {}
        for raw in value:
            item = _require_mapping(raw, "Pipeline movie poster")
            movie_id = _require_string(
                item.get("id"), "Pipeline poster movie id"
            )
            if movie_id in posters:
                raise ConvexContractError(
                    "Pipeline poster response contains duplicate movies."
                )
            posters[movie_id] = _require_string(
                item.get("poster"), "Pipeline poster URL"
            )
        return posters

    def publish_episode_seo(
        self,
        *,
        episode: PipelineEpisode,
        seo_title: str | None,
        seo_description: str | None,
        seo_keywords: str | None,
    ) -> tuple[PipelineEpisode, bool]:
        payload = {
            "date": episode.date,
            "seoTitle": seo_title,
            "seoDescription": seo_description,
            "seoKeywords": seo_keywords,
        }
        if episode.date is None:
            raise ValueError("Cannot publish SEO for an undated episode.")
        value = _require_mapping(
            self._mutation(
                "pipeline/content:publishEpisodeSeo",
                {
                    "clientApiVersion": BBPC_API_VERSION,
                    "operationId": stable_operation_id(
                        f"seo:{episode.date}", payload
                    ),
                    "date": episode.date,
                    "expected": {
                        "seoTitle": episode.seo_title,
                        "seoDescription": episode.seo_description,
                        "seoKeywords": episode.seo_keywords,
                    },
                    "seoTitle": seo_title,
                    "seoDescription": seo_description,
                    "seoKeywords": seo_keywords,
                },
            ),
            "Pipeline SEO result",
        )
        return (
            _episode(value.get("episode")),
            _require_bool(value.get("changed"), "Pipeline SEO changed flag"),
        )

    def upsert_episode_from_audio(
        self,
        *,
        date: str,
        number: int,
        title: str,
    ) -> tuple[PipelineEpisode, bool]:
        payload = {"date": date, "number": number, "title": title}
        value = _require_mapping(
            self._mutation(
                "pipeline/content:upsertEpisodeFromAudio",
                {
                    "clientApiVersion": BBPC_API_VERSION,
                    "operationId": stable_operation_id(
                        f"episode:{date}", payload
                    ),
                    **payload,
                },
            ),
            "Pipeline episode upsert result",
        )
        return (
            _episode(value.get("episode")),
            _require_bool(
                value.get("created"), "Pipeline episode created flag"
            ),
        )
