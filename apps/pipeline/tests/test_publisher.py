from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from lib import publisher
from lib.convex_client import PipelineEpisode


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
        seo_title="Old title",
        seo_description=None,
        seo_keywords=None,
    )


class FakePublisherClient:
    def __init__(
        self,
        episode: PipelineEpisode | None = None,
        *,
        mismatch: bool = False,
    ) -> None:
        self.episode = _episode() if episode is None else episode
        self.mismatch = mismatch
        self.dates: list[str] = []
        self.publish_calls: list[dict[str, object]] = []

    def get_episode_by_date(self, date: str) -> PipelineEpisode | None:
        self.dates.append(date)
        return self.episode

    def publish_episode_seo(
        self,
        *,
        episode: PipelineEpisode,
        seo_title: str | None,
        seo_description: str | None,
        seo_keywords: str | None,
    ) -> tuple[PipelineEpisode, bool]:
        self.publish_calls.append(
            {
                "episode": episode,
                "seo_title": seo_title,
                "seo_description": seo_description,
                "seo_keywords": seo_keywords,
            }
        )
        if self.mismatch:
            return episode, True
        return (
            replace(
                episode,
                seo_title=seo_title.strip() or None
                if seo_title is not None
                else None,
                seo_description=seo_description.strip() or None
                if seo_description is not None
                else None,
                seo_keywords=seo_keywords.strip() or None
                if seo_keywords is not None
                else None,
            ),
            True,
        )


def _context(
    tmp_path: Path,
    client: FakePublisherClient,
    payload: object,
) -> dict[str, object]:
    seo_path = tmp_path / "episode.seo.json"
    seo_path.write_text(json.dumps(payload), encoding="utf-8")
    return {
        "config": {"settings": {}},
        "convex_client": client,
        "episode_path": str(tmp_path / "20260724.mp3"),
        "seo_path": str(seo_path),
    }


def test_publishes_exact_normalized_seo_snapshot(tmp_path: Path) -> None:
    client = FakePublisherClient()
    context = _context(
        tmp_path,
        client,
        {
            "title": " New title ",
            "metaDescription": " Description ",
            "keywords": ["movie", "podcast"],
        },
    )

    publisher.run(context)

    assert client.dates == ["2026-07-24"]
    assert client.publish_calls == [
        {
            "episode": _episode(),
            "seo_title": " New title ",
            "seo_description": " Description ",
            "seo_keywords": "movie, podcast",
        }
    ]


def test_rejects_malformed_seo_before_calling_convex(tmp_path: Path) -> None:
    client = FakePublisherClient()
    context = _context(
        tmp_path,
        client,
        {"title": "Title", "keywords": ["valid", 7]},
    )

    with pytest.raises(
        RuntimeError,
        match="SEO keywords must be an array of strings",
    ):
        publisher.run(context)

    assert client.dates == []
    assert client.publish_calls == []


def test_fails_closed_for_missing_episode_or_response_drift(
    tmp_path: Path,
) -> None:
    missing = FakePublisherClient()
    missing.episode = None
    with pytest.raises(RuntimeError, match="No episode found"):
        publisher.run(
            _context(
                tmp_path,
                missing,
                {"title": "Title", "keywords": []},
            )
        )

    mismatch = FakePublisherClient(mismatch=True)
    with pytest.raises(RuntimeError, match="did not match the request"):
        publisher.run(
            _context(
                tmp_path,
                mismatch,
                {"title": "New title", "keywords": []},
            )
        )
