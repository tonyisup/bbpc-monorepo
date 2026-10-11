import unittest

from lib import parser


class ParserMovieContextTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
