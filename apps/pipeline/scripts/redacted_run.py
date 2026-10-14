#!/usr/bin/env python3
"""Run a command with every .env value in its output replaced by the value's name.

    venv/bin/python scripts/redacted_run.py -- venv/bin/python pipeline.py 20261012.mp3 --from clip

The dashboard's Runs tab starts the pipeline through this, so that what the
pipeline prints (the transcript importer names its Convex target) can be kept
in a log and shown in the browser. Output, stdout and stderr together, goes to
this script's stdout. Exits with the command's status, or 128 plus the signal
that ended it, as a shell reports it.
"""
from __future__ import annotations

import contextlib
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.redaction import Redactor  # noqa: E402
from lib.run_checks import CREDENTIAL_NAMES  # noqa: E402
from lib.runtime_config import secret_values  # noqa: E402


def main(argv: list[str]) -> int:
    if not argv or argv[0] != "--" or len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    out = sys.stdout.buffer
    with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet):  # loading .env says so; that is not the command's output
        redactor = Redactor(secret_values(CREDENTIAL_NAMES))
    try:
        process = subprocess.Popen(argv[1:], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, env={**os.environ, "PYTHONUNBUFFERED": "1"})
    except OSError as exc:
        out.write(f"could not start {argv[1]}: {exc.strerror or exc}\n".encode("utf-8"))
        return 127
    while True:
        chunk = process.stdout.read1(65536)
        if not chunk:
            break
        out.write(redactor.feed(chunk))
        out.flush()
    out.write(redactor.flush())
    out.flush()
    code = process.wait()
    return 128 - code if code < 0 else code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
