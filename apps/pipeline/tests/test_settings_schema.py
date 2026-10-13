import ast
import json
import unittest
from pathlib import Path

from lib import clip_files, clipper, cowork_headless, settings_schema, stage_status, thumbnail, transcriber

ROOT = Path(__file__).resolve().parents[1]
# Every file that can read a setting. The schema itself looks keys up by variable.
SOURCES = sorted(
    path for pattern in ("*.py", "lib/*.py", "scripts/*.py", "dashboard/*.py")
    for path in ROOT.glob(pattern) if path.name != "settings_schema.py"
)
# Reads whose key is not a literal: the file, and the keys it can ask for.
DYNAMIC_READS = {
    "lib/transcriber.py": lambda ops: set(transcriber._MODEL_SETTING_KEYS.values()),
    "lib/runtime_config.py": lambda ops: {
        f"{op}_timeout{suffix}" for op in ops | {"llm"} for suffix in ("_seconds", "")
    },
    "dashboard/views.py": lambda ops: set(),  # the Settings tab lists the schema; it reads no key of its own
    # The Lab compares a draft's keys with config.json, and names the paid provider's model.
    "lib/lab.py": lambda ops: {"openrouter_visual_model", "openai_visual_model"},
}


def _is_settings(node: ast.AST, rel: str = "") -> bool:
    """``settings``, ``<config>.get("settings", ...)``, ``_settings(config)``, or runtime_config's ``s``."""
    if isinstance(node, ast.Name):
        return node.id == "settings" or (node.id == "s" and rel == "lib/runtime_config.py")
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        return node.func.id == "_settings"  # lib/cowork_headless.py
    return (
        isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get"
        and bool(node.args) and isinstance(node.args[0], ast.Constant) and node.args[0].value == "settings"
    )


def _literal(node: ast.AST):
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None


def settings_reads():
    """Return (literal keys the code reads, files with a non-literal read, timeout operations)."""
    keys, dynamic, operations = set(), set(), set()
    for path in SOURCES:
        rel = path.relative_to(ROOT).as_posix()
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            key_node = None
            if isinstance(node, ast.Call):
                operations.update(
                    kw.value.value for kw in node.keywords
                    if kw.arg == "operation" and isinstance(kw.value, ast.Constant)
                )
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
                if node.func.attr == "get" and node.args and _is_settings(node.func.value, rel):
                    key_node = node.args[0]
                elif (node.func.attr in ("value", "source") and isinstance(node.func.value, ast.Name)
                      and node.func.value.id == "settings_schema" and len(node.args) == 2):
                    key_node = node.args[1]
            elif isinstance(node, ast.Subscript) and _is_settings(node.value, rel):
                key_node = node.slice
            if key_node is None:
                continue
            if _literal(key_node) is None:
                dynamic.add(rel)
            else:
                keys.add(_literal(key_node))
    return keys, dynamic, operations


class DeclaredKeysTests(unittest.TestCase):
    def setUp(self):
        literal, self.dynamic_files, operations = settings_reads()
        self.read = set(literal)
        for rel in self.dynamic_files & set(DYNAMIC_READS):
            self.read |= DYNAMIC_READS[rel](operations)

    def test_every_key_the_code_reads_is_declared(self):
        self.assertEqual(self.read - set(settings_schema.BY_KEY), set())
        # A read with a computed key must be one DYNAMIC_READS knows how to expand.
        self.assertEqual(self.dynamic_files, set(DYNAMIC_READS))

    def test_every_key_in_config_json_is_declared(self):
        config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
        self.assertGreater(len(config["settings"]), 20)
        self.assertEqual(set(config["settings"]) - set(settings_schema.BY_KEY), set())

    def test_a_setting_names_a_stage_exactly_when_the_code_reads_it(self):
        with_stage = {s.key for s in settings_schema.SETTINGS if s.stages}
        self.assertEqual(with_stage, self.read)
        self.assertEqual({s.key for s in settings_schema.SETTINGS if not s.stages}, {"clip_duration"})

    def test_stages_and_groups_are_real(self):
        self.assertEqual(settings_schema.GROUPS, (
            "Transcription", "Review clips", "Clips and captions", "Visuals",
            "Thumbnail", "Prompts", "Cowork instructions",
        ))
        for setting in settings_schema.SETTINGS:
            with self.subTest(setting.key):
                self.assertIn(setting.group, settings_schema.GROUPS)
                self.assertLessEqual(set(setting.stages), set(stage_status.STAGES))
                self.assertTrue(setting.description.strip())
                self.assertIn(setting.type, ("bool", "int", "float", "str", "text", "path", "choice"))
                self.assertEqual(bool(setting.choices), setting.type == "choice")

    def test_every_default_passes_its_own_checks(self):
        self.assertGreater(len(settings_schema.SETTINGS), 30)
        for setting in settings_schema.SETTINGS:
            with self.subTest(setting.key):
                self.assertEqual(settings_schema.problems(setting.key, setting.default), [])


