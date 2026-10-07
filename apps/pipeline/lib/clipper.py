"""Clipper stage – renders vertical video clips using locally generated stills plus ffmpeg animation/subtitles."""
from __future__ import annotations

import json
import logging
import math
import os
import shlex
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from functools import lru_cache
from typing import Any, Dict, List, cast

from PIL import Image

from lib.visual_prompts import (
    ABSTRACT_VISUAL_GUARDRAIL,
    normalize_clip_image_prompt,
    spoken_context_for_clip,
)

logger = logging.getLogger(__name__)

# Cached: whether this FFmpeg build includes libass (subtitles / ass video filters).
_ffmpeg_subtitles_filter_available: bool | None = None

VIDEO_WIDTH = 1080
VIDEO_HEIGHT = 1920
CLIP_FPS = 30  # Must match zoompan fps and ffmpeg -r for still→video clips
ZOOMPAN_WORK_SCALE = 4  # Higher working resolution reduces visible x/y stepping from zoompan integer crop math.
DEFAULT_AUDIO_FADE_OUT_SECONDS = 0.8
# Captions: at most CAPTION_MAX_LINES lines, measured in the caption font.
# Uppercase Arial Bold 84 px fits ~17-20 characters per line, but wide letters
# (M, W) need fewer, so the character cap alone does not guarantee two lines.
CAPTION_MAX_CHARS = 32
CAPTION_MAX_LINES = 2
CAPTION_FONT_PATH = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
CAPTION_FONT_SIZE = 84
# Usable line width: frame minus MarginL/R (80 each) minus the 4 px outline.
CAPTION_LINE_WIDTH = VIDEO_WIDTH - 2 * 80 - 2 * 4
# A pause longer than this between words starts a new caption.
CAPTION_PAUSE_SECONDS = 0.5
# Parakeet sometimes stretches a word over following music; cap how long a word shows.
CAPTION_MAX_WORD_SECONDS = 1.5
# Hold a caption until the next one when the gap is shorter than this.
CAPTION_BRIDGE_SECONDS = 0.3
_CAPTION_BREAK_AFTER = (".", "!", "?")


def _pipeline_root() -> Path:
    """Directory containing ``pipeline.py`` / ``config.json`` (parent of ``lib``)."""
    return Path(__file__).resolve().parent.parent


def _apply_brand_logo(vertical_path: Path, config: Dict[str, Any]) -> Path:
    """Composite the podcast logo onto the cropped vertical still (bottom-right).

    Writes ``{stem}_logo.png`` next to the vertical crop so we never stack the logo
    twice on re-runs (always composite from the clean ``*_vertical.png``).

    Returns ``vertical_path`` unchanged if branding is disabled or the logo file is missing.
    """
    settings = config.get("settings", {})
    if not settings.get("brand_logo_enabled", True):
        return vertical_path
    rel = settings.get("brand_logo_path", "assets/logo-short.png")
    logo_path = (_pipeline_root() / rel).expanduser().resolve()
    if not logo_path.is_file():
        logger.info("Brand logo not found at %s, skipping overlay", logo_path)
        return vertical_path

    margin = int(settings.get("brand_logo_margin_px", 48))
    max_w = int(VIDEO_WIDTH * float(settings.get("brand_logo_max_width_fraction", 0.38)))
    max_h = int(VIDEO_HEIGHT * float(settings.get("brand_logo_max_height_fraction", 0.14)))

    out_path = vertical_path.with_name(f"{vertical_path.stem}_logo{vertical_path.suffix}")

    with Image.open(vertical_path) as base_im:
        base = base_im.convert("RGBA")
    with Image.open(logo_path) as logo_im:
        logo = logo_im.convert("RGBA")
    lw, lh = logo.size
    if lw < 1 or lh < 1:
        logger.warning("Brand logo has invalid size, skipping overlay")
        return vertical_path
    scale = min(max_w / lw, max_h / lh, 1.0)
    new_w = max(1, int(lw * scale))
    new_h = max(1, int(lh * scale))
    logo = logo.resize((new_w, new_h), Image.Resampling.LANCZOS)

    x = VIDEO_WIDTH - new_w - margin
    y = VIDEO_HEIGHT - new_h - margin
    x = max(0, x)
    y = max(0, y)

    base.paste(logo, (x, y), logo)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    base.convert("RGB").save(out_path, format="PNG", optimize=True)
    logger.info("Wrote branded still: %s", out_path.name)
    return out_path
