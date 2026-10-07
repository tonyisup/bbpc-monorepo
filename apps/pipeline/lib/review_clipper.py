"""Review clip stage – cuts audio clips from movie-review evidence windows."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, List


def _slugify(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "movie"


def _movie_path_from_context(context: Dict[str, Any], config: Dict[str, Any]) -> Path:
    existing = context.get("movie_extraction_path")
    if existing:
        return Path(existing)
    transcript_path = Path(context.get("transcript_path", ""))
    movie_dir = Path(config.get("paths", {}).get("movie_extractions_dir", "./output/movies"))
    return movie_dir / f"{transcript_path.stem}.movies.json"


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _sanitize_windows(movie_row: Dict[str, Any]) -> List[Dict[str, float]]:
    windows: List[Dict[str, float]] = []
    for ev in movie_row.get("evidence", []):
        try:
            start = float(ev.get("start", 0.0))
            end = float(ev.get("end", 0.0))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        windows.append({"start": start, "end": end})
    return windows


def _merge_windows(windows: List[Dict[str, float]], gap_seconds: float) -> List[Dict[str, float]]:
    if not windows:
        return []
    ordered = sorted(windows, key=lambda row: row["start"])
    merged: List[Dict[str, float]] = [dict(ordered[0])]
    for window in ordered[1:]:
        current = merged[-1]
        if window["start"] <= current["end"] + gap_seconds:
            current["end"] = max(current["end"], window["end"])
            continue
        merged.append(dict(window))
    return merged


def _trim_windows(
    windows: List[Dict[str, float]],
    *,
    pre_roll: float,
    post_roll: float,
    min_seconds: float,
    max_seconds: float,
) -> List[Dict[str, float]]:
    clipped: List[Dict[str, float]] = []
    for window in windows:
        start = max(window["start"] - pre_roll, 0.0)
        end = window["end"] + post_roll
        duration = end - start
        if duration < min_seconds:
            continue
        if duration > max_seconds:
            end = start + max_seconds
        clipped.append({"start": round(start, 3), "end": round(end, 3)})
    return clipped


def _render_clip(episode_audio: Path, output_path: Path, start: float, end: float) -> None:
    duration = end - start
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(start),
        "-t",
        str(duration),
        "-i",
        str(episode_audio),
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)


def run(context: Dict[str, Any]) -> None:
    config = context.get("config", {})
    movie_path = _movie_path_from_context(context, config)
    if not movie_path.is_file():
        print(f"Skipping review clips: movie extraction not found at {movie_path}")
        return

    episode_audio = Path(context.get("episode_audio") or context.get("episode_path", ""))
    if not episode_audio.is_file():
        print(f"Skipping review clips: episode audio not found at {episode_audio}")
        return

    payload = _load_json(movie_path)
    movies = payload.get("movies", [])
    if not isinstance(movies, list) or not movies:
        print("No accepted reviewed movies found for review clipping.")
        return

    settings = config.get("settings", {})
    gap_seconds = float(settings.get("review_clip_merge_gap_seconds", 6.0))
    pre_roll = float(settings.get("review_clip_preroll_seconds", 3.0))
    post_roll = float(settings.get("review_clip_postroll_seconds", 3.0))
    min_seconds = float(settings.get("review_clip_min_seconds", 12.0))
    max_seconds = float(settings.get("review_clip_max_seconds", 180.0))
    max_clips_per_movie = max(1, int(settings.get("review_clip_max_per_movie", 3)))

    output_root = Path(config.get("paths", {}).get("output_dir", "./output"))
    episode_stem = Path(context.get("episode_path", "")).stem
    output_dir = output_root / "review-clips" / episode_stem
    output_dir.mkdir(parents=True, exist_ok=True)

    manifest: Dict[str, Any] = {"episode": episode_stem, "clips": []}
    created_count = 0

    for movie in movies:
        title = str(movie.get("title", "")).strip() or "Unknown Movie"
        windows = _sanitize_windows(movie)
        windows = _trim_windows(
            _merge_windows(windows, gap_seconds),
            pre_roll=pre_roll,
            post_roll=post_roll,
            min_seconds=min_seconds,
            max_seconds=max_seconds,
        )
        if not windows:
            continue
        for idx, window in enumerate(windows[:max_clips_per_movie], start=1):
            slug = _slugify(title)
            output_name = f"{slug}-{idx:02d}.m4a"
            output_path = output_dir / output_name
            if output_path.exists():
                continue
            try:
                _render_clip(episode_audio, output_path, window["start"], window["end"])
            except subprocess.CalledProcessError as exc:
                err = (exc.stderr or exc.stdout or str(exc)).strip()
                print(f"  Failed review clip for '{title}' [{window['start']:.2f}-{window['end']:.2f}]: {err}")
                continue
            created_count += 1
            manifest["clips"].append(
                {
                    "movieTitle": title,
                    "start": window["start"],
                    "end": window["end"],
                    "path": str(output_path),
                }
            )

    manifest_path = output_dir / "_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    context["review_clip_manifest_path"] = str(manifest_path)
    print(f"Review clip stage complete: {created_count} clip(s) created at {output_dir}")
