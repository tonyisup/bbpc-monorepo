"""caption_style: captions that follow the transcript's word timings (pop, highlight and kinetic)."""
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

    def test_kinetic_gives_each_word_its_own_event_from_when_it_is_said_to_the_caption_end(self):
        rows = dialogues({"caption_style": "kinetic", "caption_highlight_color": "#00ff88"})
        self.assertEqual([(start, end, plain(text)) for start, end, text in rows], [
            ("0:00:00.00", "0:00:01.20", "MOMMA"),
            ("0:00:00.40", "0:00:01.20", "WANTS"),
            ("0:00:00.80", "0:00:01.20", "WOMBAT."),
            ("0:00:02.00", "0:00:02.30", "OKAY."),
        ])
        momma, wants, wombat, okay = (text for _, _, text in rows)
        # Lit from its start, back to caption_color when the next word starts (ms from its own start).
        self.assertIn(r"\1c&H88FF00&", momma)
        self.assertIn(r"\t(400,401,\1c&H00FFFF&)", momma)
        self.assertIn(r"\t(400,401,\1c&H00FFFF&)", wants)
        self.assertNotIn(r"\1c&H00FFFF&", wombat)
        # Enters hidden, small and blurred, then fades in, overshoots and settles.
        for text in (momma, okay):
            self.assertIn(r"\alpha&HFF&\blur4\fscx60\fscy60", text)
            self.assertIn(r"\t(0,90,0.5,\fscx112\fscy112\blur0)\t(90,180,\fscx100\fscy100)", text)

    def test_kinetic_lays_words_out_on_centred_lines_above_the_bottom_margin(self):
        def centres(rows):
            return [tuple(map(int, re.search(r"\\move\(\d+,\d+,(\d+),(\d+)", text).groups())) for _, _, text in rows]

        look = clipper._caption_look({"caption_style": "kinetic"})
        bottom_row = clipper.VIDEO_HEIGHT - look.margin_bottom_px - look.font_size // 2
        top_row = bottom_row - look.font_size
        momma, wants, wombat, okay = centres(dialogues({"caption_style": "kinetic"}))
        # "MOMMA WANTS WOMBAT." is wider than a line, so it breaks as libass would break it.
        self.assertEqual((momma[1], wants[1], wombat[1]), (top_row, top_row, bottom_row))
        self.assertLess(momma[0], clipper.VIDEO_WIDTH // 2)
        self.assertGreater(wants[0], clipper.VIDEO_WIDTH // 2)
        self.assertAlmostEqual((momma[0] + wants[0]) / 2, clipper.VIDEO_WIDTH / 2, delta=40)
        self.assertEqual(wombat, (clipper.VIDEO_WIDTH // 2, bottom_row))
        self.assertEqual(okay, (clipper.VIDEO_WIDTH // 2, bottom_row))
        for x, _ in (momma, wants, wombat):
            self.assertTrue(look.margin_side_px <= x <= clipper.VIDEO_WIDTH - look.margin_side_px)

    def test_kinetic_falls_back_to_pop_without_the_caption_font(self):
        settings = {"caption_font_path": "/nonexistent/font.ttf"}
        self.assertEqual(dialogues({**settings, "caption_style": "kinetic"}),
                         dialogues({**settings, "caption_style": "pop"}))

    def test_kinetic_shows_the_same_captions_as_chunk_at_the_same_times(self):
        # Value: protects=kinetic shows every word of each chunk caption, escaped, from its start to its end, also for estimated timings; fails_when=kinetic drops/unescapes words or event times stray from the caption's; why_new=pop/highlight check only covers those two styles; seam=none; no_claim=does not check libass draws them
        segments = SEGMENTS + [
            {"start": 13.0, "end": 19.0, "text": "and then he walks into the bar with a {wheel} of cheese"},
        ]
        chunk = dialogues({}, segments)
        rows = dialogues({"caption_style": "kinetic"}, segments)
        captions = []
        for start, end, text in rows:
            if captions and captions[-1][1] == end:
                captions[-1][2].append(plain(text))
            else:
                captions.append((start, end, [plain(text)]))
        self.assertEqual([(start, end, " ".join(words)) for start, end, words in captions], chunk)
        self.assertIn(r"\{WHEEL\}", [plain(text) for _, _, text in rows])

    def test_kinetic_words_rise_into_their_place_centred_on_it(self):
        # Value: protects=each word is anchored on its centre (an5) and rises straight up into the place the layout gives it; fails_when=an5 is dropped so move points anchor bottom-centre, or the word slides sideways/drops from above; why_new=layout test reads only the move end point; seam=none; no_claim=does not render frames
        for _, _, text in dialogues({"caption_style": "kinetic"}):
            with self.subTest(plain(text)):
                match = re.match(r"\{\\an5\\move\((\d+),(\d+),(\d+),(\d+),0,(\d+)\)", text)
                self.assertIsNotNone(match, text)
                from_x, from_y, to_x, to_y, ms = map(int, match.groups())
                self.assertEqual(from_x, to_x)
                self.assertGreater(from_y, to_y)
                self.assertGreater(ms, 0)

    def test_a_kinetic_word_said_at_the_very_end_of_its_caption_is_still_an_event(self):
        # Value: protects=a word whose start rounds to or past its caption's end still gets an event that ends after it starts; fails_when=word_end is just the caption end, giving a zero or negative event libass drops; why_new=sample words all end well after they start; seam=none; no_claim=a 10 ms event may fall between frames
        words = [
            {"start": 10.0, "end": 10.3, "text": "so"},
            {"start": 10.4, "end": 10.4, "text": "yes."},      # zero length, last in its caption
            {"start": 10.996, "end": 10.998, "text": "no."},   # starts on 0:00:01.00, caption ends at 0.998
        ]
        segments = [{"start": 10.0, "end": 11.0, "text": "so yes. no.", "words": words}]
        rows = dialogues({"caption_style": "kinetic"}, segments)
        self.assertEqual([(start, plain(text)) for start, _, text in rows],
                         [("0:00:00.00", "SO"), ("0:00:00.40", "YES."), ("0:00:01.00", "NO.")])
        for start, end, text in rows:
            with self.subTest(plain(text)):
                self.assertGreater(end, start)

    def test_the_styles_are_settings_a_lab_draft_may_change(self):
        for key in ("caption_style", "caption_highlight_color"):
            with self.subTest(key):
                setting = settings_schema.BY_KEY.get(key)
                self.assertIsNotNone(setting)
                self.assertTrue(setting.draft)
                self.assertEqual(setting.stages, ("clip",))
        self.assertEqual(settings_schema.BY_KEY["caption_style"].choices, ("chunk", "pop", "highlight", "kinetic"))
        self.assertEqual(lab.check_overrides({"caption_style": "pop", "caption_highlight_color": "#00FF88"}), [])
        self.assertEqual(lab.check_overrides({"caption_style": "kinetic"}), [])
        self.assertTrue(lab.check_overrides({"caption_style": "karaoke"}))
        self.assertTrue(lab.check_overrides({"caption_highlight_color": "green"}))


if __name__ == "__main__":
    unittest.main()