class ValueTests(unittest.TestCase):
    def test_value_is_the_config_value_when_set_and_the_default_when_not(self):
        self.assertEqual(settings_schema.value({"review_clip_max_seconds": 240}, "review_clip_max_seconds"), 240)
        self.assertEqual(settings_schema.value({}, "review_clip_max_seconds"), 180.0)
        self.assertEqual(settings_schema.default("review_clip_max_seconds"), 180.0)
        self.assertEqual(settings_schema.source({"review_clip_max_seconds": 240}, "review_clip_max_seconds"), "config")
        self.assertEqual(settings_schema.source({}, "review_clip_max_seconds"), "default")

    def test_thumbnail_logo_settings_fall_back_to_the_clip_logo_settings(self):
        key = "thumbnail_logo_margin_px"
        self.assertEqual(settings_schema.value({}, key), 40)
        self.assertEqual(settings_schema.value({"brand_logo_margin_px": 48}, key), 48)
        self.assertEqual(settings_schema.source({"brand_logo_margin_px": 48}, key), "brand_logo_margin_px")
        self.assertEqual(settings_schema.value({"brand_logo_margin_px": 48, key: 12}, key), 12)
        self.assertEqual(settings_schema.source({"brand_logo_margin_px": 48, key: 12}, key), "config")

    def test_an_undeclared_key_is_an_error_not_a_silent_default(self):
        with self.assertRaises(KeyError):
            settings_schema.value({}, "review_clip_max_secs")
        self.assertEqual(settings_schema.problems("review_clip_max_secs", 1), ["review_clip_max_secs is not a known setting"])

    def test_problems_checks_type_range_and_choices(self):
        cases = [
            ("review_clip_max_seconds", 240, []),
            ("review_clip_max_seconds", "240", ["review_clip_max_seconds must be a number, not '240'"]),
            ("review_clip_max_seconds", 0, ["review_clip_max_seconds must be between 1 and 3600, not 0"]),
            ("review_clip_max_per_movie", 2.5, ["review_clip_max_per_movie must be a whole number, not 2.5"]),
            ("review_clip_max_per_movie", True, ["review_clip_max_per_movie must be a whole number, not True"]),
            ("brand_logo_enabled", "yes", ["brand_logo_enabled must be true or false, not 'yes'"]),
            ("visuals_provider", "dalle", ["visuals_provider must be one of openrouter, openai, local, not 'dalle'"]),
            ("visual_style_suffix", 5, ["visual_style_suffix must be text, not 5"]),
            ("local_visual_python", None, []),
            ("review_clip_max_seconds", None, ["review_clip_max_seconds must be a number, not None"]),
            ("review_clip_max_seconds", float("nan"), ["review_clip_max_seconds must be a number, not nan"]),
        ]
        for key, candidate, expected in cases:
            with self.subTest(key=key, candidate=candidate):
                self.assertEqual(settings_schema.problems(key, candidate), expected)


class ConfigCheckTests(unittest.TestCase):
    def test_config_check_lists_unset_unread_undeclared_and_invalid_keys(self):
        check = settings_schema.config_check({
            "clip_duration": 60, "cowork_mode": "require", "review_clip_max_per_movie": 0,
            **{s.key: s.default for s in settings_schema.SETTINGS
               if s.stages and s.key not in ("llm_timeout", "review_clip_max_per_movie")},
        })
        self.assertEqual(check["notInConfig"], ["llm_timeout"])
        self.assertEqual(check["unread"], ["clip_duration"])
        self.assertEqual(check["undeclared"], ["cowork_mode"])
        self.assertEqual(check["invalid"], [{
            "key": "review_clip_max_per_movie",
            "problems": ["review_clip_max_per_movie must be between 1 and 20, not 0"],
        }])

    def test_the_checked_in_config_leaves_most_settings_to_their_defaults_and_carries_one_unread_key(self):
        config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
        check = settings_schema.config_check(config["settings"])
        self.assertEqual(len(check["notInConfig"]), 29)
        for key in ("review_clip_max_seconds", "min_clip_duration_seconds", "visual_timeout_seconds",
                    "cowork_headless_model", "caption_font_size", "clip_zoom_amount"):
            self.assertIn(key, check["notInConfig"])
        self.assertNotIn("cowork_headless", check["notInConfig"])
        self.assertEqual(check["unread"], ["clip_duration"])
        self.assertEqual(check["undeclared"], [])
        self.assertEqual(check["invalid"], [])


