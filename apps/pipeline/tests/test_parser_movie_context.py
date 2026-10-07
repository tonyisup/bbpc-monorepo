import json
import tempfile
import unittest
from pathlib import Path

from lib import parser


class ParserMovieContextTests(unittest.TestCase):
    def test_prepare_prompt_includes_likely_reviewed_movies_line(self):
        prompt = parser._prepare_prompt(
            [{"start": 0.0, "end": 1.0, "text": "hello world"}],
            "20260101",
            likely_reviewed_movies=["Sketch (2025)", "Frailty (2002)"],
        )

        self.assertIn("Reviewed movies (from Convex + transcript): Sketch (2025), Frailty (2002)", prompt)

    def test_prepare_prompt_requires_content_specific_non_podcast_imagery(self):
        prompt = parser._prepare_prompt(
            [{"start": 0.0, "end": 1.0, "text": "hello world"}],
            "20260101",
        )

        self.assertIn("abstract cinematic visual metaphor", prompt)
        self.assertIn("Never default to people podcasting", prompt)

    def test_refresh_clip_visual_prompt_uses_overlapping_transcript(self):
        parsed = {
            "candidateClips": [
                {
                    "start": 10.0,
                    "end": 20.0,
                    "headline": "Laughter moment around 0m",
                    "imagePrompt": "Hosts laughing at microphones in a podcast studio",
                }
            ],
            "clipAnalysis": [],
        }
        segments = [
            {"start": 9.0, "end": 14.0, "text": "A haunted arcade cabinet eats every quarter."},
            {"start": 14.0, "end": 21.0, "text": "Its screen glows even after unplugging it."},
        ]

        refreshed = parser._refresh_clip_visual_prompts(parsed, segments)
        image_prompt = refreshed["candidateClips"][0]["imagePrompt"]

        self.assertIn("haunted arcade cabinet", image_prompt)
        self.assertNotIn("Hosts laughing", image_prompt)

    def test_refresh_clip_visual_prompts_preserves_invalid_timestamp_clip(self):
        parsed = {
            "candidateClips": [],
            "clipAnalysis": [
                {
                    "start": None,
                    "end": "not-a-number",
                    "imagePrompt": "A haunted arcade cabinet glows after unplugging.",
                }
            ],
        }

        refreshed = parser._refresh_clip_visual_prompts(parsed, [])

        self.assertEqual(refreshed["clipAnalysis"], parsed["clipAnalysis"])

    def test_filter_invalid_clip_windows_removes_malformed_candidates_before_post_processing(self):
        valid = {"start": 10.0, "end": 30.0, "headline": "Valid"}
        invalid = {"start": "bad", "end": "also-bad", "headline": "Invalid"}
        parsed = {"candidateClips": [valid, invalid], "clipAnalysis": [invalid, valid]}

        filtered = parser._filter_invalid_clip_windows(parsed)

        self.assertEqual(filtered["candidateClips"], [valid])
        self.assertEqual(filtered["clipAnalysis"], [valid])

    def test_load_likely_reviewed_movies_reads_movie_artifact(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            transcript_file = Path(temp_dir) / "20260101.json"
            transcript_file.write_text("[]", encoding="utf-8")
            movie_dir = Path(temp_dir) / "movies"
            movie_dir.mkdir(parents=True, exist_ok=True)
            artifact_path = movie_dir / "20260101.movies.json"
            artifact_path.write_text(
                json.dumps(
                    {
                        "movies": [
                            {"title": "Sketch", "year": 2025},
                            {"title": "Frailty", "year": 2002},
                        ]
                    }
                ),
                encoding="utf-8",
            )

            labels = parser._load_likely_reviewed_movies(
                {"config": {"paths": {"movie_extractions_dir": str(movie_dir)}}},
                transcript_file,
            )

        self.assertEqual(labels, ["Sketch (2025)", "Frailty (2002)"])


if __name__ == "__main__":
    unittest.main()
