import unittest

from lib import visual_prompts


class VisualPromptTests(unittest.TestCase):
    def test_prohibited_production_imagery_variants_are_replaced(self):
        spoken_context = "A haunted arcade cabinet glows after it is unplugged."
        for prompt in (
            "A moody recording studio lit by a single red bulb.",
            "Two hosts in an audio booth speaking into mics.",
            "A close-up of vintage microphones under blue light.",
            "Radio presenters at a mixing console in a broadcast booth.",
            "Two people talking into a soundboard in a recording room.",
            "A radio show control room with two conversational hosts.",
            "Friends speaking into studio gear.",
        ):
            with self.subTest(prompt=prompt):
                self.assertTrue(visual_prompts.looks_like_generic_podcast_imagery(prompt))
                normalized = visual_prompts.normalize_clip_image_prompt(
                    {"imagePrompt": prompt}, spoken_context
                )
                self.assertIn("haunted arcade cabinet", normalized)
                self.assertNotIn(prompt, normalized)

    def test_spoken_context_never_exceeds_character_limit_for_unbroken_text(self):
        context = visual_prompts.spoken_context_for_clip(
            [{"start": 0.0, "end": 10.0, "text": "x" * 500}],
            start=0.0,
            end=10.0,
            max_chars=420,
        )

        self.assertEqual(len(context), 420)
        self.assertTrue(context.endswith("…"))


if __name__ == "__main__":
    unittest.main()
