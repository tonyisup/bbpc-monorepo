#!/usr/bin/env python3
"""Scan every transcript for phrases that recur across episodes.

Re-run it whenever transcripts are backfilled; it rescans everything and
reports what is new since the previous scan. Standard library only.

    python3 scripts/scan_phrases.py
    python3 scripts/scan_phrases.py --min-episodes 6 --top 200

Reads   <data>/transcripts/<YYYYMMDD>.json
Writes  <data>/output/phrases/recurring-phrases.json   (everything, with examples)
        <data>/output/phrases/recurring-phrases.md     (readable top lists)
Honours <data>/output/phrases/ignore.txt               (one phrase per line; # comments)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib import phrase_scan  # noqa: E402
from lib.data_dir import require_data_dir, resolve_data_paths  # noqa: E402


def main() -> int:
    defaults = phrase_scan.ScanOptions()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    ap.add_argument("--min-episodes", type=int, default=defaults.min_episodes)
    ap.add_argument("--max-words", type=int, default=defaults.max_words,
                    help="recurring phrases this long are treated as drops/rituals")
    ap.add_argument("--burst-window", type=int, default=defaults.burst_window)
    ap.add_argument("--top", type=int, default=100, help="entries per section in the markdown report")
    args = ap.parse_args()

    with Path(args.config).open(encoding="utf-8") as f:
        config = resolve_data_paths(json.load(f))
    require_data_dir()
    transcripts = Path(config["paths"]["transcripts_dir"])
    out_dir = Path(config["paths"]["output_dir"]) / "phrases"
    options = phrase_scan.ScanOptions(
        min_episodes=args.min_episodes, max_words=args.max_words,
        burst_window=args.burst_window, ignore_file=out_dir / "ignore.txt",
    )

    started = time.monotonic()
    result = phrase_scan.scan(transcripts, options)
    changes = phrase_scan.write_outputs(out_dir, result, top=args.top)
    print(f"Scanned {result['transcripts']} transcripts ({result['firstStem']}–{result['lastStem']}) "
          f"in {time.monotonic() - started:.0f}s")
    print(f"  {len(result['phrases'])} phrases, {len(result['passages'])} recurring passages")
    if changes["previousScan"]:
        print(f"  since the last scan ({changes['previousTranscripts']} transcripts): "
              f"{len(changes['new'])} new, {len(changes['grown'])} in more episodes")
    print(f"  report: {out_dir / 'recurring-phrases.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