class StageDefaultsTests(unittest.TestCase):
    """The stages take their defaults from the schema, so each default has one copy."""

    def test_stage_constants_are_the_schema_defaults(self):
        self.assertEqual(clip_files.DEFAULT_MIN_CLIP_DURATION, 20.0)
        self.assertIs(clip_files.DEFAULT_MIN_CLIP_DURATION, settings_schema.default("min_clip_duration_seconds"))
        self.assertIs(clipper.DEFAULT_STYLE_SUFFIX, settings_schema.default("visual_style_suffix"))
        self.assertTrue(clipper.DEFAULT_STYLE_SUFFIX.startswith("Vertical 9:16 cinematic poster art"))
        self.assertIs(clipper.DEFAULT_AUDIO_FADE_OUT_SECONDS, settings_schema.default("clip_audio_fade_out_seconds"))
        self.assertEqual(clipper.DEFAULT_AUDIO_FADE_OUT_SECONDS, 0.8)
        self.assertEqual(transcriber.DEFAULT_ENGINE, "parakeet")
        self.assertIs(transcriber.DEFAULT_ENGINE, settings_schema.default("transcription_engine"))
        self.assertEqual(transcriber.DEFAULT_MODELS, {
            "parakeet": settings_schema.default("parakeet_model"),
            "faster-whisper": settings_schema.default("whisper_model"),
        })
        self.assertEqual(transcriber.DEFAULT_MODELS["faster-whisper"], "large-v3-turbo")
        self.assertEqual((cowork_headless.DEFAULT_COMMAND, cowork_headless.DEFAULT_TIMEOUT_SECONDS), ("claude", 3600.0))
        self.assertIs(cowork_headless.DEFAULT_COMMAND, settings_schema.default("cowork_headless_command"))
        self.assertIs(cowork_headless.DEFAULT_TIMEOUT_SECONDS,
                      settings_schema.default("cowork_headless_timeout_seconds"))
        # Headless is off unless config.json turns it on.
        self.assertIs(settings_schema.default("cowork_headless"), False)
        self.assertFalse(cowork_headless.enabled({"settings": {}}))

    def test_choices_match_what_the_stages_accept(self):
        def choices(key):
            return set(getattr(settings_schema.BY_KEY.get(key), "choices", ()))

        self.assertEqual(choices("transcription_engine"), set(transcriber.DEFAULT_MODELS))
        self.assertEqual(choices("thumbnail_logo_position"), thumbnail.LOGO_POSITIONS)
        self.assertEqual(thumbnail.LOGO_POSITION, settings_schema.default("thumbnail_logo_position"))
        self.assertEqual(settings_schema.default("local_visual_width"), clipper.VIDEO_WIDTH)
        self.assertEqual(settings_schema.default("local_visual_height"), clipper.VIDEO_HEIGHT)

    def test_no_stage_keeps_its_own_copy_of_a_default(self):
        # A default written at the call site (`settings.get("key", 3.0)`) is a second copy.
        offenders = []
        for path in SOURCES:
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                        and node.func.attr == "get" and _is_settings(node.func.value)
                        and len(node.args) == 2 and _literal(node.args[0]) is not None):
                    offenders.append(f"{path.relative_to(ROOT).as_posix()}:{node.lineno} {_literal(node.args[0])}")
        self.assertEqual(offenders, [])


