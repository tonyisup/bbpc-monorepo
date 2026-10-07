#!/usr/bin/env python3
"""Autotune laughter detector parameters over recent episodes."""
from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from lib.laughter_detector import detect_laughter
from lib.runtime_config import load_config


def _recent_episodes(episodes_dir: Path, n: int) -> List[Path]:
    audio_ext = {".mp3", ".wav", ".m4a", ".aac", ".flac"}
    files = [p for p in episodes_dir.iterdir() if p.is_file() and p.suffix.lower() in audio_ext]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return list(reversed(files[:n]))


def _candidate_variants() -> List[Tuple[str, Dict[str, Any]]]:
    baseline: Dict[str, Any] = {}
    variants: List[Tuple[str, Dict[str, Any]]] = [("baseline", baseline)]
    variants.append(
        (
            "lower_rms_and_ratio",
            {"rms_multiplier": 1.08, "laugh_ratio_min": 0.2},
        )
    )
    variants.append(
        (
            "wider_onset_window",
            {"onset_rate_min": 2.0, "onset_rate_max": 12.0, "window_sec": 2.5},
        )
    )
    variants.append(
        (
            "high_recall",
            {
                "onset_rate_min": 1.2,
                "onset_rate_max": 12.5,
                "rms_multiplier": 1.0,
                "laugh_ratio_min": 0.15,
                "centroid_multiplier": 0.95,
            },
        )
    )
    variants.append(
        (
            "narrow_band_talk_laughter",
            {"laughter_fmin": 170.0, "laughter_fmax": 1200.0, "rms_multiplier": 1.05},
        )
    )
    return variants


def _score(counts: List[int], max_per_episode: int) -> Tuple[int, int]:
    """Return (episodes_with_at_least_one, overflow_penalty)."""
    hits = sum(1 for c in counts if c >= 1)
    overflow = sum(max(0, c - max_per_episode) for c in counts)
    return hits, overflow


def main() -> None:
    parser = argparse.ArgumentParser(description="Autotune laughter detector against recent episodes.")
    parser.add_argument("--config", default="config.json", help="Path to config.json")
    parser.add_argument("--episodes", type=int, default=3, help="Recent episodes to evaluate")
    parser.add_argument("--max-per-episode", type=int, default=5, help="False-positive guardrail")
    parser.add_argument("--max-detections", type=int, default=10, help="Per-episode detector cap")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    episodes_dir = Path(config.get("paths", {}).get("episodes_dir", "./episodes")).expanduser().resolve()
    output_dir = Path(config.get("paths", {}).get("output_dir", "./output")).expanduser().resolve()
    laughter_dir = output_dir / "laughter"
    laughter_dir.mkdir(parents=True, exist_ok=True)

    episodes = _recent_episodes(episodes_dir, args.episodes)
    if len(episodes) < args.episodes:
        raise SystemExit(
            f"Need at least {args.episodes} episode files in {episodes_dir}, found {len(episodes)}."
        )

    print(f"Evaluating laughter params on {len(episodes)} episodes:")
    for ep in episodes:
        print(f"  - {ep.name}")

    variants = _candidate_variants()
    best_name = ""
    best_params: Dict[str, Any] = {}
    best_counts: List[int] = []
    best_hits = -1
    best_overflow = 10**9

    tsv_path = laughter_dir / "tuning_results.tsv"
    with tsv_path.open("w") as f:
        f.write("timestamp\tvariant\thits\toverflow\tstatus\tcounts\n")

    for name, overrides in variants:
        counts: List[int] = []
        for ep in episodes:
            clips = detect_laughter(
                audio_path=ep,
                max_detections=args.max_detections,
                params=overrides,
                collect_diagnostics=False,
            )
            counts.append(len(clips))

        hits, overflow = _score(counts, args.max_per_episode)
        is_better = (hits > best_hits) or (hits == best_hits and overflow < best_overflow)
        status = "keep" if is_better else "discard"
        if is_better:
            best_name = name
            best_params = deepcopy(overrides)
            best_counts = counts[:]
            best_hits = hits
            best_overflow = overflow

        now = datetime.now().isoformat(timespec="seconds")
        with tsv_path.open("a") as f:
            f.write(f"{now}\t{name}\t{hits}\t{overflow}\t{status}\t{','.join(map(str, counts))}\n")

        print(f"[{status.upper():7}] {name:24s} hits={hits}/{len(episodes)} overflow={overflow} counts={counts}")

    best_payload = {
        "variant": best_name,
        "params": best_params,
        "episodes": [ep.name for ep in episodes],
        "counts": best_counts,
        "hits": best_hits,
        "max_per_episode": args.max_per_episode,
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    best_path = laughter_dir / "best_params.json"
    with best_path.open("w") as f:
        json.dump(best_payload, f, indent=2)

    print(f"\nBest variant: {best_name} (hits={best_hits}/{len(episodes)}, overflow={best_overflow})")
    print(f"Wrote: {best_path}")
    print(f"Wrote: {tsv_path}")


if __name__ == "__main__":
    main()
