# Episode archive dry-run planner

`archive-backfill.mjs` is an offline data-reconciliation tool. It has no credentials,
network client, mutation calls, upload capability, or apply mode. It creates a review
artifact; **ready means a proposal, not authorization to write production**.

Use Node.js 22+ from the repository root. Inputs and outputs contain public but
production-derived catalog data and must remain private under ignored `.local-migration/`.
Do not commit or upload these artifacts. Output creation is exclusive (`0600`); an
existing reviewed report is never overwritten.

```sh
node packages/convex-backend/local-tools/episodes/archive-backfill.mjs \
  --website .local-migration/<run>/website-public.json \
  --azure .local-migration/<run>/azure-enriched.json \
  --sources .local-migration/<run>/soundcloud-sources.json \
  --as-of YYYY-MM-DD \
  --output .local-migration/<run>/archive-backfill-plan.json

node --test packages/convex-backend/local-tools/episodes/archive-backfill.test.mjs
```

Input envelopes are `{episodes:[...]}`, `{blobs:[...]}`, and `{tracks:[...]}`.
Episode rows contain the existing public ID, number, title, recording, date,
description, status and slug. Azure rows contain name, size, ETag and ID3 title/number
with provenance. Source tracks contain title, public link, original RSS GUID where
known, description and audio byte length. Collectors must verify the intended website
and current Azure inventory. Reuse cached tags only when size and ETag are unchanged.

Existing-row proposals require a unique episode-number plus normalized-title match.
Duplicate records, conflicting dates/links and shared media claims go to review.
Scheduled/future rows and existing Azure recordings are preserved. Number, date or
file size alone never qualifies. New listings additionally require independent
SoundCloud number/title corroboration, matching byte length when available, and no
existing number/title/asset collision. The proposed date comes from the Azure recording
filename, not the SoundCloud upload date. This is identity evidence, not a full-audio
integrity test or copyright clearance.

Before any separately approved production write:

1. Review the manifest, exception queue, target and exact approved operations.
2. Verify candidate objects are publicly reachable and inspect suspicious audio
   versions. Re-read current rows and ETags; abort on drift.
3. Capture private rollback evidence. Preserve existing IDs, slugs, related records,
   titles, dates, descriptions and status for recording-only updates.
4. Use the existing admin write workflow with its full optimistic-concurrency
   snapshot, or a separately reviewed/deployed guarded bulk route. A public snapshot
   from this planner is not the full admin `expected` argument. Never disable target,
   environment, auth or production-deployment checks.
5. Recheck duplicates before new listings, allocate collision-safe slugs, record new
   IDs and verify public access. Do not merge/delete legacy duplicates in this task.
6. Keep RSS cutover separate and request final approval after the archive passes.
