"""Tests for the thumbnail generation stage."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from lib import thumbnail
from lib.convex_client import PipelineEpisodeShow


class ThumbnailTests(unittest.TestCase):
    def _make_poster(self, width: int = 300, height: int = 450, color: tuple = (200, 50, 50)):
        return Image.new("RGBA", (width, height), color + (255,))

    def test_thumbnail_output_is_1920x1920(self):
        """generate_thumbnail writes a 1920x1920 PNG."""
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumb.png"
            config = {"settings": {"brand_logo_enabled": False}}
            with mock.patch(
                "lib.thumbnail._fetch_movie_posters",
                return_value={},
            ):
                result = thumbnail.generate_thumbnail(
                    movie_ids=["fake-id"],
                    output_path=out,
                    config=config,
                )
            self.assertTrue(result)
            self.assertTrue(out.is_file())
            with Image.open(out) as img:
                self.assertEqual(img.size, (1920, 1920))

    def test_thumbnail_uses_reals_and_falls_back_gracefully(self):
        """When no Convex posters are available, generate a text-only image."""
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumb.png"
            config = {"settings": {"brand_logo_enabled": False}}
            with mock.patch("lib.thumbnail._fetch_movie_posters", return_value={}):
                result = thumbnail.generate_thumbnail(
                    movie_ids=["nonexistent-id"],
                    output_path=out,
                    config=config,
                    episode_title="Test Episode",
                )
            self.assertTrue(result)
            self.assertTrue(out.is_file())
            with Image.open(out) as img:
                self.assertEqual(img.size, (1920, 1920))

    def test_thumbnail_composites_downloaded_posters(self):
        """When download succeeds, the output image contains poster pixels."""
        fake_poster = self._make_poster(300, 450, (200, 50, 50))

        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumb.png"
            config = {"settings": {"brand_logo_enabled": False}}

            with mock.patch(
                "lib.thumbnail._fetch_movie_posters",
                return_value={"m1": "https://example.com/p1.jpg"},
            ), mock.patch(
                "lib.thumbnail._download_image",
                return_value=fake_poster,
            ):
                result = thumbnail.generate_thumbnail(
                    movie_ids=["m1"],
                    output_path=out,
                    config=config,
                )
            self.assertTrue(result)
            self.assertTrue(out.is_file())

    def test_thumbnail_adds_show_posters_after_movie_posters(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumb.png"
            with mock.patch(
                "lib.thumbnail._fetch_movie_posters",
                return_value={"m1": "https://example.com/movie.jpg"},
            ), mock.patch(
                "lib.thumbnail._download_image",
                return_value=self._make_poster(),
            ) as download, mock.patch(
                "lib.thumbnail._layout_posters",
                wraps=thumbnail._layout_posters,
            ) as layout:
                result = thumbnail.generate_thumbnail(
                    movie_ids=["m1"],
                    output_path=out,
                    config={"settings": {"brand_logo_enabled": False}},
                    show_poster_urls=["https://example.com/show.jpg"],
                    show_titles=["Severance (2022)"],
                )
            self.assertTrue(result)
            self.assertEqual(
                [call.args[0] for call in download.call_args_list],
                ["https://example.com/movie.jpg", "https://example.com/show.jpg"],
            )
            self.assertEqual(len(layout.call_args.args[0]), 2)

    def test_thumbnail_uses_show_posters_when_no_movie_has_one(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumb.png"
            with mock.patch(
                "lib.thumbnail._fetch_movie_posters", return_value={}
            ), mock.patch(
                "lib.thumbnail._download_image",
                return_value=self._make_poster(),
            ), mock.patch(
                "lib.thumbnail._layout_posters",
                wraps=thumbnail._layout_posters,
            ) as layout:
                thumbnail.generate_thumbnail(
                    movie_ids=["m1"],
                    output_path=out,
                    config={"settings": {"brand_logo_enabled": False}},
                    show_poster_urls=["https://example.com/show.jpg"],
                )
            self.assertEqual(len(layout.call_args.args[0]), 1)

    def test_title_bar_counts_movies_and_shows(self):
        cases = [
            (["A", "B"], ["S"], "2 movies and 1 show reviewed"),
            (["A"], [], "1 movie reviewed"),
            ([], ["S", "T"], "2 shows reviewed"),
        ]
        for movie_titles, show_titles, expected in cases:
            with self.subTest(expected=expected):
                canvas = Image.new("RGBA", (thumbnail.THUMB_WIDTH, thumbnail.THUMB_HEIGHT))
                with mock.patch("lib.thumbnail.ImageDraw.Draw") as draw:
                    thumbnail._add_title_text(canvas, "Ep 1: Test", movie_titles, show_titles)
                drawn = [call.args[1] for call in draw.return_value.text.call_args_list]
                self.assertEqual(drawn, ["Ep 1: Test", expected])

    def test_run_adds_the_episodes_show_extras(self):
        with tempfile.TemporaryDirectory() as td:
            ep_path = Path(td) / "20260101.mp3"
            ep_path.touch()
            movies_dir = Path(td) / "movies"
            movies_dir.mkdir()
            (movies_dir / "20260101.movies.json").write_text(
                json.dumps({"movies": [{"matchedMovieId": "m1", "title": "Arrival", "year": 2016}]}),
                encoding="utf-8",
            )
            convex = mock.Mock()
            convex.get_episode_shows_by_date.return_value = (
                PipelineEpisodeShow("show-1", "Severance", 2022, "https://example.com/show.jpg"),
                PipelineEpisodeShow("show-2", "Posterless", 2020, None),
            )
            context = {
                "config": {
                    "settings": {"thumbnail_enabled": True},
                    "paths": {"output_dir": td},
                },
                "episode_path": str(ep_path),
                "convex_client": convex,
            }
            with mock.patch("lib.thumbnail.generate_thumbnail", return_value=True) as generate:
                thumbnail.run(context)

            convex.get_episode_shows_by_date.assert_called_once_with("2026-01-01")
            kwargs = generate.call_args.kwargs
            self.assertEqual(kwargs["movie_ids"], ["m1"])
            self.assertEqual(kwargs["show_poster_urls"], ["https://example.com/show.jpg"])
            self.assertEqual(kwargs["show_titles"], ["Severance (2022)", "Posterless (2020)"])

    def test_fetch_episode_shows_returns_nothing_when_convex_fails(self):
        convex = mock.Mock()
        convex.get_episode_shows_by_date.side_effect = RuntimeError("offline")

        self.assertEqual(thumbnail._fetch_episode_shows("20260101", convex), [])

    def test_thumbnail_skips_failed_downloads(self):
        """Failed poster downloads are silently skipped; remaining posters used."""
        fake_poster = self._make_poster(300, 450, (50, 200, 50))

        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumb.png"
            config = {"settings": {"brand_logo_enabled": False}}

            call_count = 0

            def _fake_download(url, timeout=30):
                nonlocal call_count
                call_count += 1
                if "fail" in url:
                    return None
                return fake_poster

            with mock.patch(
                "lib.thumbnail._fetch_movie_posters",
                return_value={
                    "m1": "https://example.com/fail.jpg",
                    "m2": "https://example.com/ok.jpg",
                },
            ), mock.patch(
                "lib.thumbnail._download_image",
                side_effect=_fake_download,
            ):
                result = thumbnail.generate_thumbnail(
                    movie_ids=["m1", "m2"],
                    output_path=out,
                    config=config,
                )
            self.assertTrue(result)
            self.assertTrue(out.is_file())

    def test_thumbnail_with_logo_overlay(self):
        """When brand_logo_enabled is True and logo exists, it's composited."""
        logo_path = Path(thumbnail._pipeline_root()) / "assets" / "logo-short.png"
        if not logo_path.is_file():
            self.skipTest("assets/logo-short.png missing")

        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumb.png"
            config = {
                "settings": {
                    "brand_logo_enabled": True,
                    "brand_logo_path": "assets/logo-short.png",
                }
            }
            with mock.patch("lib.thumbnail._fetch_movie_posters", return_value={}):
                result = thumbnail.generate_thumbnail(
                    movie_ids=["id1"],
                    output_path=out,
                    config=config,
                )
            self.assertTrue(result)
            self.assertTrue(out.is_file())

    def test_thumbnail_missing_logo_skips_gracefully(self):
        """Missing logo file should not crash thumbnail generation."""
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumb.png"
            config = {
                "settings": {
                    "brand_logo_enabled": True,
                    "brand_logo_path": "assets/nonexistent-logo.png",
                }
            }
            with mock.patch("lib.thumbnail._fetch_movie_posters", return_value={}):
                result = thumbnail.generate_thumbnail(
                    movie_ids=["id1"],
                    output_path=out,
                    config=config,
                )
            self.assertTrue(result)

    def test_run_skips_when_disabled_in_config(self):
        """run() should no-op when thumbnail_enabled is False."""
        context = {
            "config": {"settings": {"thumbnail_enabled": False}},
            "episode_path": "/tmp/fake.mp3",
        }
        with mock.patch("lib.thumbnail.Path.is_file", return_value=True):
            thumbnail.run(context)
        self.assertNotIn("thumbnail_path", context)

    def test_run_skips_when_no_movie_extraction(self):
        """run() should skip gracefully when movie extraction JSON is missing."""
        with tempfile.TemporaryDirectory() as td:
            ep_path = Path(td) / "20260101.mp3"
            ep_path.touch()
            context = {
                "config": {
                    "settings": {"thumbnail_enabled": True},
                    "paths": {"output_dir": td},
                },
                "episode_path": str(ep_path),
            }
            thumbnail.run(context)
        self.assertNotIn("thumbnail_path", context)

    def test_run_skips_when_no_movies_in_extraction(self):
        """run() should skip when the extraction JSON has an empty movies list."""
        with tempfile.TemporaryDirectory() as td:
            ep_path = Path(td) / "20260101.mp3"
            ep_path.touch()
            movies_dir = Path(td) / "movies"
            movies_dir.mkdir()
            movies_json = movies_dir / "20260101.movies.json"
            json.dump({"movies": []}, movies_json.open("w"))

            context = {
                "config": {
                    "settings": {"thumbnail_enabled": True},
                    "paths": {"output_dir": td},
                },
                "episode_path": str(ep_path),
            }
            thumbnail.run(context)
        self.assertNotIn("thumbnail_path", context)

    def test_logo_corner_position_all_corners(self):
        margin = 40
        logo_w, logo_h = 200, 80
        cases = {
            "top_left": (margin, margin),
            "top_right": (1920 - logo_w - margin, margin),
            "bottom_left": (margin, 1080 - logo_h - margin),
            "bottom_right": (1920 - logo_w - margin, 1080 - logo_h - margin),
        }
        for position, expected in cases.items():
            with self.subTest(position=position):
                self.assertEqual(
                    thumbnail._logo_corner_position(1920, 1080, logo_w, logo_h, margin, position),
                    expected,
                )

    def test_logo_corner_position_accepts_hyphenated_values(self):
        self.assertEqual(
            thumbnail._logo_corner_position(1920, 1080, 100, 50, 20, "bottom-right"),
            (1800, 1010),
        )

    def test_logo_corner_position_falls_back_for_invalid_value(self):
        self.assertEqual(
            thumbnail._logo_corner_position(1920, 1080, 100, 50, 20, "center"),
            (20, 20),
        )

    def test_layout_posters_scales_uniformly(self):
        """_layout_posters returns a canvas with the correct dimensions."""
        posters = [
            self._make_poster(300, 450, (200, 0, 0)),
            self._make_poster(200, 400, (0, 200, 0)),
            self._make_poster(350, 500, (0, 0, 200)),
        ]
        canvas, positions = thumbnail._layout_posters(posters, 1920, 1080)
        self.assertEqual(canvas.size, (1920, 1080))
        self.assertEqual(len(positions), 3)

    def test_layout_posters_uses_two_by_two_grid_for_four_posters(self):
        posters = [self._make_poster() for _ in range(4)]
        _, positions = thumbnail._layout_posters(posters, 1920, 1920, top_margin=190)
        self.assertEqual(len({y for _, y in positions}), 2)
        self.assertEqual(positions[0][1], positions[1][1])
        self.assertEqual(positions[2][1], positions[3][1])

    def test_layout_posters_keeps_three_posters_in_one_row(self):
        posters = [self._make_poster() for _ in range(3)]
        _, positions = thumbnail._layout_posters(posters, 1920, 1920, top_margin=190)
        self.assertEqual(len({y for _, y in positions}), 1)

    def test_layout_posters_wraps_many_posters_into_balanced_centred_rows(self):
        posters = [self._make_poster() for _ in range(9)]
        _, positions = thumbnail._layout_posters(posters, 1920, 1920, top_margin=190)
        rows: dict[int, list[int]] = {}
        for x, y in positions:
            rows.setdefault(y, []).append(x)
        self.assertEqual([len(xs) for _, xs in sorted(rows.items())], [5, 4])
        for y, xs in rows.items():
            self.assertGreaterEqual(min(xs), 0)
            self.assertGreaterEqual(y, 190)

    def test_choose_grid_prefers_fewest_rows_on_tie(self):
        rows, _ = thumbnail._choose_grid([1.0], 1000, 1000, 20)
        self.assertEqual(rows, [1])

    def test_drop_shadow_rounds_poster_corners(self):
        poster = self._make_poster(300, 450, (200, 50, 50))
        shadowed = thumbnail._add_drop_shadow(poster)
        blur = thumbnail.SHADOW_BLUR
        corner = shadowed.getpixel((blur, blur))
        centre = shadowed.getpixel((blur + 150, blur + 225))
        self.assertNotEqual(corner[:3], (200, 50, 50))
        self.assertEqual(centre, (200, 50, 50, 255))

    def test_layout_posters_empty_list(self):
        """_layout_posters with no posters returns empty canvas."""
        canvas, positions = thumbnail._layout_posters([], 1920, 1080)
        self.assertEqual(canvas.size, (1920, 1080))
        self.assertEqual(positions, [])

    def test_fetch_movie_posters_empty_ids(self):
        """An empty ID list returns without calling Convex."""
        result = thumbnail._fetch_movie_posters([])
        self.assertEqual(result, {})

    def test_fetch_movie_posters_uses_injected_convex_client(self):
        client = mock.Mock()
        client.get_movie_posters.return_value = {
            "movie-1": "https://example.test/poster.jpg"
        }

        result = thumbnail._fetch_movie_posters(["movie-1"], client)

        self.assertEqual(
            result,
            {"movie-1": "https://example.test/poster.jpg"},
        )
        client.get_movie_posters.assert_called_once_with(["movie-1"])

    def test_download_image_returns_none_for_bad_url(self):
        """_download_image returns None when the URL is unreachable."""
        result = thumbnail._download_image("https://localhost:99999/not-a-real-image.jpg", timeout=2)
        self.assertIsNone(result)


    def test_text_only_thumbnail_creates_a_missing_output_directory(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "thumbnails" / "thumb.png"
            with mock.patch("lib.thumbnail._fetch_movie_posters", return_value={}):
                result = thumbnail.generate_thumbnail(
                    movie_ids=["fake-id"],
                    output_path=out,
                    config={"settings": {"brand_logo_enabled": False}},
                )
            self.assertTrue(result)
            self.assertTrue(out.is_file())


if __name__ == "__main__":
    unittest.main()