DEFAULT_STYLE_SUFFIX = (
    "Vertical 9:16 cinematic poster art, bold contrast, dramatic composition. "
    "Purely visual scene: no text, letters, numbers, typography, logos, captions, "
    "titles, watermarks, fake UI, or media player chrome. Subtitles are added separately."
)


def _slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "clip"


def _build_visual_prompt(
    clip: Dict[str, Any],
    style_suffix: str = DEFAULT_STYLE_SUFFIX,
    spoken_context: str = "",
) -> str:
    """Build a content-led still-image prompt plus the house style.

    Headlines and summaries are omitted: they often contain episode titles or hooks
    that image models render as baked-in text. A transcript excerpt is used only when
    the stored image prompt is missing or defaults to generic podcast imagery.
    """
    base = normalize_clip_image_prompt(clip, spoken_context)
    parts = [base]
    if style_suffix:
        parts.append(style_suffix.strip())
    # This guardrail is always applied, even when config overrides the house style.
    parts.append(ABSTRACT_VISUAL_GUARDRAIL)
    return " ".join(part.rstrip(". ") + "." for part in parts if part).strip()


def _select_clip_segments(segments: List[Dict[str, Any]], start: float, end: float) -> List[Dict[str, Any]]:
    selected: List[Dict[str, Any]] = []
    for segment in segments:
        seg_start = float(segment.get("start", 0.0))
        seg_end = float(segment.get("end", 0.0))
        if seg_end <= start or seg_start >= end:
            continue
        selected.append(
            {
                "start": max(start, seg_start),
                "end": min(end, seg_end),
                "text": segment.get("text", ""),
            }
        )
    return selected


