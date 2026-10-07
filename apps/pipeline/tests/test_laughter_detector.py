import unittest
from unittest import mock

import numpy as np

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


    def test_detection_pass_counts_onsets_from_window_start_up_to_its_last_frame(self):
        sr, hop, frames, window = 16_000, 512, 200, 62
        onset_frames = np.arange(frames) * hop / sr
        loud = np.arange(frames) < window
        features = {
            "onset_frames": onset_frames,
            # Eight onsets inside the first window (its first frame included), plus
            # one on the window's last frame, which belongs to the next window.
            "onset_times": np.array([0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, onset_frames[window - 1]]),
            "centroid": np.where(loud, 900.0, 100.0),
            "rms": np.where(loud, 1.0, 0.1),
            "spectrum": np.array([[0.0] * frames, [1.0] * frames, [0.0] * frames]),
            "freqs": np.array([100.0, 500.0, 2000.0]),
        }

        merged, _ = laughter_detector._run_detection_pass(
            features=features,
            sr=sr,
            hop_length=hop,
            params=laughter_detector.LaughterDetectionParams(),
            max_detections=5,
        )

        self.assertEqual(len(merged), 1)
        self.assertAlmostEqual(merged[0]["onset_rate"], 8 / (window * hop / sr))


if __name__ == "__main__":
    unittest.main()
