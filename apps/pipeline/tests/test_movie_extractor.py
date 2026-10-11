import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from lib import movie_extractor


class MovieExtractorWithoutTranscriptTests(unittest.TestCase):
    """The movies stage still emits Convex-assigned movies when no transcript exists.

    The Cowork path (transcript present) is covered in test_cowork_handoff.py.
    """

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


if __name__ == "__main__":
    unittest.main()