def _ass_timestamp(seconds: float) -> str:
    total_centiseconds = max(int(round(seconds * 100)), 0)
    hours, remainder = divmod(total_centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    secs, centis = divmod(remainder, 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def _ass_escape(text: str) -> str:
    return (
        text.replace("\\", r"\\")
        .replace("{", r"\{")
        .replace("}", r"\}")
        .replace("\n", r"\N")
        .upper()
        .strip()
    )


def _estimate_words(segment: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Spread a segment's words over its time span in proportion to their length."""
    tokens = str(segment.get("text", "")).split()
    seg_start = float(segment.get("start", 0.0))
    seg_end = max(float(segment.get("end", seg_start)), seg_start)
    total = sum(len(token) + 1 for token in tokens)
    words: List[Dict[str, Any]] = []
    position = 0
    for token in tokens:
        word_start = seg_start + (seg_end - seg_start) * position / total
        position += len(token) + 1
        word_end = seg_start + (seg_end - seg_start) * position / total
        words.append({"start": word_start, "end": word_end, "text": token})
    return words


def _caption_words(segments: List[Dict[str, Any]], start: float, end: float) -> List[Dict[str, Any]]:
    """Return the words spoken inside [start, end], using stored word timings when present."""
    words: List[Dict[str, Any]] = []
    for segment in segments:
        if float(segment.get("end", 0.0)) <= start or float(segment.get("start", 0.0)) >= end:
            continue
        timed = bool(segment.get("words"))
        for word in segment.get("words") or _estimate_words(segment):
            word_start, word_end = float(word["start"]), float(word["end"])
            if timed:
                word_end = min(word_end, word_start + CAPTION_MAX_WORD_SECONDS)
            text = str(word.get("text", "")).strip()
            if text and word_end > start and word_start < end:
                words.append({"start": max(word_start, start), "end": min(word_end, end), "text": text})
    return words


@lru_cache(maxsize=1)
def _caption_font() -> Any:
    from PIL import ImageFont

    try:
        probe = ImageFont.truetype(CAPTION_FONT_PATH, 100)
    except OSError:
        logger.info("Caption font %s not found; limiting captions by character count", CAPTION_FONT_PATH)
        return None
    ascent, descent = probe.getmetrics()
    # libass sizes fonts by ascent + descent rather than the em square.
    return ImageFont.truetype(CAPTION_FONT_PATH, round(CAPTION_FONT_SIZE * 100 / (ascent + descent)))


def _caption_fits(text: str) -> bool:
    """True when *text* renders within CAPTION_MAX_LINES lines of the caption font."""
    if len(text) > CAPTION_MAX_CHARS:
        return False
    font = _caption_font()
    if font is None:
        return True
    shown = text.upper()
    lines = 1
    line = ""
    for word in shown.split():
        candidate = f"{line} {word}".strip()
        if line and font.getlength(candidate) > CAPTION_LINE_WIDTH:
            lines += 1
            line = word
        else:
            line = candidate
        if font.getlength(line) > CAPTION_LINE_WIDTH:
            return False
    return lines <= CAPTION_MAX_LINES


def _caption_chunks(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group words into short captions, breaking on punctuation, pauses and length."""
    chunks: List[Dict[str, Any]] = []
    current: List[Dict[str, Any]] = []

    def flush() -> None:
        if current:
            chunks.append({
                "start": current[0]["start"],
                "end": current[-1]["end"],
                "text": " ".join(w["text"] for w in current),
            })
            current.clear()

    for word in words:
        if current:
            too_long = not _caption_fits(" ".join(w["text"] for w in current + [word]))
            paused = word["start"] - current[-1]["end"] > CAPTION_PAUSE_SECONDS
            if too_long or paused:
                flush()
        current.append(word)
        if word["text"].endswith(_CAPTION_BREAK_AFTER):
            flush()
    flush()

    for caption, following in zip(chunks, chunks[1:]):
        if 0 < following["start"] - caption["end"] < CAPTION_BRIDGE_SECONDS:
            caption["end"] = following["start"]
    return chunks


def _build_ass_subtitles(segments: List[Dict[str, Any]], start: float, end: float) -> str:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {VIDEO_WIDTH}
PlayResY: {VIDEO_HEIGHT}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Caption,Arial Bold,84,&H0000FFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,0,2,80,80,220,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
"""
    lines: List[str] = [header]
    captions = _caption_chunks(_caption_words(segments, start, end))
    if not captions:
        return header
    for caption in captions:
        text = _ass_escape(caption["text"])
        if not text:
            continue
        rel_start = float(caption["start"]) - start
        rel_end = float(caption["end"]) - start
        lines.append(
            f"Dialogue: 0,{_ass_timestamp(rel_start)},{_ass_timestamp(rel_end)},Caption,,0,0,0,,{text}"
        )
    return "\n".join(lines)


def _prepare_vertical_background(image_path: Path) -> Path:
    prepared_path = image_path.with_name(f"{image_path.stem}_vertical.png")
    # A regenerated still is newer than its cached crop.
    if prepared_path.exists() and prepared_path.stat().st_mtime >= image_path.stat().st_mtime:
        return prepared_path
    with Image.open(image_path) as base:
        bw, bh = base.size
        scale = max(VIDEO_WIDTH / bw, VIDEO_HEIGHT / bh)
        new_w, new_h = int(bw * scale), int(bh * scale)
        resized = base.resize((new_w, new_h), Image.Resampling.LANCZOS)
        left = max((new_w - VIDEO_WIDTH) // 2, 0)
        top = max((new_h - VIDEO_HEIGHT) // 2, 0)
        cropped = resized.crop((left, top, left + VIDEO_WIDTH, top + VIDEO_HEIGHT))
        cropped.save(prepared_path)
    return prepared_path


def _generate_background_image_local(prompt: str, path: Path, config: Dict[str, Any]) -> bool:
    settings = config.get("settings", {})
    script_path = Path(settings.get("local_visual_script", "./scripts/generate_local_visual.py")).expanduser().resolve()
    model_name = settings.get("local_visual_model", "stabilityai/sdxl-turbo")
    steps = str(settings.get("local_visual_steps", 8))
    seed = str(settings.get("local_visual_seed", 42))
    if not script_path.is_file():
        logger.error("Local visual generation script not found: %s", script_path)
        return False
    # Use the same interpreter as the pipeline so venv deps (torch, diffusers) are available.
    # Bare `python` on PATH often lacks them and the script falls back to a placeholder PNG.
    override = settings.get("local_visual_python")
    if override:
        override_path = Path(str(override)).expanduser()
        python_exe = str(override_path.resolve()) if override_path.is_file() else str(override)
    else:
        python_exe = sys.executable
    lw = int(settings.get("local_visual_width", VIDEO_WIDTH))
    lh = int(settings.get("local_visual_height", VIDEO_HEIGHT))
    cmd = [
        python_exe,
        str(script_path),
        "--prompt",
        prompt,
        "--output",
        str(path),
        "--model",
        model_name,
        "--width",
        str(lw),
        "--height",
        str(lh),
        "--steps",
        steps,
        "--seed",
        seed,
    ]
    logger.info("Generating local visual via: %s", shlex.join(cmd))
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        if result.stderr and result.stderr.strip():
            logger.warning("generate_local_visual stderr: %s", result.stderr.strip())
        return path.exists()
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or exc.stdout or "").strip()
        logger.error("Local visual generation failed: %s", err or exc)
        if err:
            print(f"  {err}")
        return False


def _extract_openai_image_bytes(response: Any) -> bytes | None:
    """Pull raw image bytes from an OpenAI images.generate response."""
    data_items = getattr(response, "data", None) or []
    for item in data_items:
        b64_json = getattr(item, "b64_json", None)
        if b64_json:
            import base64

            return base64.b64decode(b64_json)
        url = getattr(item, "url", None)
        if url:
            try:
                with urllib.request.urlopen(url, timeout=120) as resp:
                    return resp.read()
            except Exception as exc:
                logger.error("Failed to download OpenAI image from URL: %s", exc)
    return None


def _response_value(value: Any, key: str) -> Any:
    """Read an OpenAI-compatible response field from an object or mapping."""
    if isinstance(value, dict):
        return value.get(key)
    return getattr(value, key, None)


def _extract_openrouter_image_bytes(response: Any) -> bytes | None:
    """Extract the first image returned by OpenRouter chat completions.

    OpenRouter image models return generated images under
    ``choices[0].message.images[*].image_url.url``. The URL is normally a data
    URL. Remote URLs are deliberately rejected: following a provider-returned URL
    would turn the clip worker into an SSRF-capable HTTP client.
    """
    choices = _response_value(response, "choices") or []
    for choice in choices:
        message = _response_value(choice, "message")
        images = _response_value(message, "images") or []
        for image in images:
            image_url = _response_value(image, "image_url")
            url = _response_value(image_url, "url")
            if not isinstance(url, str) or not url:
                continue
            if url.startswith("data:"):
                marker = ";base64,"
                if marker not in url:
                    logger.error("OpenRouter returned an unsupported image data URL")
                    continue
                try:
                    import base64

                    return base64.b64decode(url.split(marker, 1)[1], validate=True)
                except ValueError as exc:
                    logger.error("OpenRouter returned invalid base64 image data: %s", exc)
                    continue
            logger.error("OpenRouter returned a remote image URL; refusing to fetch it")
    return None


def _generate_background_image_openai(prompt: str, path: Path, config: Dict[str, Any]) -> bool:
    """Hosted images via OpenAI image generation."""
    try:
        from openai import BadRequestError, OpenAI
    except ImportError as exc:
        logger.error("OpenAI visuals require openai: %s", exc)
        return False

    from lib.runtime_config import get_openai_api_key, get_openai_base_url

    settings = config.get("settings", {})
    model = settings.get("openai_visual_model", "gpt-image-1")
    size = settings.get("openai_image_size", "1024x1536")
    quality = settings.get("openai_image_quality", "high")

    try:
        client_kwargs: Dict[str, Any] = {"api_key": get_openai_api_key()}
        base_url = get_openai_base_url()
        if base_url:
            client_kwargs["base_url"] = base_url
        client = OpenAI(**client_kwargs)
        request_kwargs: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "size": size,
            "quality": quality,
        }
        retry_order = ["quality", "size"]
        while True:
            try:
                response = client.images.generate(**request_kwargs)
                break
            except BadRequestError as exc:
                message = str(exc)
                removed = False
                for field in retry_order:
                    if f"Unknown parameter: '{field}'" in message and field in request_kwargs:
                        logger.warning(
                            "OpenAI image API rejected '%s'; retrying without it",
                            field,
                        )
                        request_kwargs.pop(field, None)
                        removed = True
                        break
                if not removed:
                    raise
    except Exception as exc:
        logger.error("OpenAI image generation failed: %s", exc)
        print(f"  OpenAI image error: {exc}")
        return False

    raw = _extract_openai_image_bytes(response)
    if not raw:
        logger.error("OpenAI returned no image data for model %s", model)
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path.exists()


def _generate_background_image_openrouter(prompt: str, path: Path, config: Dict[str, Any]) -> bool:
    """Hosted images through OpenRouter's OpenAI-compatible chat API."""
    try:
        from openai import OpenAI
    except ImportError as exc:
        logger.error("OpenRouter visuals require openai: %s", exc)
        return False

    from lib.runtime_config import (
        get_openrouter_api_key,
        get_openrouter_api_url,
        resolve_llm_request_timeout,
    )

    settings = config.get("settings", {})
    model = settings.get("openrouter_visual_model", "google/gemini-3.1-flash-image")
    try:
        client = OpenAI(
            base_url=get_openrouter_api_url(),
            api_key=get_openrouter_api_key(),
            timeout=resolve_llm_request_timeout(settings, operation="visual"),
        )
        response = client.chat.completions.create(
            model=model,
            # The SDK's type stubs lag OpenRouter's image modality support.
            modalities=cast(Any, ["image", "text"]),
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        logger.error("OpenRouter image generation failed: %s", exc)
        print(f"  OpenRouter image error: {exc}")
        return False

    raw = _extract_openrouter_image_bytes(response)
    if not raw:
        logger.error("OpenRouter returned no image data for model %s", model)
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path.exists()


def _generate_background_image(prompt: str, provider: str, path: Path, config: Dict[str, Any]) -> bool:
    if provider == "local":
        return _generate_background_image_local(prompt, path, config)
    if provider == "openai":
        return _generate_background_image_openai(prompt, path, config)
    if provider == "openrouter":
        return _generate_background_image_openrouter(prompt, path, config)
    logger.error(
        "Unsupported visuals provider '%s'. Use 'local', 'openai', or 'openrouter'.",
        provider,
    )
    return False


def _write_ass_subtitles(path: Path, segments: List[Dict[str, Any]], start: float, end: float) -> None:
    path.write_text(_build_ass_subtitles(segments, start, end), encoding="utf-8")


def _ffmpeg_has_subtitles_filter() -> bool:
    """True if FFmpeg was built with libass (subtitles filter). Homebrew `ffmpeg` does not; use `ffmpeg-full`."""
    global _ffmpeg_subtitles_filter_available
    if _ffmpeg_subtitles_filter_available is not None:
        return _ffmpeg_subtitles_filter_available
    try:
        proc = subprocess.run(
            ["ffmpeg", "-h", "filter=subtitles"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        _ffmpeg_subtitles_filter_available = False
        return False
    combined = (proc.stdout or "") + (proc.stderr or "")
    _ffmpeg_subtitles_filter_available = "Unknown filter" not in combined
    return _ffmpeg_subtitles_filter_available


def _escape_subtitle_path_for_filter(path: Path) -> str:
    """Escape path for subtitles= / ass= in a -vf filtergraph (see ffmpeg-utils escaping)."""
    return str(path).replace("\\", r"\\").replace(":", r"\:").replace("'", r"\'")


def _build_zoompan_filter(duration: float, subtitle_path: Path | None) -> str:
    """Ken Burns zoom: slow push from 1.0→1.12 across the *whole* clip.

    The old expression ``min(zoom+0.0008, 1.12)`` hit the cap in 150 frames (~5s at
    30fps). Driving zoom from output frame index ``on`` keeps motion visible for
    the full ``d`` frames (``duration * CLIP_FPS``).
    """
    total_frames = max(int(duration * CLIP_FPS), 1)
    denom = max(total_frames - 1, 1)
    # Linear zoom in from 1.00 -> 1.12 over the clip.
    z_expr = f"1+0.12*on/{denom}"
    # zoompan crop coordinates move in integer pixels. Running at higher working
    # resolution makes those crop steps much smaller once resampled back down.
    work_w = VIDEO_WIDTH * ZOOMPAN_WORK_SCALE
    work_h = VIDEO_HEIGHT * ZOOMPAN_WORK_SCALE
    zoom = (
        f"scale={work_w}:{work_h}:flags=lanczos,"
        f"zoompan=z='{z_expr}':"
        f"x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':"
        f"d={total_frames}:s={VIDEO_WIDTH}x{VIDEO_HEIGHT}:fps={CLIP_FPS}"
    )
    if subtitle_path is None:
        return zoom
    sub = _escape_subtitle_path_for_filter(subtitle_path)
    # subtitles= is the standard libass filter; shorthand matches ffmpeg docs (subtitles=file.ass).
    return f"{zoom},subtitles={sub}"


def _build_audio_fade_filter(duration: float, fade_out_seconds: float) -> str | None:
    """Build an audio fade that ends exactly with the clip."""
    fade_duration = min(max(float(fade_out_seconds), 0.0), max(float(duration), 0.0))
    if fade_duration <= 0.0:
        return None
    fade_start = max(float(duration) - fade_duration, 0.0)
    return f"afade=t=out:st={fade_start:.3f}:d={fade_duration:.3f}"


def _resolve_audio_fade_out_seconds(value: Any) -> float:
    """Return a finite non-negative fade duration from an optional config value."""
    try:
        fade_out_seconds = float(value)
    except (TypeError, ValueError):
        logger.warning(
            "Invalid clip_audio_fade_out_seconds=%r; using default %.1fs",
            value,
            DEFAULT_AUDIO_FADE_OUT_SECONDS,
        )
        return DEFAULT_AUDIO_FADE_OUT_SECONDS
    if not math.isfinite(fade_out_seconds):
        logger.warning(
            "Non-finite clip_audio_fade_out_seconds=%r; using default %.1fs",
            value,
            DEFAULT_AUDIO_FADE_OUT_SECONDS,
        )
        return DEFAULT_AUDIO_FADE_OUT_SECONDS
    return max(fade_out_seconds, 0.0)


def _render_clip_video(
    background_path: Path,
    subtitle_path: Path,
    episode_audio: str,
    clip_output: Path,
    start: float,
    end: float,
    burn_subtitles: bool,
    audio_fade_out_seconds: float = DEFAULT_AUDIO_FADE_OUT_SECONDS,
) -> None:
    duration = end - start
    filtergraph = _build_zoompan_filter(duration, subtitle_path if burn_subtitles else None)
    audio_filter = _build_audio_fade_filter(duration, audio_fade_out_seconds)
    cmd = [
        "ffmpeg",
        "-y",
        "-loop",
        "1",
        "-i",
        str(background_path),
        "-ss",
        str(start),
        "-t",
        str(duration),
        "-i",
        episode_audio,
        "-vf",
        filtergraph,
        "-r",
        str(CLIP_FPS),
    ]
    if audio_filter:
        cmd.extend(["-af", audio_filter])
    cmd.extend([
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        str(clip_output),
    ])
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def run(context: dict) -> None:
    config = context.get("config", {})
    seo_path = context.get("seo_path")
    if not seo_path:
        episode_path = Path(context.get("episode_path", ""))
        seo_dir = Path(config.get("paths", {}).get("output_dir", "./output")) / "seo"
        seo_path = seo_dir / f"{episode_path.stem}.seo.json"

    seo_file = Path(seo_path)
    if not seo_file.is_file():
        print(f"Skipping clips: SEO file not found at {seo_path}")
        return

    seo_data = _load_json(seo_file)
    clips_data = seo_data.get("clipAnalysis") or []
    if not clips_data:
        print(f"No clipAnalysis found in {seo_path}")
        return

    MIN_CLIP_DURATION = float(config.get("settings", {}).get("min_clip_duration_seconds", 20.0))

    transcript_path = Path(context.get("transcript_path", ""))
    segments = _load_json(transcript_path) if transcript_path.is_file() else []

    episode_stem = Path(context["episode_path"]).stem
    output_root = Path(config.get("paths", {}).get("output_dir", "./output"))
    output_dir = output_root / "clips" / episode_stem
    output_dir.mkdir(parents=True, exist_ok=True)

    visuals_dir = output_root / "visuals" / episode_stem
    visuals_dir.mkdir(parents=True, exist_ok=True)

    visuals_provider = config.get("settings", {}).get("visuals_provider", "local")
    style_suffix = config.get("settings", {}).get("visual_style_suffix", DEFAULT_STYLE_SUFFIX)
    audio_fade_out_seconds = _resolve_audio_fade_out_seconds(
        config.get("settings", {}).get(
            "clip_audio_fade_out_seconds", DEFAULT_AUDIO_FADE_OUT_SECONDS
        )
    )
    episode_audio = context.get("episode_audio") or context.get("episode_path")

    burn_subtitles = _ffmpeg_has_subtitles_filter()
    if not burn_subtitles:
        print(
            "  FFmpeg has no subtitles filter (needs libass). "
            "Clips will render without burned captions. "
            "On Homebrew: `brew install ffmpeg-full` and use that binary on PATH."
        )

    # Filter out clips shorter than the minimum duration
    valid_clips: List[Dict[str, Any]] = []
    skipped_count = 0
    for clip in clips_data:
        start = clip.get("start")
        end = clip.get("end")
        if start is None or end is None or float(end) <= float(start):
            continue
        if float(end) - float(start) < MIN_CLIP_DURATION:
            headline = clip.get("headline", "unknown")
            duration = float(end) - float(start)
            print(f"  Skipping clip '{headline}' ({duration:.1f}s < {MIN_CLIP_DURATION:.0f}s minimum)")
            skipped_count += 1
            continue
        valid_clips.append(clip)
    
    if skipped_count:
        print(f"  {skipped_count} clip(s) skipped for being under {int(MIN_CLIP_DURATION)}s")

    if not valid_clips:
        print(f"No valid clips (all under {int(MIN_CLIP_DURATION)}s minimum)")
        return

    for index, clip in enumerate(valid_clips, start=1):
        start = float(clip.get("start"))
        end = float(clip.get("end"))

        clip_slug = _slugify(clip.get("headline") or f"clip-{index:02d}")
        clip_name = f"{index:02d}-{clip_slug}"
        clip_output = output_dir / f"{clip_name}.mp4"
        if clip_output.exists():
            print(f"Clip {clip_name} already exists, skipping.")
            continue

        spoken_context = spoken_context_for_clip(segments, start, end)
        prompt = _build_visual_prompt(
            clip,
            style_suffix=style_suffix,
            spoken_context=spoken_context,
        )
        image_path = visuals_dir / f"{clip_name}.png"
        subtitle_path = visuals_dir / f"{clip_name}.ass"

        print(f"Generating clip {index}/{len(valid_clips)}: {clip.get('headline', clip_name)}")

        reuse_still = bool(config.get("settings", {}).get("local_visual_reuse_cached_still", False))
        if reuse_still and image_path.exists():
            print(f"  Reusing cached still {image_path.name}")
        else:
            success = _generate_background_image(prompt, visuals_provider, image_path, config)
            if not success:
                print(f"  Visual generation failed for {clip_name}")
                continue

        prepared_bg = _prepare_vertical_background(image_path)
        clip_still = _apply_brand_logo(prepared_bg, config)
        _write_ass_subtitles(subtitle_path, segments, start, end)

        try:
            _render_clip_video(
                clip_still,
                subtitle_path,
                str(episode_audio),
                clip_output,
                start,
                end,
                burn_subtitles,
                audio_fade_out_seconds,
            )
            print(f"  Clip saved: {clip_output}")
        except subprocess.CalledProcessError as exc:
            print(f"  FFMPEG failed for {clip_name}: {exc.stderr or exc.stdout}")

    print(f"All clips for {episode_stem} processed.")
