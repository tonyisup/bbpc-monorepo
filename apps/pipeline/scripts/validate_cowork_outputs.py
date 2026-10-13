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


def _pending(config: dict) -> int:
    state = cowork_handoff.load_state(config)["episodes"]
    rows = []
    for stem in cowork_handoff.awaiting(config):
        entry = state[stem]
        rows.append({
            "stem": stem,
            "transcript": str(cowork_handoff.transcript_path(config, stem)),
            "moviesOut": str(cowork_handoff.movies_path(config, stem)),
            "seoOut": str(cowork_handoff.seo_path(config, stem)),
            "shirtsOut": str(cowork_handoff.shirts_path(config, stem)),
            "outputsPresent": cowork_handoff.outputs_ready(config, stem),
            "lastError": entry.get("lastError"),
        })
    print(json.dumps(rows, indent=2))
    return 0


def _validate(config: dict, stem: str) -> int:
    result = cowork_handoff.check_episode(config, stem)
    if not result["transcriptFound"]:
        print(f"note: transcript not found at {result['transcript']}; "
              "skipping duration, segment-boundary and phrase-text checks")

    for row in result["files"]:
        label = row["label"]
        if row["status"] == "invalid":
            print(f"FAIL {label}: {cowork_handoff.CoworkOutputInvalid(Path(row['path']), row['problems'])}")
        elif row["status"] == "not_written":
            print(f"{label}: not written (optional)")
        elif row["status"] == "missing":
            print(f"MISSING {label}")
        else:
            print(f"OK {label}")
            print(f"  {row['summary']}")
            for warning in row["warnings"]:
                print(f"  warning: {warning}")
    return 0 if result["ok"] else 1


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
