"""Thumbnail stage — generates episode thumbnails by compositing movie posters + BBPC logo.

Fetches poster URLs from the Movie table for each reviewed movie, downloads them,
and composites a 1920x1080 thumbnail with the BBPC logo overlaid.
"""
from __future__ import annotations

import json
import logging
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from lib.convex_client import ConvexPipelineClient

logger = logging.getLogger(__name__)

THUMB_WIDTH = 1920
THUMB_HEIGHT = 1920
BG_COLOR = (12, 12, 18)
POSTER_SPACING = 20
POSTER_BOTTOM_MARGIN = 140  # clears the title bar
LOGO_MAX_WIDTH_FRAC = 0.22
LOGO_MAX_HEIGHT_FRAC = 0.12
LOGO_MARGIN = 40
LOGO_POSITION = "top_left"
LOGO_POSITIONS = frozenset({"top_left", "top_right", "bottom_left", "bottom_right"})
CORNER_RADIUS = 16
SHADOW_OFFSET = 6
SHADOW_BLUR = 18
SHADOW_ALPHA = 160


def _pipeline_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _fetch_movie_posters(
    movie_ids: List[str],
    client: ConvexPipelineClient | None = None,
) -> Dict[str, str]:
    """Query Convex for poster URLs by a bounded movie ID list.

    Returns {movie_id: poster_url} for records that have a non-empty poster.
    """
    if not movie_ids:
        return {}
    try:
        convex = client or ConvexPipelineClient.from_environment()
        return convex.get_movie_posters(movie_ids)
    except Exception as exc:
        logger.warning("Thumbnail: Convex poster lookup failed: %s", exc)
        return {}


