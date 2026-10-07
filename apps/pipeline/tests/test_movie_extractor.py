import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from openai import OpenAIError

from lib import movie_extractor


def _catalog(*rows):
    return movie_extractor._build_catalog(rows)


class MovieExtractorTests(unittest.TestCase):
    def setUp(self):
        self.base_config = {
            "paths": {"movie_extractions_dir": "./output/movies"},
            "settings": {
                "movie_extractor_llm_enabled": False,
                "movie_extractor_candidate_limit": 25,
                "movie_extractor_accept_threshold": 1.15,
                "movie_extractor_maybe_threshold": 0.85,
            },
        }

    def test_extracts_exact_assignment_title_with_evidence(self):
        catalog = _catalog(("movie-1", "Sketch", 2025))
        segments = [
            {"start": 10.0, "end": 18.0, "text": "my homework i assign sketch 2025 when a young girl's sketchbook opens a portal"},
            {"start": 18.0, "end": 27.0, "text": "i give sketch a dollar"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["Sketch"])
        self.assertEqual(payload["movies"][0]["matchedMovieId"], "movie-1")
        self.assertTrue(payload["movies"][0]["evidence"])
        self.assertIn("review_context", payload["movies"][0]["signals"])

    def test_accepts_number_normalized_sequel_title(self):
        catalog = _catalog(("movie-2", "Friday the 13th Part III", 1982))
        segments = [
            {"start": 50.0, "end": 65.0, "text": "my pick is friday the 13th part 3 1982 and i reviewed it last night"},
            {"start": 66.0, "end": 74.0, "text": "i give friday the 13th part 3 a dollar"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["Friday the 13th Part III"])

    def test_rejects_future_release_trailer_chatter(self):
        catalog = _catalog(("movie-3", "Ready or Not: Here I Come", 2026))
        segments = [
            {"start": 100.0, "end": 110.0, "text": "the trailer for ready or not here i come just dropped"},
            {"start": 110.0, "end": 120.0, "text": "it is coming out next summer and box office might be huge"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual(payload["movies"], [])
        statuses = {candidate["title"]: candidate["status"] for candidate in payload["candidates"]}
        self.assertEqual(statuses.get("Ready or Not: Here I Come"), "rejected")

    def test_rejects_future_pick_movie_called_pattern(self):
        catalog = _catalog(("movie-3b", "After Hours", 1985))
        segments = [
            {"start": 0.0, "end": 5.0, "text": "i'm going to pick a 1985 movie called after hours"},
            {"start": 5.0, "end": 8.0, "text": "that's next week's homework"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual(payload["movies"], [])
        statuses = {candidate["title"]: candidate["status"] for candidate in payload["candidates"]}
        self.assertEqual(statuses.get("After Hours"), "rejected")

    def test_rejects_comparison_reference_even_with_exact_title(self):
        catalog = _catalog(("movie-3c", "The Wizard of Oz", 1939))
        segments = [
            {"start": 0.0, "end": 5.0, "text": "it's not like the wizard of oz, right"},
            {"start": 5.0, "end": 8.0, "text": "like everybody has seen that one"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual(payload["movies"], [])
        statuses = {candidate["title"]: candidate["status"] for candidate in payload["candidates"]}
        self.assertEqual(statuses.get("The Wizard of Oz"), "rejected")

    def test_rejects_ambiguous_short_title_without_review_context(self):
        catalog = _catalog(("movie-4", "Go", 1999))
        segments = [
            {"start": 0.0, "end": 5.0, "text": "go look at that over there"},
            {"start": 5.0, "end": 10.0, "text": "go tell him we are ready"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual(payload["movies"], [])

    def test_accepts_ambiguous_short_title_with_review_context_and_repetition(self):
        catalog = _catalog(("movie-5", "Go", 1999))
        segments = [
            {"start": 0.0, "end": 7.0, "text": "my homework is go 1999 and i watched it this morning"},
            {"start": 7.0, "end": 14.0, "text": "i give go a dollar because this movie rules"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["Go"])

    def test_accepts_extra_title_from_section_review_context(self):
        catalog = _catalog(("movie-5b", "That Thing You Do!", 1996))
        segments = [
            {"start": 0.0, "end": 3.0, "text": "okay let me add an extra"},
            {"start": 3.0, "end": 6.0, "text": "that thing you do"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["That Thing You Do!"])

    def test_accepts_sequel_shorthand_ready_or_not_2_here_i_come(self):
        catalog = _catalog(("movie-5c", "Ready or Not: Here I Come", 2026))
        segments = [
            {"start": 0.0, "end": 3.0, "text": "i went to the theater on saturday"},
            {"start": 3.0, "end": 8.0, "text": "and i checked out a little movie called ready or not 2"},
            {"start": 8.0, "end": 10.0, "text": "here i come"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["Ready or Not: Here I Come"])

    def test_accepts_asr_variant_for_sew_torn(self):
        catalog = _catalog(("movie-5d", "Sew Torn", 2024))
        segments = [
            {"start": 0.0, "end": 3.0, "text": "which one are we doing"},
            {"start": 3.0, "end": 6.0, "text": "relay or so torn"},
            {"start": 6.0, "end": 9.0, "text": "let's do so torn second"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["Sew Torn"])

    def test_accepts_friday_part_alias_when_episode_context_mentions_franchise(self):
        catalog = _catalog(("movie-5e", "Friday the 13th Part 2", 1981))
        segments = [
            {"start": 0.0, "end": 4.0, "text": "we do have some extras because we celebrated friday the 13th on friday"},
            {"start": 4.0, "end": 6.0, "text": "i saw a couple of them"},
            {"start": 6.0, "end": 8.0, "text": "part 2"},
            {"start": 8.0, "end": 12.0, "text": "part 2 is awesome high dollar"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, catalog, config=self.base_config)

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["Friday the 13th Part 2"])

    def test_db_targeted_catalog_includes_movies_without_transcript_evidence(self):
        catalog = _catalog(
            ("movie-1", "Sketch", 2025),
            ("movie-2", "Mystery Road", 2023),
            ("movie-3", "Hidden Gem", 2020),
        )
        segments = [
            {"start": 10.0, "end": 18.0, "text": "my homework i assign sketch 2025 when a young girl's sketchbook opens a portal"},
            {"start": 18.0, "end": 27.0, "text": "i give sketch a dollar"},
        ]

        payload = movie_extractor.extract_movies_from_segments(
            segments,
            catalog,
            config=self.base_config,
            ensure_catalog_movies=True,
        )

        titles = {movie["title"] for movie in payload["movies"]}
        self.assertEqual(titles, {"Sketch", "Mystery Road", "Hidden Gem"})
        by_title = {movie["title"]: movie for movie in payload["movies"]}
        self.assertEqual(by_title["Sketch"]["status"], "accepted")
        self.assertEqual(by_title["Mystery Road"]["status"], "db_assigned")
        self.assertIn("db_episode_movie", by_title["Mystery Road"]["signals"])

    def test_collects_unmatched_raw_title_from_review_window(self):
        segments = [
            {"start": 0.0, "end": 8.0, "text": "my homework i assign mystery road and it whips"},
        ]

        payload = movie_extractor.extract_movies_from_segments(segments, [], config=self.base_config)

        self.assertEqual(payload["movies"], [])
        self.assertEqual(payload["unmatchedTitles"][0]["title"], "Mystery Road")

    def test_run_writes_output_artifact_and_sets_context(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            transcript_path = Path(temp_dir) / "20260101.json"
            transcript_path.write_text(json.dumps([{"start": 0.0, "end": 1.0, "text": "hello"}]), encoding="utf-8")
            output_dir = Path(temp_dir) / "movie-output"
            context = {
                "config": {
                    "paths": {"movie_extractions_dir": str(output_dir)},
                    "settings": {"movie_extractor_llm_enabled": False},
                },
                "convex_client": mock.Mock(
                    get_episode_context_by_date=mock.Mock(
                        return_value=None
                    )
                ),
                "episode_path": str(Path(temp_dir) / "20260101.mp3"),
                "transcript_path": str(transcript_path),
            }
            payload = {
                "episode": {
                    "stem": "20260101",
                    "date": "2026-01-01",
                    "dbEpisodeId": None,
                    "dbEpisodeNumber": None,
                    "dbEpisodeTitle": None,
                },
                "extractor": {"version": "hybrid_v1", "llmEnabled": False, "llmUsed": False},
                "movies": [],
                "unmatchedTitles": [],
                "candidates": [],
            }

            with mock.patch.object(movie_extractor, "extract_movies_from_transcript", return_value=payload):
                movie_extractor.run(context)

            output_path = (output_dir / "20260101.movies.json").resolve()
            self.assertTrue(output_path.is_file())
            self.assertEqual(Path(context["movie_extraction_path"]).resolve(), output_path.resolve())
            self.assertEqual(context["extracted_movies"], [])
            context[
                "convex_client"
            ].get_episode_context_by_date.assert_called_once_with(
                "2026-01-01"
            )
            written = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(written["extractor"]["version"], "hybrid_v1")

    def _pipeline_movie(self, movie_id, title, year, source="assignment"):
        return mock.Mock(
            movie_id=movie_id,
            title=title,
            year=year,
            source=source,
            assignment_type="HOMEWORK" if source == "assignment" else None,
        )

    def test_run_without_transcript_uses_convex_episode_movies(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "movie-output"
            episode = mock.Mock(
                id="episode-1",
                number=42,
                title="Episode 42",
                date="2026-01-01",
                slug="episode-42",
                status="published",
                description=None,
                notes=None,
                seo_title=None,
                seo_description=None,
                seo_keywords=None,
            )
            convex = mock.Mock(
                get_episode_context_by_date=mock.Mock(
                    return_value=(
                        episode,
                        [
                            self._pipeline_movie("movie-1", "Sketch", 2025),
                            self._pipeline_movie("movie-2", "Mystery Road", 2023, "extra_review"),
                        ],
                    )
                )
            )
            context = {
                "config": {
                    "paths": {"movie_extractions_dir": str(output_dir)},
                    "settings": {"movie_extractor_llm_enabled": False},
                },
                "convex_client": convex,
                "episode_path": str(Path(temp_dir) / "20260101.mp3"),
                "transcript_path": str(Path(temp_dir) / "20260101.json"),
            }

            with mock.patch.object(movie_extractor, "_load_movie_catalog") as load_catalog:
                movie_extractor.run(context)
                load_catalog.assert_not_called()

            written = json.loads((output_dir / "20260101.movies.json").read_text(encoding="utf-8"))
            self.assertEqual(written["extractor"]["mode"], "db_only")
            self.assertEqual(written["extractor"]["dbEpisodeId"], "episode-1")
            self.assertEqual(written["extractor"]["dbSources"], {"assignment": 1, "extra_review": 1})
            self.assertEqual(written["episode"]["dbEpisodeNumber"], 42)
            self.assertEqual(
                [(movie["matchedMovieId"], movie["status"]) for movie in written["movies"]],
                [("movie-1", "db_assigned"), ("movie-2", "db_assigned")],
            )
            self.assertEqual([movie["title"] for movie in context["extracted_movies"]], ["Sketch", "Mystery Road"])

    def test_run_without_transcript_or_convex_movies_raises(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            context = {
                "config": {
                    "paths": {"movie_extractions_dir": str(Path(temp_dir) / "movie-output")},
                    "settings": {"movie_extractor_llm_enabled": False},
                },
                "convex_client": mock.Mock(get_episode_context_by_date=mock.Mock(return_value=None)),
                "transcript_path": str(Path(temp_dir) / "20260101.json"),
            }

            with self.assertRaises(FileNotFoundError):
                movie_extractor.run(context)

    def test_run_without_transcript_ignores_catalog_fallback_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            context = {
                "config": {
                    "paths": {"movie_extractions_dir": str(Path(temp_dir) / "movie-output")},
                    "settings": {"movie_extractor_llm_enabled": False},
                },
                "db_episode": {"id": "episode-1", "number": 42, "title": "Episode 42", "date": "2026-01-01"},
                "db_episode_movies": [self._pipeline_movie("movie-1", "Sketch", 2025, "catalog_fallback")],
                "transcript_path": str(Path(temp_dir) / "20260101.json"),
            }

            with self.assertRaises(FileNotFoundError):
                movie_extractor.run(context)


    _SKETCH_SEGMENTS = [
        {"start": 10.0, "end": 18.0, "text": "my homework i assign sketch 2025 when a young girl's sketchbook opens a portal"},
        {"start": 18.0, "end": 27.0, "text": "i give sketch a dollar"},
    ]

    def test_rerank_failure_keeps_heuristic_results(self):
        catalog = _catalog(("movie-1", "Sketch", 2025))

        with mock.patch.object(movie_extractor, "_rerank_with_llm", side_effect=OpenAIError("provider down")):
            payload = movie_extractor.extract_movies_from_segments(
                self._SKETCH_SEGMENTS, catalog, config=self.base_config
            )

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["Sketch"])
        self.assertFalse(payload["extractor"]["llmUsed"])

    def test_catalog_fallback_rows_are_matched_but_not_listed_as_assigned(self):
        fallback = [
            self._pipeline_movie("movie-1", "Sketch", 2025, "catalog_fallback"),
            self._pipeline_movie("movie-2", "Mystery Road", 2023, "catalog_fallback"),
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            transcript_path = Path(temp_dir) / "20260101.json"
            transcript_path.write_text(json.dumps(self._SKETCH_SEGMENTS), encoding="utf-8")

            payload = movie_extractor._extract_with_transcript(
                {},
                transcript_path,
                self.base_config,
                movie_extractor._settings(self.base_config),
                "20260101",
                movie_extractor._build_catalog_from_episode_movies(fallback),
                None,
                fallback,
            )

        self.assertEqual([movie["title"] for movie in payload["movies"]], ["Sketch"])
        self.assertEqual(payload["extractor"]["dbSources"], {"catalog_fallback": 2})

    def test_extraction_failures_are_not_turned_into_an_empty_artifact(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            transcript_path = Path(temp_dir) / "20260101.json"
            transcript_path.write_text(json.dumps(self._SKETCH_SEGMENTS), encoding="utf-8")

            with mock.patch.object(
                movie_extractor, "extract_movies_from_transcript", side_effect=RuntimeError("Convex unavailable")
            ):
                with self.assertRaisesRegex(RuntimeError, "Convex unavailable"):
                    movie_extractor._extract_with_transcript(
                        {}, transcript_path, self.base_config, {}, "20260101", None, None, []
                    )


if __name__ == "__main__":
    unittest.main()
