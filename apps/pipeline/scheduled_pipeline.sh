#!/bin/bash
# Unattended entry point (run by hand, cron, or launchd). Safe to run repeatedly:
#   - finished episodes are skipped (output/cowork/state.json in the data directory)
#   - a new episode is transcribed + imported, then handed to Cowork (exit 75)
#   - once Cowork has written its files, the next run resumes from `movies`
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
source venv/bin/activate || exit 1

python pipeline.py "$@"
status=$?
if [ "$status" -eq 75 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') waiting for Cowork; will resume on a later run."
  exit 0
fi
exit "$status"
