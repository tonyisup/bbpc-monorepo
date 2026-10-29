#!/usr/bin/env python3
"""Upload a Lab test render to YouTube as a private video and record it as published.

    venv/bin/python scripts/youtube_upload.py <run id> --title "Bad Boys Podcast - 801 - Alpha - Bit 5"
    venv/bin/python scripts/youtube_upload.py <run id> --title "…" --episode https://youtu.be/<full episode>
    venv/bin/python scripts/youtube_upload.py <run id>      # an upload the Lab has already asked for

The run id is a folder name under output/lab/ (the Lab lists them). The video
is uploaded private; make it public in YouTube Studio. On success the clip is
recorded as published in output/publish-decisions.json, as the pick or
candidate it came from, or as an untracked Short when the Lab cut it
differently. A clip is uploaded once.

YouTube makes it a Short by itself (the clip is vertical and at most three
minutes). --episode links the full episode: the description ends with its
link, which is remembered for the episode's other clips. The API cannot set a
Short's Related video, so the script prints the link to set it to in Studio.

Needs YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in
.env (see scripts/youtube_auth.py). No .env value is printed.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib import youtube_upload  # noqa: E402
from lib.data_dir import require_data_dir  # noqa: E402
from lib.runtime_config import load_config  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_id")
    ap.add_argument("--title", help="ask for the upload with this title (otherwise the Lab must have asked)")
    ap.add_argument("--description", default="")
    ap.add_argument("--episode", help="the full episode's YouTube URL or ID (otherwise the one remembered for it)")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    args = ap.parse_args()
    config = load_config(Path(args.config))
    require_data_dir()
    if args.title is not None:
        try:
            youtube_upload.prepare(config, args.run_id, args.title, args.description, episode=args.episode)
        except youtube_upload.UploadError as exc:
            print("Refused: " + "; ".join(exc.problems))
            return 2
    return youtube_upload.run_upload(config, args.run_id, os.environ)


if __name__ == "__main__":
    raise SystemExit(main())
