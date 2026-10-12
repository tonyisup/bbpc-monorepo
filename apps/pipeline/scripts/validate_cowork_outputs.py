#!/usr/bin/env python3
"""Check Cowork hand-off files before the pipeline consumes them.

Standard library only, so it runs outside the pipeline venv:

    python3 scripts/validate_cowork_outputs.py --pending        # what needs Cowork
    python3 scripts/validate_cowork_outputs.py 20260914         # validate one episode

Set BBPC_PIPELINE_DATA_DIR when the data directory is not ~/src/bbpc/bbpc-pipeline-data,
as in Cowork's Linux environment.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib import cowork_handoff  # noqa: E402
from lib.data_dir import require_data_dir, resolve_data_paths  # noqa: E402


def _load_config(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        return resolve_data_paths(json.load(f))


def _transcript_path(config: dict, stem: str) -> Path:
    entry = cowork_handoff.load_state(config)["episodes"].get(stem, {})
    recorded = Path(entry["transcriptPath"]) if entry.get("transcriptPath") else None
    if recorded is not None and recorded.is_file():
        return recorded
    # Fall back to the data directory (the recorded path may be the Mac's
    # absolute path when this runs in Cowork's Linux environment).
    transcripts = Path(config.get("paths", {}).get("transcripts_dir", "./transcripts"))
    return (transcripts / f"{stem}.json").resolve()


def _pending(config: dict) -> int:
    state = cowork_handoff.load_state(config)["episodes"]
    rows = []
    for stem in cowork_handoff.awaiting(config):
        entry = state[stem]
        rows.append({
            "stem": stem,
            "transcript": str(_transcript_path(config, stem)),
            "moviesOut": str(cowork_handoff.movies_path(config, stem)),
            "seoOut": str(cowork_handoff.seo_path(config, stem)),
            "shirtsOut": str(cowork_handoff.shirts_path(config, stem)),
            "outputsPresent": cowork_handoff.outputs_ready(config, stem),
            "lastError": entry.get("lastError"),
        })
    print(json.dumps(rows, indent=2))
    return 0


def _validate(config: dict, stem: str) -> int:
    transcript = _transcript_path(config, stem)
    segments = None
    if transcript.is_file():
        segments = json.loads(transcript.read_text(encoding="utf-8"))
    else:
        print(f"note: transcript not found at {transcript}; skipping duration, segment-boundary and phrase-text checks")

    ok = True
    for label, loader in (
        ("movies", lambda: cowork_handoff.load_movies(config, stem, segments)),
        ("seo", lambda: cowork_handoff.load_seo(config, stem, segments=segments)),
        ("shirts", lambda: cowork_handoff.load_shirts(config, stem, segments)),
    ):
        try:
            payload = loader()
        except cowork_handoff.CoworkOutputInvalid as exc:
            ok = False
            print(f"FAIL {label}: {exc}")
            continue
        if payload is None:
            if label == "shirts":  # information for Tony; the pipeline never waits for it
                print(f"{label}: not written (optional)")
                continue
            ok = False
            print(f"MISSING {label}")
            continue
        print(f"OK {label}")
        if label == "seo":
            warnings = cowork_handoff.seo_warnings(payload)
            print(f"  {len(payload['candidateClips'])} candidate clips, {len(payload['clipAnalysis'])} selected")
        elif label == "shirts":
            warnings = cowork_handoff.shirts_warnings(payload)
            origins = [row.get("origin") for row in payload["phrases"]]
            counts = ", ".join(f"{origins.count(origin)} {origin}" for origin in cowork_handoff.SHIRT_ORIGINS)
            print(f"  {len(origins)} phrases ({counts})")
        else:
            warnings = cowork_handoff.movies_warnings(payload)
            accepted = [m.get("title") for m in payload["movies"] if m.get("status", "accepted") == "accepted"]
            print(f"  accepted: {', '.join(accepted) or '(none)'}")
        for warning in warnings:
            print(f"  warning: {warning}")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stem", nargs="?", help="Episode stem, e.g. 20260914")
    ap.add_argument("--pending", action="store_true", help="List episodes waiting on Cowork (JSON)")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    args = ap.parse_args()
    config = _load_config(Path(args.config))
    require_data_dir()
    if args.pending:
        return _pending(config)
    if not args.stem:
        ap.error("pass an episode stem or --pending")
    return _validate(config, args.stem)


if __name__ == "__main__":
    sys.exit(main())
