import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from lib import clipper


class ClipperLocalVisualsTests(unittest.TestCase):
    def test_build_visual_prompt_adds_house_style_suffix(self):
        prompt = clipper._build_visual_prompt(
            {
                "headline": "A wild box office rant",
                "summary": "The hosts argue about a chaotic opening weekend.",
                "imagePrompt": "A shattered film reel suspended over a neon abyss",
            },
            style_suffix="Vertical 9:16 cinematic poster art, bold lighting, no readable text.",
        )

        self.assertIn("A shattered film reel", prompt)
        self.assertIn("Vertical 9:16 cinematic poster art", prompt)
        self.assertIn("no readable text", prompt)
        # Headline/summary must not steer the image model toward baked-in titles.
        self.assertNotIn("wild box office", prompt)
        self.assertNotIn("chaotic opening", prompt)

    def test_build_visual_prompt_replaces_generic_podcast_scene_with_spoken_content(self):
        prompt = clipper._build_visual_prompt(
            {
                "headline": "Generic laughter moment",
                "imagePrompt": "Two hosts laughing at microphones in a podcast studio",
            },
            style_suffix="Vertical 9:16",
            spoken_context="The old shopping mall hallways felt like the origin of the Back Rooms.",
        )

        self.assertIn("shopping mall hallways", prompt)
        self.assertIn("abstract cinematic visual metaphor", prompt.lower())
        self.assertNotIn("Two hosts laughing", prompt)
        self.assertIn("Never depict people podcasting", prompt)

    def test_build_visual_prompt_fallback_when_image_prompt_missing(self):
        prompt = clipper._build_visual_prompt(
            {"headline": "Episode title here", "why": "reason"},
            style_suffix="no text in image",
        )
        self.assertIn("no text in image", prompt)
        self.assertNotIn("Episode title", prompt)

    def test_apply_brand_logo_writes_stacked_still_next_to_vertical(self):
        logo = clipper._pipeline_root() / "assets" / "logo-short.png"
        if not logo.is_file():
            self.skipTest("assets/logo-short.png missing")
        with tempfile.TemporaryDirectory() as td:
            vertical = Path(td) / "test_vertical.png"
            Image.new("RGB", (clipper.VIDEO_WIDTH, clipper.VIDEO_HEIGHT), (20, 40, 60)).save(
                vertical
            )
            cfg = {"settings": {"brand_logo_path": "assets/logo-short.png"}}
            out = clipper._apply_brand_logo(vertical, cfg)
            self.assertEqual(out.name, "test_vertical_logo.png")
            self.assertTrue(out.is_file())
            with Image.open(out) as branded:
                self.assertEqual(branded.size, (clipper.VIDEO_WIDTH, clipper.VIDEO_HEIGHT))

    def test_select_clip_segments_trims_to_requested_window(self):
        segments = [
            {"start": 0.0, "end": 4.0, "text": "cold open"},
            {"start": 4.0, "end": 8.0, "text": "rant begins"},
            {"start": 8.0, "end": 12.0, "text": "rant peaks"},
        ]

        selected = clipper._select_clip_segments(segments, start=3.0, end=10.0)

        self.assertEqual(
            selected,
            [
                {"start": 3.0, "end": 4.0, "text": "cold open"},
                {"start": 4.0, "end": 8.0, "text": "rant begins"},
                {"start": 8.0, "end": 10.0, "text": "rant peaks"},
            ],
        )

    def test_build_zoompan_filter_linear_zoom_matches_clip_length(self):
        """Zoom is driven by output frame index so it spans the full clip (not ~5s cap)."""
        fg = clipper._build_zoompan_filter(18.0, Path("/tmp/x.ass"))
        # 18s * 30fps = 540 frames → denom 539 in z = 1+0.12*on/539
        self.assertIn("1+0.12*on/539", fg)
        self.assertIn(
            f"scale={clipper.VIDEO_WIDTH * clipper.ZOOMPAN_WORK_SCALE}:{clipper.VIDEO_HEIGHT * clipper.ZOOMPAN_WORK_SCALE}",
            fg,
        )
        self.assertIn("d=540", fg)
        self.assertIn("subtitles=/tmp/x.ass", fg)

    def test_build_zoompan_filter_omits_subtitles_when_path_none(self):
        fg = clipper._build_zoompan_filter(18.0, None)
        self.assertIn("zoompan=z=", fg)
        self.assertNotIn("subtitles=", fg)

    def test_build_audio_fade_filter_ends_at_clip_boundary(self):
        self.assertEqual(
            clipper._build_audio_fade_filter(30.0, 0.8),
            "afade=t=out:st=29.200:d=0.800",
        )

    def test_resolve_audio_fade_uses_default_for_invalid_values(self):
        for configured in ("not-a-number", "nan", "inf", "-inf"):
            with self.subTest(configured=configured):
                self.assertEqual(
                    clipper._resolve_audio_fade_out_seconds(configured),
                    clipper.DEFAULT_AUDIO_FADE_OUT_SECONDS,
                )

    def test_resolve_audio_fade_clamps_negative_value_to_disabled(self):
        self.assertEqual(clipper._resolve_audio_fade_out_seconds(-2.0), 0.0)

    def test_render_clip_video_applies_audio_fade_out(self):
        with mock.patch("lib.clipper.subprocess.run") as run_mock:
            clipper._render_clip_video(
                Path("background.png"),
                Path("captions.ass"),
                "episode.mp3",
                Path("clip.mp4"),
                start=10.0,
                end=40.0,
                burn_subtitles=False,
                audio_fade_out_seconds=0.8,
            )

        command = run_mock.call_args.args[0]
        fade_index = command.index("-af")
        self.assertEqual(command[fade_index + 1], "afade=t=out:st=29.200:d=0.800")

    def test_extract_openai_image_bytes_reads_b64_payload(self):
        class Item:
            b64_json = "ZmFrZS1wbmc="

        class Resp:
            data = [Item()]

        self.assertEqual(
            clipper._extract_openai_image_bytes(Resp),
            b"fake-png",
        )

    def test_extract_openai_image_bytes_downloads_url_payload(self):
        class Item:
            b64_json = None
            url = "https://example.com/fake.png"

        class Resp:
            data = [Item()]

        fake_response = mock.MagicMock()
        fake_response.__enter__.return_value.read.return_value = b"url-png"
        fake_response.__exit__.return_value = None

        with mock.patch("lib.clipper.urllib.request.urlopen", return_value=fake_response) as urlopen:
            self.assertEqual(
                clipper._extract_openai_image_bytes(Resp),
                b"url-png",
            )
        urlopen.assert_called_once_with("https://example.com/fake.png", timeout=120)

    def test_extract_openrouter_image_bytes_reads_data_url_payload(self):
        class ImageUrl:
            url = "data:image/png;base64,ZmFrZS1wbmc="

        class ImageItem:
            image_url = ImageUrl()

        class Message:
            images = [ImageItem()]

        class Choice:
            message = Message()

        class Response:
            choices = [Choice()]

        self.assertEqual(
            clipper._extract_openrouter_image_bytes(Response()),
            b"fake-png",
        )

    def test_extract_openrouter_image_bytes_rejects_remote_url_payload(self):
        class ImageUrl:
            url = "https://127.0.0.1/private.png"

        class ImageItem:
            image_url = ImageUrl()

        class Message:
            images = [ImageItem()]

        class Choice:
            message = Message()

        class Response:
            choices = [Choice()]

        with mock.patch("lib.clipper.urllib.request.urlopen") as urlopen:
            self.assertIsNone(clipper._extract_openrouter_image_bytes(Response()))
        urlopen.assert_not_called()

    def test_generate_background_image_openrouter_requests_image_modality(self):
        response = mock.Mock()
        response.choices = [
            mock.Mock(
                message=mock.Mock(
                    images=[mock.Mock(image_url=mock.Mock(url="data:image/png;base64,ZmFrZS1wbmc="))]
                )
            )
        ]
        client = mock.Mock()
        client.chat.completions.create.return_value = response

        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "image.png"
            config = {
                "settings": {
                    "openrouter_visual_model": "google/gemini-3.1-flash-image",
                    "visual_timeout_seconds": 123,
                }
            }
            with mock.patch("lib.runtime_config.get_openrouter_api_key", return_value="test-key"), mock.patch(
                "lib.runtime_config.get_openrouter_api_url", return_value="https://openrouter.example/v1"
            ), mock.patch("openai.OpenAI", return_value=client) as openai_ctor:
                self.assertTrue(clipper._generate_background_image_openrouter("prompt", out, config))

            self.assertTrue(out.is_file())
            request = client.chat.completions.create.call_args.kwargs
            self.assertEqual(request["model"], "google/gemini-3.1-flash-image")
            self.assertEqual(request["modalities"], ["image", "text"])
            self.assertEqual(request["messages"], [{"role": "user", "content": "prompt"}])
            self.assertEqual(openai_ctor.call_args.kwargs["timeout"], 123.0)

    def test_generate_background_image_openai_retries_without_unsupported_quality(self):
        response = mock.Mock()
        response.data = [mock.Mock(b64_json="ZmFrZS1wbmc=", url=None)]

        class FakeBadRequestError(Exception):
            pass

        client = mock.Mock()
        client.images.generate.side_effect = [
            FakeBadRequestError("Unknown parameter: 'quality'."),
            response,
        ]

        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "image.png"
            config = {
                "settings": {
                    "openai_visual_model": "gpt-image-1",
                    "openai_image_size": "1024x1536",
                    "openai_image_quality": "high",
                }
            }
            with mock.patch("lib.runtime_config.get_openai_api_key", return_value="test-key"), mock.patch(
                "lib.runtime_config.get_openai_base_url", return_value=""
            ), mock.patch("openai.OpenAI", return_value=client), mock.patch(
                "openai.BadRequestError", FakeBadRequestError
            ):
                self.assertTrue(clipper._generate_background_image_openai("prompt", out, config))

            self.assertTrue(out.is_file())
            calls = client.images.generate.call_args_list
            self.assertEqual(calls[0].kwargs["quality"], "high")
            self.assertNotIn("style", calls[0].kwargs)
            self.assertNotIn("quality", calls[1].kwargs)

    def test_build_ass_subtitles_uses_relative_clip_timestamps(self):
        subtitle_text = clipper._build_ass_subtitles(
            [
                {"start": 30.0, "end": 33.4, "text": "first line"},
                {"start": 34.0, "end": 36.0, "text": "second line"},
            ],
            start=30.0,
            end=40.0,
        )

        self.assertIn("Dialogue: 0,0:00:00.00,0:00:03.40,Caption,,0,0,0,,FIRST LINE", subtitle_text)
        self.assertIn("Dialogue: 0,0:00:04.00,0:00:06.00,Caption,,0,0,0,,SECOND LINE", subtitle_text)
        self.assertIn("[V4+ Styles]", subtitle_text)

    def _dialogues(self, subtitle_text):
        rows = [line.split(",", 9) for line in subtitle_text.splitlines() if line.startswith("Dialogue:")]
        return [(row[1], row[2], row[9]) for row in rows]

    def test_captions_with_word_timings_break_on_punctuation_and_length(self):
        words = [
            {"start": 10.0, "end": 10.3, "text": "It's"},
            {"start": 10.3, "end": 10.6, "text": "hard"},
            {"start": 10.6, "end": 10.8, "text": "to"},
            {"start": 10.8, "end": 11.3, "text": "express"},
            {"start": 11.3, "end": 12.0, "text": "punctuation"},
            {"start": 12.0, "end": 12.2, "text": "when"},
            {"start": 12.2, "end": 12.5, "text": "you're"},
            {"start": 12.5, "end": 13.0, "text": "speaking."},
            {"start": 13.1, "end": 13.4, "text": "Right."},
        ]
        segment = {"start": 10.0, "end": 13.4, "text": " " + " ".join(w["text"] for w in words), "words": words}

        captions = self._dialogues(clipper._build_ass_subtitles([segment], start=10.0, end=20.0))

        self.assertEqual(
            captions,
            [
                ("0:00:00.00", "0:00:02.00", "IT'S HARD TO EXPRESS PUNCTUATION"),
                ("0:00:02.00", "0:00:03.10", "WHEN YOU'RE SPEAKING."),
                ("0:00:03.10", "0:00:03.40", "RIGHT."),
            ],
        )
        self.assertTrue(all(len(text) <= clipper.CAPTION_MAX_CHARS for _, _, text in captions))

    def test_captions_without_words_split_long_segment_proportionally(self):
        text = "and then he just walks into the bar with a whole wheel of cheese under his arm like nothing happened"
        segment = {"start": 0.0, "end": 20.0, "text": text}

        captions = self._dialogues(clipper._build_ass_subtitles([segment], start=0.0, end=20.0))

        self.assertGreater(len(captions), 3)
        self.assertTrue(all(len(caption) <= clipper.CAPTION_MAX_CHARS for _, _, caption in captions))
        self.assertEqual(" ".join(caption for _, _, caption in captions), text.upper())
        self.assertEqual(captions[0][0], "0:00:00.00")
        self.assertEqual(captions[-1][1], "0:00:20.00")

    def test_captions_merge_whisper_fragments_up_to_limit(self):
        fragments = ["young", "guns", "too", "yeah", "we just", "recently", "watched", "the first", "one"]
        segments = [
            {"start": 5066.0 + i * 0.5, "end": 5066.0 + i * 0.5 + 0.45, "text": text}
            for i, text in enumerate(fragments)
        ]

        captions = self._dialogues(clipper._build_ass_subtitles(segments, start=5066.0, end=5075.0))

        self.assertEqual(
            [caption for _, _, caption in captions],
            ["YOUNG GUNS TOO YEAH WE JUST", "RECENTLY WATCHED THE FIRST ONE"],
        )

    def test_captions_only_show_words_inside_the_clip_window(self):
        words = [
            {"start": 0.0, "end": 1.0, "text": "before"},
            {"start": 2.0, "end": 3.0, "text": "inside"},
            {"start": 4.0, "end": 5.0, "text": "after"},
        ]
        segment = {"start": 0.0, "end": 5.0, "text": " before inside after", "words": words}

        captions = self._dialogues(clipper._build_ass_subtitles([segment], start=1.5, end=3.5))

        self.assertEqual(captions, [("0:00:00.50", "0:00:01.50", "INSIDE")])

    def test_caption_fit_is_measured_in_the_font_not_just_characters(self):
        if clipper._caption_font() is None:
            self.skipTest("caption font not installed")
        self.assertTrue(clipper._caption_fits("IT'S HARD TO EXPRESS PUNCTUATION"))
        # Same length, but wide letters wrap to three lines.
        self.assertFalse(clipper._caption_fits("MOMMA WANTS WOMBAT MEMORABILIA M"))

    def test_caption_does_not_linger_on_a_stretched_word(self):
        segment = {"start": 0.0, "end": 22.4, "text": " time,", "words": [{"start": 0.0, "end": 22.4, "text": "time,"}]}
        captions = self._dialogues(clipper._build_ass_subtitles([segment], start=0.0, end=30.0))
        self.assertEqual(captions, [("0:00:00.00", "0:00:01.50", "TIME,")])


if __name__ == "__main__":
    unittest.main()
