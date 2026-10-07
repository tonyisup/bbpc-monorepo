import unittest

from lib import parser


class ParserClipAlignmentTests(unittest.TestCase):
    def test_align_generated_clips_retimes_misaligned_headline_to_transcript(self):
        segments = [
            {"start": 680.0, "end": 684.0, "text": "A different conversation entirely."},
            {"start": 3452.66, "end": 3455.66, "text": "So when I watched this, I'm like, yo, man, this is like the buff dude from Train to"},
            {"start": 3455.66, "end": 3455.88, "text": "Busan."},
            {"start": 3466.92, "end": 3468.12, "text": "Look at them pythons, brother."},
        ]
        parsed = {
            "candidateClips": [
                {
                    "start": 700.0,
                    "end": 760.0,
                    "headline": "This is like the buff dude from Train to Busan! Look at them pythons!",
                    "imagePrompt": "x",
                    "why": "x",
                }
            ],
            "clipAnalysis": [
                {
                    "start": 700.0,
                    "end": 760.0,
                    "headline": "This is like the buff dude from Train to Busan! Look at them pythons!",
                    "imagePrompt": "x",
                    "why": "x",
                }
            ],
        }

        aligned = parser._align_generated_clips_to_transcript(parsed, segments)

        candidate = aligned["candidateClips"][0]
        selected = aligned["clipAnalysis"][0]
        self.assertEqual(candidate["start"], 3452.66)
        self.assertEqual(candidate["end"], 3512.66)
        self.assertEqual(candidate["_autoAlignedFrom"], 700.0)
        self.assertEqual(selected["start"], 3452.66)


if __name__ == "__main__":
    unittest.main()
