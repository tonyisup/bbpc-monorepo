"""caption_style: captions that follow the transcript's word timings (pop and highlight)."""
import re
import unittest

from lib import clipper, lab, settings_schema

WORDS = [
    {"start": 10.0, "end": 10.3, "text": "Momma"},
    {"start": 10.4, "end": 10.7, "text": "wants"},
    {"start": 10.8, "end": 11.2, "text": "wombat."},
    {"start": 12.0, "end": 12.3, "text": "Okay."},
]
SEGMENTS = [{"start": 10.0, "end": 12.3, "text": "Momma wants wombat. Okay.", "words": WORDS}]


def dialogues(settings, segments=SEGMENTS, start=10.0, end=20.0):
    text = clipper._build_ass_subtitles(segments, start, end, clipper._caption_look(settings))
    rows = [line.split(",", 9) for line in text.splitlines() if line.startswith("Dialogue:")]
    return [(row[1], row[2], row[9]) for row in rows]


def plain(text):
    """A Dialogue's text without its override tags."""
    return re.sub(r"\{\\[^}]*\}", "", text)


class CaptionStyleTests(unittest.TestCase):
    def test_chunk_is_the_default_and_shows_each_caption_whole(self):
        self.assertEqual(clipper._caption_look({}).style, "chunk")
        self.assertEqual(dialogues({}), [
            ("0:00:00.00", "0:00:01.20", "MOMMA WANTS WOMBAT."),
            ("0:00:02.00", "0:00:02.30", "OKAY."),
        ])
        self.assertEqual(dialogues({"caption_style": "chunk"}), dialogues({}))

    def test_pop_lays_the_caption_out_whole_and_shows_each_word_as_it_is_said(self):
        # Every word is in its place from the start, hidden, so the line never moves as words appear.
        self.assertEqual(dialogues({"caption_style": "pop"}), [
            ("0:00:00.00", "0:00:01.20",
             r"{\alpha&HFF&\t(0,80,\alpha&H00&)}MOMMA "
             r"{\alpha&HFF&\t(400,480,\alpha&H00&)}WANTS "
             r"{\alpha&HFF&\t(800,880,\alpha&H00&)}WOMBAT."),
            ("0:00:02.00", "0:00:02.30", r"{\alpha&HFF&\t(0,80,\alpha&H00&)}OKAY."),
        ])

    def test_highlight_colours_the_word_being_said_until_the_next_one_starts(self):
        # Tags carry over to the words after them, so each word starts again from caption_color.
        self.assertEqual(dialogues({"caption_style": "highlight", "caption_highlight_color": "#00ff88"}), [
            ("0:00:00.00", "0:00:01.20",
             r"{\1c&H00FFFF&\t(0,1,\1c&H88FF00&)\t(400,401,\1c&H00FFFF&)}MOMMA "
             r"{\1c&H00FFFF&\t(400,401,\1c&H88FF00&)\t(800,801,\1c&H00FFFF&)}WANTS "
             r"{\1c&H00FFFF&\t(800,801,\1c&H88FF00&)}WOMBAT."),
            ("0:00:02.00", "0:00:02.30", r"{\1c&H00FFFF&\t(0,1,\1c&H88FF00&)}OKAY."),
        ])

    def test_every_style_has_the_same_captions_at_the_same_times(self):
        segments = SEGMENTS + [
            # No word timings (Whisper): the words are spread over the segment, as for chunk.
            {"start": 13.0, "end": 19.0, "text": "and then he walks into the bar with a {wheel} of cheese"},
        ]
        chunk = dialogues({}, segments)
        for style in ("pop", "highlight"):
            with self.subTest(style):
                styled = dialogues({"caption_style": style}, segments)
                self.assertEqual([(start, end, plain(text)) for start, end, text in styled], chunk)
                self.assertIn(r"\{WHEEL\}", styled[-2][2] + styled[-1][2])

    def test_the_styles_are_settings_a_lab_draft_may_change(self):
        for key in ("caption_style", "caption_highlight_color"):
            with self.subTest(key):
                setting = settings_schema.BY_KEY.get(key)
                self.assertIsNotNone(setting)
                self.assertTrue(setting.draft)
                self.assertEqual(setting.stages, ("clip",))
        self.assertEqual(settings_schema.BY_KEY["caption_style"].choices, ("chunk", "pop", "highlight"))
        self.assertEqual(lab.check_overrides({"caption_style": "pop", "caption_highlight_color": "#00FF88"}), [])
        self.assertTrue(lab.check_overrides({"caption_style": "karaoke"}))
        self.assertTrue(lab.check_overrides({"caption_highlight_color": "green"}))


if __name__ == "__main__":
    unittest.main()
