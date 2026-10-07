import unittest

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


if __name__ == "__main__":
    unittest.main()
