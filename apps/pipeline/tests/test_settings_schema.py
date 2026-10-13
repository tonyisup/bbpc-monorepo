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

    def test_the_checked_in_config_lacks_fifteen_settings_and_carries_one_unread_key(self):
        config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
        check = settings_schema.config_check(config["settings"])
        self.assertEqual(check["notInConfig"], [
            "cowork_headless_command", "cowork_headless_model", "llm_timeout", "llm_timeout_seconds", "local_visual_python", "local_visual_reuse_cached_still",
            "min_clip_duration_seconds", "review_clip_max_per_movie", "review_clip_max_seconds",
            "review_clip_merge_gap_seconds", "review_clip_min_seconds", "review_clip_postroll_seconds",
            "review_clip_preroll_seconds", "visual_timeout", "visual_timeout_seconds",
        ])
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


class ClipLookTests(unittest.TestCase):
    """The clip's look is still code constants; the schema reads them without importing Pillow."""

    def test_constants_are_read_from_the_clipper_source(self):
        look = settings_schema.clip_look()
        values = {row["name"]: row["value"] for row in look["constants"]}
        self.assertGreater(len(values), 8)
        for name, shown in values.items():
            with self.subTest(name):
                self.assertEqual(shown, getattr(clipper, name))
        self.assertEqual(values["CAPTION_LINE_WIDTH"], 912)
        self.assertEqual(values["CAPTION_FONT_SIZE"], 84)
        for row in look["constants"]:
            self.assertTrue(row["description"].strip(), row["name"])

    def test_every_caption_constant_in_the_clipper_is_listed(self):
        listed = {row["name"] for row in settings_schema.clip_look()["constants"]}
        in_code = {name for name in vars(clipper) if name.startswith("CAPTION_")}
        self.assertGreater(len(in_code), 6)
        self.assertEqual(in_code - listed, set())

    def test_zoom_and_caption_style_are_quoted_from_the_code(self):
        look = settings_schema.clip_look()
        self.assertEqual(look["zoom"], clipper._build_zoompan_filter.__doc__.strip().splitlines()[0])
        self.assertIn("1.0→1.12", look["zoom"])
        self.assertEqual(
            look["captionStyle"],
            "Style: Caption,Arial Bold,84,&H0000FFFF,&H0000FFFF,&H00000000,&H64000000,"
            "-1,0,0,0,100,100,0,0,1,4,0,2,80,80,220,1",
        )
        self.assertIn(look["captionStyle"], clipper._build_ass_subtitles([], 0.0, 1.0))


if __name__ == "__main__":
    unittest.main()
