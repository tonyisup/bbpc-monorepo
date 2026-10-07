import unittest
from unittest import mock

from lib import laughter_detector


class LaughterDetectorTests(unittest.TestCase):
    def test_detect_onset_times_requests_seconds(self):
        with mock.patch("librosa.onset.onset_detect", return_value=[]) as onset_detect:
            laughter_detector._detect_onset_times(y=[0.0], sr=16_000, hop_length=512)

        self.assertEqual(onset_detect.call_args.kwargs["units"], "time")

    def test_laughter_visual_direction_is_abstract_not_podcasting(self):
        prompt = laughter_detector.LAUGHTER_IMAGE_PROMPT
        self.assertIn("abstract burst", prompt.lower())
        self.assertNotIn("podcast studio", prompt.lower())
        self.assertNotIn("silhouette", prompt.lower())

    def test_center_clip_bounds_centers_anchor_when_room_exists(self):
        start, end = laughter_detector._center_clip_bounds(
            anchor=50.0,
            clip_duration=30.0,
            duration_total=200.0,
        )
        self.assertEqual((start, end), (35.0, 65.0))

    def test_center_clip_bounds_clamps_near_episode_start(self):
        start, end = laughter_detector._center_clip_bounds(
            anchor=8.0,
            clip_duration=30.0,
            duration_total=200.0,
        )
        self.assertEqual((start, end), (0.0, 30.0))

    def test_merge_candidates_preserves_strongest_peak_center(self):
        merged = laughter_detector._merge_candidates(
            [
                {
                    "center": 40.0,
                    "onset_rate": 3.2,
                    "centroid": 500.0,
                    "rms": 0.4,
                    "laugh_ratio": 0.30,
                },
                {
                    "center": 41.0,
                    "onset_rate": 4.8,
                    "centroid": 550.0,
                    "rms": 0.8,
                    "laugh_ratio": 0.45,
                },
                {
                    "center": 41.8,
                    "onset_rate": 3.6,
                    "centroid": 520.0,
                    "rms": 0.5,
                    "laugh_ratio": 0.35,
                },
            ],
            gap_sec=2.0,
        )

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["peak_center"], 41.0)
        self.assertEqual(merged[0]["burst_start"], 40.0)
        self.assertEqual(merged[0]["burst_end"], 41.8)


if __name__ == "__main__":
    unittest.main()