def _download_image(url: str, timeout: int = 30) -> Optional[Image.Image]:
    """Download an image from a URL and return a PIL Image."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "bbpc-pipeline/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = resp.read()
        from io import BytesIO

        return Image.open(BytesIO(data)).convert("RGBA")
    except Exception as exc:
        logger.warning("Thumbnail: failed to download %s: %s", url, exc)
        return None


def _rounded_rect_mask(size: Tuple[int, int], radius: int) -> Image.Image:
    """Create a grayscale mask with anti-aliased rounded corners."""
    scale = 4  # supersample; ImageDraw does not anti-alias
    mask = Image.new("L", (size[0] * scale, size[1] * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0] * scale - 1, size[1] * scale - 1), radius=radius * scale, fill=255)
    return mask.resize(size, Image.Resampling.LANCZOS)


def _add_drop_shadow(
    img: Image.Image, offset: int = SHADOW_OFFSET, blur: int = SHADOW_BLUR, alpha: int = SHADOW_ALPHA
) -> Image.Image:
    """Return a new image with the input composited onto a larger canvas with a drop shadow."""
    w, h = img.size
    canvas_size = (w + offset + blur * 2, h + offset + blur * 2)
    corner_mask = _rounded_rect_mask((w, h), CORNER_RADIUS)

    # Blur on the full canvas so the shadow's soft edge is not clipped.
    shadow_mask = Image.new("L", canvas_size, 0)
    shadow_mask.paste(corner_mask.point(lambda v: v * alpha // 255), (blur + offset, blur + offset))
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(blur))
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    canvas.putalpha(shadow_mask)

    rounded = img.copy()
    rounded.putalpha(ImageChops.multiply(img.getchannel("A"), corner_mask))
    canvas.alpha_composite(rounded, (blur, blur))
    return canvas


def _balanced_rows(count: int, rows: int) -> List[int]:
    """Split *count* posters into *rows* rows, putting any extra in the top rows."""
    base, extra = divmod(count, rows)
    return [base + (1 if i < extra else 0) for i in range(rows)]


def _choose_grid(
    ratios: List[float],
    avail_w: int,
    avail_h: int,
    spacing: int,
) -> Tuple[List[int], int]:
    """Pick the row split that yields the tallest uniform poster height.

    Like a centred flex-wrap: every row shares one height, each row must fit
    the width, and the stacked rows must fit the height.
    """
    best_rows: List[int] = [len(ratios)]
    best_h = 0
    for row_count in range(1, len(ratios) + 1):
        rows = _balanced_rows(len(ratios), row_count)
        height_limit = (avail_h - spacing * (row_count - 1)) / row_count
        idx = 0
        width_limit = float("inf")
        for size in rows:
            row_ratio = sum(ratios[idx:idx + size])
            width_limit = min(width_limit, (avail_w - spacing * (size + 1)) / max(row_ratio, 1e-6))
            idx += size
        h = int(min(height_limit, width_limit))
        # Strictly greater keeps the fewest rows on ties.
        if h > best_h:
            best_rows, best_h = rows, h
    return best_rows, best_h


def _layout_posters(
    posters: List[Image.Image],
    canvas_w: int,
    canvas_h: int,
    spacing: int = POSTER_SPACING,
    bottom_margin: int = POSTER_BOTTOM_MARGIN,
    top_margin: int = POSTER_SPACING,
) -> Tuple[Image.Image, List[Tuple[int, int]]]:
    """Arrange posters in centred rows, choosing the row count that maximises size.

    Posters share a uniform height and keep their aspect ratio. The grid is
    centred vertically between *top_margin* and *bottom_margin*. Returns
    (composite_rgba, [(x, y), ...]) where the composite is the canvas-sized
    image with posters pasted.
    """
    if not posters:
        return Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0)), []

    ratios = [p.size[0] / max(p.size[1], 1) for p in posters]
    avail_h = canvas_h - top_margin - bottom_margin
    rows, target_h = _choose_grid(ratios, canvas_w, avail_h, spacing)
    target_h = max(target_h, 60)  # minimum height

    grid_h = target_h * len(rows) + spacing * (len(rows) - 1)
    y = top_margin + (avail_h - grid_h) // 2

    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    positions: List[Tuple[int, int]] = []
    idx = 0
    for size in rows:
        scaled = [
            p.resize((max(int(target_h * ratio), 1), target_h), Image.Resampling.LANCZOS)
            for p, ratio in zip(posters[idx:idx + size], ratios[idx:idx + size])
        ]
        idx += size
        row_w = sum(s.size[0] for s in scaled) + spacing * (len(scaled) - 1)
        x = (canvas_w - row_w) // 2
        for s in scaled:
            shadowed = _add_drop_shadow(s)
            # _add_drop_shadow places the poster SHADOW_BLUR px into its canvas.
            canvas.paste(shadowed, (x - SHADOW_BLUR, y - SHADOW_BLUR), shadowed)
            positions.append((x, y))
            x += s.size[0] + spacing
        y += target_h + spacing

    return canvas, positions


def _normalize_logo_position(position: str) -> str:
    normalized = position.lower().replace("-", "_").strip()
    if normalized in LOGO_POSITIONS:
        return normalized
    return LOGO_POSITION


def _logo_corner_position(
    canvas_w: int,
    canvas_h: int,
    logo_w: int,
    logo_h: int,
    margin: int,
    position: str,
) -> Tuple[int, int]:
    """Return (x, y) paste coordinates for a logo in one of the four corners."""
    corner = _normalize_logo_position(position)
    x = canvas_w - logo_w - margin if corner.endswith("right") else margin
    y = canvas_h - logo_h - margin if corner.startswith("bottom") else margin
    return max(0, x), max(0, y)


def _load_logo(config: Dict[str, Any]) -> Optional[Tuple[Image.Image, int, str]]:
    """Return (scaled_logo, margin, position), or None when no logo is drawn."""
    settings = config.get("settings", {})
    if not settings.get("brand_logo_enabled", True):
        return None

    rel = settings.get("brand_logo_path", "assets/logo-short.png")
    logo_path = (_pipeline_root() / rel).expanduser().resolve()
    if not logo_path.is_file():
        logger.info("Thumbnail: brand logo not found at %s, skipping", logo_path)
        return None

    max_w = int(
        THUMB_WIDTH
        * float(settings.get("thumbnail_logo_max_width_fraction", settings.get("brand_logo_max_width_fraction", LOGO_MAX_WIDTH_FRAC)))
    )
    max_h = int(
        THUMB_HEIGHT
        * float(settings.get("thumbnail_logo_max_height_fraction", settings.get("brand_logo_max_height_fraction", LOGO_MAX_HEIGHT_FRAC)))
    )
    margin = int(settings.get("thumbnail_logo_margin_px", settings.get("brand_logo_margin_px", LOGO_MARGIN)))
    position = settings.get("thumbnail_logo_position", LOGO_POSITION)

    with Image.open(logo_path) as logo_im:
        logo = logo_im.convert("RGBA")

    lw, lh = logo.size
    if lw < 1 or lh < 1:
        return None

    scale = min(max_w / lw, max_h / lh, 1.0)
    new_w = max(1, int(lw * scale))
    new_h = max(1, int(lh * scale))
    return logo.resize((new_w, new_h), Image.Resampling.LANCZOS), margin, position


def _poster_top_margin(config: Dict[str, Any]) -> int:
    """Keep posters below a top-corner logo."""
    loaded = _load_logo(config)
    if loaded is None:
        return POSTER_SPACING
    logo, margin, position = loaded
    if not _normalize_logo_position(position).startswith("top"):
        return POSTER_SPACING
    return margin + logo.size[1] + POSTER_SPACING


def _apply_logo(
    canvas: Image.Image,
    config: Dict[str, Any],
) -> Image.Image:
    """Composite the BBPC brand logo onto the canvas."""
    loaded = _load_logo(config)
    if loaded is None:
        return canvas
    logo, margin, position = loaded
    x, y = _logo_corner_position(THUMB_WIDTH, THUMB_HEIGHT, logo.size[0], logo.size[1], margin, position)
    canvas.paste(logo, (x, y), logo)
    return canvas


def _add_title_text(
    canvas: Image.Image,
    episode_title: str,
    movie_titles: List[str],
) -> Image.Image:
    """Add episode title and movie count text at the bottom of the canvas."""
    draw = ImageDraw.Draw(canvas)

    # Try to use a system font; fall back to default
    from PIL import ImageFont

    font_size = 36
    small_font_size = 24
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
        small_font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", small_font_size)
    except Exception:
        font = ImageFont.load_default()
        small_font = font

    # Episode title at bottom-left
    label = episode_title or ""
    if movie_titles:
        count_label = f"{len(movie_titles)} movie{'s' if len(movie_titles) > 1 else ''} reviewed"
    else:
        count_label = ""

    margin = LOGO_MARGIN
    y = THUMB_HEIGHT - margin - font_size - (small_font_size + 8 if count_label else 0)

    # Semi-transparent background bar for readability
    bar_h = font_size + (small_font_size + 8 if count_label else 0) + 20
    bar = Image.new("RGBA", (THUMB_WIDTH, bar_h), (0, 0, 0, 140))
    canvas.paste(bar, (0, y - 10), bar)

    draw = ImageDraw.Draw(canvas)
    if label:
        draw.text((margin, y), label, fill=(255, 255, 255), font=font)
        y += font_size + 8
    if count_label:
        draw.text((margin, y), count_label, fill=(200, 200, 200), font=small_font)

    return canvas


def generate_thumbnail(
    movie_ids: List[str],
    output_path: Path,
    config: Dict[str, Any],
    episode_title: str = "",
    movie_titles: Optional[List[str]] = None,
    convex_client: ConvexPipelineClient | None = None,
) -> bool:
    """Generate a 1920x1080 episode thumbnail.

    1. Fetches poster URLs from Convex for the given movie IDs.
    2. Downloads each poster image.
    3. Composites posters in centred rows (row count chosen to maximise size).
    4. Overlays the BBPC logo at top-left.
    5. Adds episode title text at the bottom.

    Returns True if the thumbnail was written successfully.
    """
    # Fetch poster URLs
    poster_map = _fetch_movie_posters(movie_ids, convex_client)
    if not poster_map:
        logger.warning("Thumbnail: no poster URLs found for %d movie(s)", len(movie_ids))
        # Still generate a text-only thumbnail
        canvas = Image.new("RGB", (THUMB_WIDTH, THUMB_HEIGHT), BG_COLOR)
        canvas_rgba = canvas.convert("RGBA")
        canvas_rgba = _apply_logo(canvas_rgba, config)
        canvas_rgba = _add_title_text(canvas_rgba, episode_title, movie_titles or [])
        canvas_rgba.convert("RGB").save(output_path, format="PNG", optimize=True)
        logger.info("Thumbnail: wrote text-only thumbnail to %s", output_path)
        return True

    # Download posters
    posters: List[Image.Image] = []
    for mid in movie_ids:
        url = poster_map.get(mid)
        if not url:
            continue
        img = _download_image(url)
        if img:
            posters.append(img)

    if not posters:
        logger.warning("Thumbnail: all poster downloads failed")
        canvas = Image.new("RGB", (THUMB_WIDTH, THUMB_HEIGHT), BG_COLOR)
        canvas_rgba = canvas.convert("RGBA")
        canvas_rgba = _apply_logo(canvas_rgba, config)
        canvas_rgba = _add_title_text(canvas_rgba, episode_title, movie_titles or [])
        canvas_rgba.convert("RGB").save(output_path, format="PNG", optimize=True)
        return True

    # Build canvas
    canvas = Image.new("RGBA", (THUMB_WIDTH, THUMB_HEIGHT), BG_COLOR + (255,))

    # Composite posters
    poster_layer, _ = _layout_posters(
        posters, THUMB_WIDTH, THUMB_HEIGHT, top_margin=_poster_top_margin(config)
    )
    canvas = Image.alpha_composite(canvas, poster_layer)

    # Logo overlay
    canvas = _apply_logo(canvas, config)

    # Title text
    canvas = _add_title_text(canvas, episode_title, movie_titles or [])

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(output_path, format="PNG", optimize=True)
    logger.info("Thumbnail: wrote %s (%d posters)", output_path.name, len(posters))
    return True


def run(context: dict) -> None:
    """Pipeline stage entry point.

    Expects context to contain:
      - config: pipeline config dict
      - episode_path: path to the episode audio file
      - movie_extraction_path: path to the movies JSON (optional, will be inferred)
      - db_episode: resolved episode dict with 'number' and 'title' (optional)
    """
    config = context.get("config", {})
    settings = config.get("settings", {})
    if not settings.get("thumbnail_enabled", True):
        print("Thumbnail stage disabled in config, skipping.")
        return

    episode_path = context.get("episode_path", "")
    stem = Path(episode_path).stem

    # Resolve movie extraction JSON
    movie_extraction_path = context.get("movie_extraction_path")
    if not movie_extraction_path:
        output_dir = Path(config.get("paths", {}).get("output_dir", "./output")).expanduser().resolve()
        movie_extraction_path = output_dir / "movies" / f"{stem}.movies.json"

    movie_file = Path(movie_extraction_path)
    if not movie_file.is_file():
        logger.warning("Thumbnail: movie extraction not found at %s, skipping", movie_file)
        return

    movie_data = _load_json(movie_file)
    movies = movie_data.get("movies", [])
    if not movies:
        logger.info("Thumbnail: no movies in extraction, skipping")
        return

    # Collect movie IDs and titles
    movie_ids: List[str] = []
    movie_titles: List[str] = []
    for m in movies:
        mid = m.get("matchedMovieId")
        if mid:
            movie_ids.append(str(mid))
            title = m.get("title", "")
            year = m.get("year")
            movie_titles.append(f"{title} ({year})" if year else title)

    # Episode title from canonical context or extraction metadata.
    episode_title = ""
    db_episode = context.get("db_episode")
    if db_episode:
        ep_num = db_episode.get("number", "")
        ep_title = db_episode.get("title", "")
        episode_title = f"Ep {ep_num}: {ep_title}" if ep_num else ep_title
    else:
        ep_meta = movie_data.get("episode", {})
        ep_num = ep_meta.get("dbEpisodeNumber", "")
        ep_title = ep_meta.get("dbEpisodeTitle", "")
        episode_title = f"Ep {ep_num}: {ep_title}" if ep_num else ep_title

    # Output path
    output_dir = Path(config.get("paths", {}).get("output_dir", "./output")).expanduser().resolve()
    thumb_dir = output_dir / "thumbnails"
    thumb_path = thumb_dir / f"{stem}.png"

    ok = generate_thumbnail(
        movie_ids=movie_ids,
        output_path=thumb_path,
        config=config,
        episode_title=episode_title,
        movie_titles=movie_titles,
        convex_client=context.get("convex_client"),
    )
    if ok:
        context["thumbnail_path"] = str(thumb_path)
        print(f"Thumbnail written to {thumb_path}")
    else:
        print("Thumbnail generation failed")
