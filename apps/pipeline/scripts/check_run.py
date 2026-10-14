#!/usr/bin/env python3
"""The checks made before a pipeline run, the same ones the dashboard's Runs tab makes.

    venv/bin/python scripts/check_run.py                 # before an unattended run (scheduled_pipeline.sh)
    venv/bin/python scripts/check_run.py --from clip     # before pipeline.py <episode> --from clip
    venv/bin/python scripts/check_run.py --json          # the same, as JSON (what the dashboard reads)

Checks that the data directory exists, that check_configuration() passes
(the Convex target matches its pins), that the credentials the run needs are
set, that ffmpeg has libass and that Node is 22.6 or newer. Credentials are
listed by name, set or not set; no .env value is printed. Exits 1 if a check
fails.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib import run_checks  # noqa: E402
from lib.runtime_config import load_config  # noqa: E402
from lib.stage_status import STAGES  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    ap.add_argument("--from", dest="stage", choices=STAGES, help="the stage the run starts from (default: unattended)")
    ap.add_argument("--json", action="store_true", help="print the result as JSON")
    args = ap.parse_args()
    # What loading .env prints goes to stderr, so --json prints nothing but the result.
    with contextlib.redirect_stdout(sys.stderr if args.json else sys.stdout):
        result = run_checks.run_all(load_config(Path(args.config)), args.stage)
    if args.json:
        print(json.dumps(result))
        return 0 if result["ok"] else 1
    for check in result["checks"]:
        print(f"{'ok  ' if check['ok'] else 'FAIL'}  {check['label']}: {check['detail']}")
    print("\nCredentials (name, and whether it is set):")
    for row in result["credentials"]:
        need = "needed" if row["needed"] else "not needed for this run"
        print(f"  {row['name']}  {'set' if row['set'] else 'not set'}  ({need}; {row['use']})")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