class ClipLookSettingsTests(unittest.TestCase):
    """The look of a rendered clip is settings whose defaults are what the clipper always did."""

    DEFAULTS = {
        "caption_font_path": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "caption_font_name": "Arial Bold", "caption_font_size": 84,
        "caption_color": "#FFFF00", "caption_outline_color": "#000000", "caption_outline_px": 4,
        "caption_margin_bottom_px": 220, "caption_margin_side_px": 80,
        "caption_max_chars": 32, "caption_max_lines": 2,
        "caption_pause_seconds": 0.5, "caption_max_word_seconds": 1.5, "caption_bridge_seconds": 0.3,
        "clip_zoom_amount": 0.12,
    }

    def test_look_settings_default_to_the_values_that_were_constants(self):
        declared = {key: getattr(settings_schema.BY_KEY.get(key), "default", "undeclared") for key in self.DEFAULTS}
        self.assertEqual(declared, self.DEFAULTS)
        for key in self.DEFAULTS:
            setting = settings_schema.BY_KEY[key]
            self.assertEqual((setting.group, setting.stages), ("Clips and captions", ("clip",)), key)

    def test_the_clipper_takes_its_look_from_the_schema(self):
        look = clipper.DEFAULT_LOOK
        self.assertEqual({
            "caption_font_path": look.font_path, "caption_font_name": look.font_name,
            "caption_font_size": look.font_size, "caption_color": look.color,
            "caption_outline_color": look.outline_color, "caption_outline_px": look.outline_px,
            "caption_margin_bottom_px": look.margin_bottom_px, "caption_margin_side_px": look.margin_side_px,
            "caption_max_chars": look.max_chars, "caption_max_lines": look.max_lines,
            "caption_pause_seconds": look.pause_seconds, "caption_max_word_seconds": look.max_word_seconds,
            "caption_bridge_seconds": look.bridge_seconds, "clip_zoom_amount": clipper.DEFAULT_ZOOM_AMOUNT,
        }, {key: settings_schema.default(key) if key in settings_schema.BY_KEY else "undeclared" for key in self.DEFAULTS})
        # Nothing about the look is left as a literal in the clipper.
        source = (ROOT / "lib" / "clipper.py").read_text(encoding="utf-8")
        for literal in ("Arial Bold", "0.12", "#FFFF00", "= 84", "= 220"):
            self.assertNotIn(literal, source)

    def test_colours_and_font_names_are_checked_by_shape(self):
        cases = [
            ("caption_color", "#12ab9f", []),
            ("caption_color", "yellow", ["caption_color must be a colour like #FFFF00, not 'yellow'"]),
            ("caption_outline_color", "#FFF", ["caption_outline_color must be a colour like #FFFF00, not '#FFF'"]),
            ("caption_font_name", "Helvetica Neue", []),
            ("caption_font_name", "Arial, Bold", ["caption_font_name must be a font name with no comma, not 'Arial, Bold'"]),
            ("caption_font_name", "", ["caption_font_name must be a font name with no comma, not ''"]),
            ("clip_zoom_amount", 1.5, ["clip_zoom_amount must be between 0 and 1, not 1.5"]),
            ("caption_font_size", 500, ["caption_font_size must be between 20 and 240, not 500"]),
        ]
        for key, candidate, expected in cases:
            with self.subTest(key=key, candidate=candidate):
                self.assertEqual(settings_schema.problems(key, candidate), expected)


class DraftableTests(unittest.TestCase):
    def test_a_draft_may_hold_only_what_a_lab_clip_run_reads_and_never_a_program_to_run(self):
        draftable = {s.key for s in settings_schema.SETTINGS if s.draft}
        self.assertEqual(draftable, set(ClipLookSettingsTests.DEFAULTS) | {
            "min_clip_duration_seconds", "clip_audio_fade_out_seconds", "visual_style_suffix",
            "visuals_provider", "openrouter_visual_model", "openai_visual_model", "openai_image_size",
            "openai_image_quality", "local_visual_model", "local_visual_steps", "local_visual_seed",
            "local_visual_width", "local_visual_height",
            "brand_logo_enabled", "brand_logo_path", "brand_logo_margin_px",
            "brand_logo_max_width_fraction", "brand_logo_max_height_fraction",
        })
        for setting in settings_schema.SETTINGS:
            if setting.draft:
                self.assertIn("clip", setting.stages, setting.key)
        for key in ("local_visual_script", "local_visual_python", "cowork_headless_command",
                    "local_visual_reuse_cached_still", "cowork_headless", "cowork_outputs_dir"):
            self.assertFalse(settings_schema.BY_KEY[key].draft, key)


if __name__ == "__main__":
    unittest.main()
