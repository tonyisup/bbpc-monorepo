#!/usr/bin/env bash
set -euo pipefail
cd /Users/juicebox/src/bbpc-monorepo

pnpm --filter @tonyisup/bbpc-convex-api transcripts:backfill run \
  --plan /private/tmp/bbpc-backfill-20260911/live-plan.json \
  --python /Users/juicebox/src/bbpc/bbpc-pipeline/venv/bin/python \
  --env-file /Users/juicebox/src/bbpc/bbpc-pipeline/.env \
  --output /private/tmp/bbpc-backfill-20260911/output \
  --matched-only \
  --limit 1