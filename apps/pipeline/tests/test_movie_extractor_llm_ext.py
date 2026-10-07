import os
import unittest
from unittest import mock

from lib import movie_extractor, movie_extractor_llm_ext


class _FakeMessage:
    def __init__(self, content: str):
        self.content = content


class _FakeChoice:
    def __init__(self, content: str):
        self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content: str):
        self.choices = [_FakeChoice(content)]


class _FakeCompletions:
    def __init__(self, content: str):
        self._content = content

    def create(self, **kwargs):
        return _FakeResponse(self._content)


class _FakeChat:
    def __init__(self, content: str):
        self.completions = _FakeCompletions(content)


class _FakeClient:
    def __init__(self, content: str):
        self.chat = _FakeChat(content)


def _catalog(*rows):
    return movie_extractor._build_catalog(rows)


class MovieExtractorLlmExtTests(unittest.TestCase):
    def setUp(self):
        # The LLM path is gated on a configured key; never depend on a developer's .env.
        patcher = mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-openrouter-key"})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.settings = {
            "movie_extractor_llm_enabled": True,
            "movie_extractor_model": "qwen/qwen3.5-flash-02-23",
            "movie_extractor_max_movies": 4,
        }

    def test_build_full_transcript_prompt_contains_indexed_transcript(self):
        windows = movie_extractor.build_evidence_windows(
            [
                {"start": 1.0, "end": 2.0, "text": "I checked out Sketch."},
                {"start": 2.0, "end": 3.0, "text": "High dollar."},
            ]
        )
        catalog = _catalog(("movie-1", "Sketch", 2025))

        prompt = movie_extractor_llm_ext._build_llm_full_transcript_prompt(
            "20260405", None, windows[:2], catalog, chunk_index=0, chunk_count=1
        )

        self.assertIn("Episode: 20260405", prompt)
        self.assertIn("[0] 1.00-2.00 I checked out Sketch.", prompt)
        self.assertIn('"movies"', prompt)

    def test_extract_movies_with_llm_full_transcript_matches_catalog_and_unmatched(self):
        windows = movie_extractor.build_evidence_windows(
            [
                {"start": 0.0, "end": 2.0, "text": "I checked out a little movie called Ready or Not 2."},
                {"start": 2.0, "end": 3.0, "text": "Here I Come."},
                {"start": 3.0, "end": 5.0, "text": "I also reviewed Mystery Road."},
            ]
        )
        catalog = _catalog(("movie-1", "Ready or Not: Here I Come", 2026))
        response_json = """
        {
          "movies": [
            {"title": "Ready or Not 2 Here I Come", "confidence": 0.93, "evidenceWindowIndices": [0, 1]}
          ],
          "unmatchedTitles": [
            {"title": "Mystery Road", "confidence": 0.7, "evidenceWindowIndices": [5]}
          ]
        }
        """

        movies, unmatched, llm_used = movie_extractor_llm_ext.extract_movies_and_unmatched_with_llm_full_transcript(
            "20260322",
            None,
            windows,
            catalog,
            self.settings,
            client=_FakeClient(response_json),
        )

        self.assertTrue(llm_used)
        self.assertEqual([movie["title"] for movie in movies], ["Ready or Not: Here I Come"])
        self.assertEqual(movies[0]["matchedMovieId"], "movie-1")
        self.assertEqual(unmatched[0]["title"], "Mystery Road")

    def test_llm_only_mode_uses_extension_module(self):
        catalog = _catalog(("movie-1", "Sketch", 2025))
        segments = [{"start": 0.0, "end": 1.0, "text": "Sketch."}]
        config = {"settings": {"movie_extractor_llm_enabled": True, "movie_extractor_mode": "llm_only"}}
        payload = {
            "episode": {"stem": "20260101", "date": "2026-01-01", "dbEpisodeId": None, "dbEpisodeNumber": None, "dbEpisodeTitle": None},
            "extractor": {"version": "hybrid_v3_llm_full_transcript", "llmEnabled": True, "llmUsed": True, "mode": "llm_only"},
            "movies": [{"matchedMovieId": "movie-1", "title": "Sketch", "year": 2025, "confidence": 0.9, "status": "accepted", "signals": ["llm_full_transcript"], "evidence": []}],
            "unmatchedTitles": [],
            "candidates": [],
        }

        with mock.patch("lib.movie_extractor_llm_ext.llm_only_result", return_value=payload) as llm_only_result:
            result = movie_extractor.extract_movies_from_segments(segments, catalog, config=config)

        llm_only_result.assert_called_once()
        self.assertEqual([movie["title"] for movie in result["movies"]], ["Sketch"])

    def test_hybrid_full_transcript_mode_augments_heuristic_movies(self):
        catalog = _catalog(
            ("movie-1", "Sketch", 2025),
            ("movie-2", "Mystery Road", 2013),
        )
        segments = [{"start": 0.0, "end": 1.0, "text": "Sketch."}]
        config = {
            "settings": {
                "movie_extractor_llm_enabled": True,
                "movie_extractor_mode": "hybrid_full_transcript",
                "movie_extractor_accept_threshold": 1.0,
                "movie_extractor_maybe_threshold": 0.8,
            }
        }
        llm_movies = [
            {
                "matchedMovieId": "movie-2",
                "title": "Mystery Road",
                "year": 2013,
                "confidence": 0.88,
                "status": "accepted",
                "signals": ["llm_full_transcript"],
                "evidence": [{"windowIndex": 0, "start": 0.0, "end": 1.0, "text": "Sketch.", "windowType": "single"}],
            }
        ]
        llm_unmatched = [{"title": "Raw Title", "confidence": 0.7, "evidence": []}]

        with mock.patch("lib.movie_extractor._rerank_with_llm", return_value=(set(), [], False)):
            with mock.patch(
                "lib.movie_extractor_llm_ext.extract_movies_and_unmatched_with_llm_full_transcript",
                return_value=(llm_movies, llm_unmatched, True),
            ):
                result = movie_extractor.extract_movies_from_segments(segments, catalog, config=config)

        self.assertEqual(result["extractor"]["mode"], "hybrid_full_transcript")
        self.assertTrue(result["extractor"]["llmUsed"])
        self.assertEqual([movie["title"] for movie in result["movies"]], ["Mystery Road"])
        self.assertEqual(result["unmatchedTitles"][0]["title"], "Raw Title")

    def test_hybrid_full_transcript_mode_merges_existing_title_without_duplicate(self):
        heuristic_movies = [
            {
                "matchedMovieId": "movie-1",
                "title": "Sketch",
                "year": 2025,
                "confidence": 0.5,
                "status": "accepted",
                "signals": ["review_context"],
                "evidence": [{"windowIndex": 0, "start": 0.0, "end": 1.0, "text": "Sketch", "windowType": "single"}],
            }
        ]
        llm_movies = [
            {
                "matchedMovieId": "movie-1",
                "title": "Sketch",
                "year": 2025,
                "confidence": 0.92,
                "status": "accepted",
                "signals": ["llm_full_transcript"],
                "evidence": [{"windowIndex": 3, "start": 3.0, "end": 4.0, "text": "I checked out Sketch", "windowType": "single"}],
            }
        ]

        merged = movie_extractor._merge_movie_rows(heuristic_movies, llm_movies, max_movies=4)

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["confidence"], 0.92)
        self.assertIn("llm_full_transcript", merged[0]["signals"])
        self.assertEqual(len(merged[0]["evidence"]), 2)


    def test_best_catalog_match_uses_whole_words_and_the_closest_title(self):
        lookup = {
            "aliens": {"movie_id": "aliens"},
            "friday the 13th": {"movie_id": "friday-1"},
            "friday the 13th part 2": {"movie_id": "friday-2"},
            "ready or not here i come": {"movie_id": "ready-2"},
        }
        match = movie_extractor_llm_ext._best_catalog_match

        self.assertIsNone(match("alien", lookup))
        self.assertIsNone(match("friday", lookup))
        self.assertEqual(match("friday the 13th part 2 the body count continues", lookup)["movie_id"], "friday-2")
        self.assertEqual(match("the friday the 13th", lookup)["movie_id"], "friday-1")
        self.assertIsNone(match("ready or not 2 here i come", lookup))
        self.assertEqual(match("ready or not 2 here i come", lookup, ignore_numbers=True)["movie_id"], "ready-2")


if __name__ == "__main__":
    unittest.main()
