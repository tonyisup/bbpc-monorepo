"""Every ``settings`` key in ``config.json``: type, default, limits, and the stage that reads it.

The stages take their defaults from here (``value(settings, key)``), so each
default has one copy, and the dashboard's Settings tab is drawn from the same
table. ``tests/test_settings_schema.py`` checks the table against the code:
every key a stage reads is declared, and every key in ``config.json`` is too.

Standard library only: the dashboard and the validator import this without the
pipeline venv.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Tuple

GROUPS = (
    "Transcription", "Review clips", "Clips and captions", "Visuals",
    "Thumbnail", "Prompts", "Cowork instructions",
)


@dataclass(frozen=True)
class Setting:
    key: str
    type: str                      # bool, int, float, str, text, path or choice
    default: Any                   # None: unset, and the description says what happens then
    group: str
    stages: Tuple[str, ...]        # pipeline stages that read it; empty when nothing does
    description: str
    minimum: Optional[float] = None
    maximum: Optional[float] = None
    choices: Tuple[str, ...] = ()
    fallback: Optional[str] = None  # another setting used when this one is not in config.json
    pattern: Optional[str] = None   # a text value must match this in full...
    pattern_words: str = ""         # ...described in these words when it does not
    draft: bool = False             # a Lab draft may change it: the clip stage reads it and it names no program


_TRANSCRIBE = ("transcribe",)
_REVIEW = ("review_clip",)
_CLIP = ("clip",)
_THUMBNAIL = ("thumbnail",)
_LOGO = ("clip", "thumbnail")
_COWORK = ("movies", "parse")
_COLOUR = {"pattern": r"#[0-9A-Fa-f]{6}", "pattern_words": "a colour like #FFFF00"}
_FONT_NAME = {"pattern": r"[^,\n]+", "pattern_words": "a font name with no comma"}

SETTINGS: Tuple[Setting, ...] = (
    Setting("transcription_engine", "choice", "parakeet", "Transcription", _TRANSCRIBE,
            "Speech-to-text engine. Parakeet runs on the Apple Silicon GPU; faster-whisper on the CPU.",
            choices=("parakeet", "faster-whisper")),
    Setting("parakeet_model", "str", "mlx-community/parakeet-tdt-0.6b-v2", "Transcription", _TRANSCRIBE,
            "Model used when the engine is parakeet."),
    Setting("whisper_model", "str", "large-v3-turbo", "Transcription", _TRANSCRIBE,
            "Model used when the engine is faster-whisper."),

    Setting("review_clip_merge_gap_seconds", "float", 6.0, "Review clips", _REVIEW,
            "Evidence windows closer together than this are joined into one clip.", 0, 60),
    Setting("review_clip_preroll_seconds", "float", 3.0, "Review clips", _REVIEW,
            "Audio kept before each evidence window.", 0, 30),
    Setting("review_clip_postroll_seconds", "float", 3.0, "Review clips", _REVIEW,
            "Audio kept after each evidence window.", 0, 30),
    Setting("review_clip_min_seconds", "float", 12.0, "Review clips", _REVIEW,
            "Windows shorter than this are dropped.", 0, 600),
    Setting("review_clip_max_seconds", "float", 180.0, "Review clips", _REVIEW,
            "Longer windows are cut off at this length.", 1, 3600),
    Setting("review_clip_max_per_movie", "int", 3, "Review clips", _REVIEW,
            "At most this many audio clips per reviewed movie.", 1, 20),

    Setting("min_clip_duration_seconds", "float", 20.0, "Clips and captions", _CLIP,
            "Picks shorter than this are not rendered. Rendered clips are numbered after it is applied.", 0, 600,
            draft=True),
    Setting("clip_audio_fade_out_seconds", "float", 0.8, "Clips and captions", _CLIP,
            "Length of the audio fade at the end of each rendered clip. 0 turns it off.", 0, 10, draft=True),
    Setting("clip_zoom_amount", "float", 0.12, "Clips and captions", _CLIP,
            "How far the background zooms in over the clip. 0.12 ends at 112%; 0 holds it still.", 0, 1,
            draft=True),
    Setting("caption_font_name", "str", "Arial Bold", "Clips and captions", _CLIP,
            "Font the captions are drawn in, by name.", draft=True, **_FONT_NAME),
    Setting("caption_font_path", "path", "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "Clips and captions", _CLIP,
            "File of that same font. Captions are measured in it so lines break where they will on screen.",
            draft=True),
    Setting("caption_font_size", "int", 84, "Clips and captions", _CLIP,
            "Caption font size in pixels, on the 1080x1920 frame.", 20, 240, draft=True),
    Setting("caption_color", "str", "#FFFF00", "Clips and captions", _CLIP,
            "Caption text colour.", draft=True, **_COLOUR),
    Setting("caption_outline_color", "str", "#000000", "Clips and captions", _CLIP,
            "Colour of the outline around caption text.", draft=True, **_COLOUR),
    Setting("caption_outline_px", "int", 4, "Clips and captions", _CLIP,
            "Width of that outline.", 0, 20, draft=True),
    Setting("caption_margin_bottom_px", "int", 220, "Clips and captions", _CLIP,
            "Gap between the bottom of the frame and the captions.", 0, 1800, draft=True),
    Setting("caption_margin_side_px", "int", 80, "Clips and captions", _CLIP,
            "Gap between each side of the frame and the captions.", 0, 400, draft=True),
    Setting("caption_max_chars", "int", 32, "Clips and captions", _CLIP,
            "Most characters in one caption.", 8, 80, draft=True),
    Setting("caption_max_lines", "int", 2, "Clips and captions", _CLIP,
            "Most lines one caption may wrap onto.", 1, 4, draft=True),
    Setting("caption_pause_seconds", "float", 0.5, "Clips and captions", _CLIP,
            "A pause longer than this between words starts a new caption.", 0, 5, draft=True),
    Setting("caption_max_word_seconds", "float", 1.5, "Clips and captions", _CLIP,
            "Longest one word stays on screen. Parakeet sometimes stretches a word over music.", 0.2, 10,
            draft=True),
    Setting("caption_bridge_seconds", "float", 0.3, "Clips and captions", _CLIP,
            "A caption holds until the next one when the gap between them is shorter than this.", 0, 5,
            draft=True),
    Setting("clip_duration", "int", None, "Clips and captions", (),
            "Nothing reads this. It can be removed from config.json.", 1, 600),

    Setting("visuals_provider", "choice", "local", "Visuals", _CLIP,
            "Where a clip's background still comes from. openrouter and openai are paid requests.",
            choices=("openrouter", "openai", "local"), draft=True),
    Setting("openrouter_visual_model", "str", "google/gemini-3.1-flash-image", "Visuals", _CLIP,
            "Image model when the provider is openrouter.", draft=True),
    Setting("openai_visual_model", "str", "gpt-image-1", "Visuals", _CLIP,
            "Image model when the provider is openai.", draft=True),
    Setting("openai_image_size", "str", "1024x1536", "Visuals", _CLIP,
            "Image size requested from openai.", draft=True),
    Setting("openai_image_quality", "str", "high", "Visuals", _CLIP,
            "Image quality requested from openai.", draft=True),
    Setting("local_visual_model", "str", "stabilityai/sdxl-turbo", "Visuals", _CLIP,
            "Model when the provider is local.", draft=True),
    Setting("local_visual_script", "path", "./scripts/generate_local_visual.py", "Visuals", _CLIP,
            "Script that generates a still when the provider is local."),
    Setting("local_visual_python", "path", None, "Visuals", _CLIP,
            "Python that runs the local script. Unset: the interpreter running the pipeline."),
    Setting("local_visual_steps", "int", 8, "Visuals", _CLIP,
            "Diffusion steps for a local still.", 1, 100, draft=True),
    Setting("local_visual_seed", "int", 42, "Visuals", _CLIP,
            "Seed for a local still.", 0, 2**32 - 1, draft=True),
    Setting("local_visual_width", "int", 1080, "Visuals", _CLIP,
            "Width of a local still before it is fitted to the 1080x1920 frame.", 64, 4096, draft=True),
    Setting("local_visual_height", "int", 1920, "Visuals", _CLIP,
            "Height of a local still before it is fitted to the 1080x1920 frame.", 64, 4096, draft=True),
    Setting("local_visual_reuse_cached_still", "bool", False, "Visuals", _CLIP,
            "Reuse a still already in output/visuals/<episode>/ and make no image request."),
    Setting("visual_timeout_seconds", "float", None, "Visuals", _CLIP,
            "Timeout for one openrouter image request. Unset: visual_timeout, then llm_timeout_seconds, "
            "then the VISUAL_TIMEOUT_SECONDS or LLM_TIMEOUT_SECONDS environment variable, then 300 s.", 1, 3600),
    Setting("visual_timeout", "float", None, "Visuals", _CLIP,
            "Older name for visual_timeout_seconds, read after it.", 1, 3600),
    Setting("llm_timeout_seconds", "float", None, "Visuals", _CLIP,
            "Timeout for any hosted model request, read after the visual_timeout settings.", 1, 3600),
    Setting("llm_timeout", "float", None, "Visuals", _CLIP,
            "Older name for llm_timeout_seconds, read after it.", 1, 3600),
    Setting("brand_logo_enabled", "bool", True, "Visuals", _LOGO,
            "Put the show logo on clip backgrounds and thumbnails.", draft=True),
    Setting("brand_logo_path", "path", "assets/logo-short.png", "Visuals", _LOGO,
            "Logo file, relative to apps/pipeline.", draft=True),
    Setting("brand_logo_margin_px", "int", 48, "Visuals", _LOGO,
            "Gap between the logo and the edge of a clip.", 0, 540, draft=True),
    Setting("brand_logo_max_width_fraction", "float", 0.38, "Visuals", _LOGO,
            "Widest the logo may be, as a share of the clip's width.", 0.01, 1, draft=True),
    Setting("brand_logo_max_height_fraction", "float", 0.14, "Visuals", _LOGO,
            "Tallest the logo may be, as a share of the clip's height.", 0.01, 1, draft=True),

    Setting("thumbnail_enabled", "bool", True, "Thumbnail", _THUMBNAIL,
            "Run the thumbnail stage."),
    Setting("thumbnail_logo_max_width_fraction", "float", 0.22, "Thumbnail", _THUMBNAIL,
            "Widest the logo may be, as a share of the thumbnail's width.", 0.01, 1,
            fallback="brand_logo_max_width_fraction"),
    Setting("thumbnail_logo_max_height_fraction", "float", 0.12, "Thumbnail", _THUMBNAIL,
            "Tallest the logo may be, as a share of the thumbnail's height.", 0.01, 1,
            fallback="brand_logo_max_height_fraction"),
    Setting("thumbnail_logo_margin_px", "int", 40, "Thumbnail", _THUMBNAIL,
            "Gap between the logo and the edge of the thumbnail.", 0, 960,
            fallback="brand_logo_margin_px"),
    Setting("thumbnail_logo_position", "choice", "top_left", "Thumbnail", _THUMBNAIL,
            "Corner of the thumbnail that carries the logo.",
            choices=("top_left", "top_right", "bottom_left", "bottom_right")),

    Setting("visual_style_suffix", "text",
            "Vertical 9:16 cinematic poster art, bold contrast, dramatic composition. "
            "Purely visual scene: no text, letters, numbers, typography, logos, captions, "
            "titles, watermarks, fake UI, or media player chrome. Subtitles are added separately.",
            "Prompts", _CLIP,
            "House style added after each clip's image prompt.", draft=True),

    Setting("cowork_outputs_dir", "path", None, "Cowork instructions", _COWORK,
            "Folder Cowork writes its files to, relative to the data directory. Unset: <output_dir>/cowork."),
    Setting("cowork_headless", "bool", False, "Cowork instructions", _COWORK,
            "Start the Cowork hand-off from the pipeline with the Claude Code CLI instead of stopping with exit 75."),
    Setting("cowork_headless_timeout_seconds", "float", 3600.0, "Cowork instructions", _COWORK,
            "Longest a headless Cowork session may run before it is stopped.", 1, 86400),
    Setting("cowork_headless_model", "str", None, "Cowork instructions", _COWORK,
            "Model for the headless session. Unset: the CLI's default."),
    Setting("cowork_headless_command", "path", "claude", "Cowork instructions", _COWORK,
            "The Claude Code CLI that runs the headless session, found on PATH."),
    Setting("cowork_laughter_hints", "bool", True, "Cowork instructions", _COWORK,
            "Before the hand-off, listen to the episode for laughter and give Cowork the times "
            "(output/laughter/<stem>.laughter.json). About 15 s and 8 GB of memory for a two-hour episode."),
)

BY_KEY: Dict[str, Setting] = {setting.key: setting for setting in SETTINGS}


def default(key: str) -> Any:
    return BY_KEY[key].default


def source(settings: Mapping[str, Any], key: str) -> str:
    """Where ``value`` comes from: ``config``, the name of a fallback setting, or ``default``."""
    setting = BY_KEY[key]
    if key in settings:
        return "config"
    if setting.fallback and setting.fallback in settings:
        return setting.fallback
    return "default"


def value(settings: Mapping[str, Any], key: str) -> Any:
    """The value a stage uses for ``key``: config.json, then its fallback setting, then the default."""
    origin = source(settings, key)
    if origin == "default":
        return BY_KEY[key].default
    return settings[key if origin == "config" else origin]


def _show(number: float) -> str:
    return str(int(number)) if float(number).is_integer() else str(number)


def problems(key: str, candidate: Any) -> List[str]:
    """Why ``candidate`` is not an acceptable value for ``key`` (empty when it is)."""
    setting = BY_KEY.get(key)
    if setting is None:
        return [f"{key} is not a known setting"]
    if candidate is None and setting.default is None:
        return []  # unset is the default
    is_number = isinstance(candidate, (int, float)) and not isinstance(candidate, bool)
    if setting.type == "bool":
        return [] if isinstance(candidate, bool) else [f"{key} must be true or false, not {candidate!r}"]
    if setting.type == "choice":
        if candidate in setting.choices:
            return []
        return [f"{key} must be one of {', '.join(setting.choices)}, not {candidate!r}"]
    if setting.type in ("str", "text", "path"):
        if not isinstance(candidate, str):
            return [f"{key} must be text, not {candidate!r}"]
        if setting.pattern and not re.fullmatch(setting.pattern, candidate):
            return [f"{key} must be {setting.pattern_words}, not {candidate!r}"]
        return []
    if setting.type == "int":
        if not isinstance(candidate, int) or isinstance(candidate, bool):
            return [f"{key} must be a whole number, not {candidate!r}"]
    elif not is_number or not math.isfinite(candidate):
        return [f"{key} must be a number, not {candidate!r}"]
    low, high = setting.minimum, setting.maximum
    if (low is not None and candidate < low) or (high is not None and candidate > high):
        return [f"{key} must be between {_show(low)} and {_show(high)}, not {candidate!r}"]
    return []


def config_check(settings: Mapping[str, Any]) -> Dict[str, Any]:
    """How ``config.json``'s settings differ from what the code reads."""
    invalid = [
        {"key": key, "problems": problems(key, settings[key])}
        for key in sorted(settings) if key in BY_KEY and problems(key, settings[key])
    ]
    return {
        "notInConfig": sorted(s.key for s in SETTINGS if s.stages and s.key not in settings),
        "unread": sorted(key for key in settings if key in BY_KEY and not BY_KEY[key].stages),
        "undeclared": sorted(key for key in settings if key not in BY_KEY),
        "invalid": invalid,
    }
