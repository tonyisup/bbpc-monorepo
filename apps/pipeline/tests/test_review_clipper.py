import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from lib import review_clipper


class ReviewClipperTests(unittest.TestCase):
    def test_merge_windows_merges_adjacent_ranges_with_gap(self):
        windows = [
            {"start": 10.0, "end": 20.0},
            {"start": 23.0, "end": 28.0},
            {"start": 40.0, "end": 45.0},
        ]
        merged = review_clipper._merge_windows(windows, gap_seconds=3.0)
        self.assertEqual(
            merged,
            [
                {"start": 10.0, "end": 28.0},
                {"start": 40.0, "end": 45.0},
            ],
        )

    def test_trim_windows_applies_rolls_and_length_bounds(self):
        windows = [{"start": 15.0, "end": 25.0}, {"start": 0.5, "end": 2.0}]
        trimmed = review_clipper._trim_windows(
            windows,
            pre_roll=3.0,
            post_roll=3.0,
            min_seconds=5.1,
            max_seconds=12.0,
        )
        self.assertEqual(trimmed, [{"start": 12.0, "end": 24.0}])


    def test_run_lists_existing_clips_in_the_manifest_without_cutting_them_again(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            audio = root / "20260101.mp3"
            audio.write_bytes(b"audio")
            movies = root / "20260101.movies.json"
            movies.write_text(
                json.dumps({"movies": [{"title": "Sketch", "evidence": [{"start": 10.0, "end": 40.0}]}]}),
                encoding="utf-8",
            )
            existing = root / "output" / "review-clips" / "20260101" / "sketch-01.m4a"
            existing.parent.mkdir(parents=True)
            existing.write_bytes(b"clip")
            context = {
                "config": {"paths": {"output_dir": str(root / "output")}},
                "episode_path": str(audio),
                "movie_extraction_path": str(movies),
            }

            with mock.patch.object(review_clipper, "_render_clip") as render:
                review_clipper.run(context)

            render.assert_not_called()
            manifest = json.loads(Path(context["review_clip_manifest_path"]).read_text(encoding="utf-8"))
            self.assertEqual([clip["path"] for clip in manifest["clips"]], [str(existing)])


if __name__ == "__main__":
    unittest.main()
