# Backfill the transcript archive

Run this tool from the monorepo root. It uses the pipeline's existing Python environment and Azure configuration, while keeping generated data outside both repositories. Node 22.6.0+, Python 3, and the pipeline's installed `azure-storage-blob`, `python-dotenv`, and `faster-whisper` packages are required. Execution also needs `ffprobe`. Optional ID3 inspection (`--read-tags`, recommended for this archive) requires `mutagen`; missing tags never prevent transcription.

The old pipeline backfill checks episode existence by filename date, then attempts episode creation from MP3 tags before transcription. A recording date that differs from the catalog date can therefore trigger unnecessary insertion or a tag-related skip. It also treats JSON file existence as completion and invokes the entire publishing pipeline. This tool separates those steps and never inserts, edits, or publishes episodes.

## Create a read-only plan

Configure `BBPC_PIPELINE_ACCESS_TOKEN`, `BBPC_EXPECTED_CONVEX_URL`, `BBPC_EXPECTED_CONVEX_DEPLOYMENT`, and the existing forbidden-deployment setting as described in [the import README](./README.md). The JWT must belong to the selected deployment. The Python `--env-file` supplies **only Azure credentials**; its `CONVEX_URL` does not select the backend.

```sh
pnpm --filter @tonyisup/bbpc-convex-api transcripts:backfill plan \
  --url "$BBPC_EXPECTED_CONVEX_URL" \
  --python /Users/juicebox/src/bbpc/bbpc-pipeline/venv/bin/python \
  --env-file /Users/juicebox/src/bbpc/bbpc-pipeline/.env \
  --transcripts /Users/juicebox/src/bbpc/bbpc-pipeline/transcripts \
  --known-mapping /absolute/path/to/previously-approved-import-mapping.json \
  --read-tags \
  --output /private/tmp/bbpc-backfill-plan.json
```

`--known-mapping` is optional; reuse a completed import's mapping to retain reviewed date exceptions. Existing plan files are never overwritten. Planning lists MP3 objects and reads small ID3 headers (up to 2 MiB per object), without downloading complete recordings or loading a speech model. The plan records source names, ETags, sizes, canonical episode IDs, matching evidence, local completion status, and catalog entries without a matched recording. Keep this production-derived report outside Git.

Matching order:

1. Explicit overrides or previously approved mappings.
2. The episode's exact recording URL, ignoring query parameters.
3. MP3 episode number **and** normalized title, together identifying one catalog record.
4. Exact valid `YYYYMMDD` date, identifying one catalog record and not contradicting available tags.

Multiple recordings competing for one episode, duplicate catalog matches, title disagreements, malformed dates, and absent catalog entries remain unresolved. There is no nearest-date inference. A reviewed mapping takes precedence over an unreviewed competing audio file. The plan includes candidate records for metadata disagreements.

To resolve an exception, pass `--overrides /absolute/path/to/overrides.json` when making a new plan:

```json
[
  { "blob": "recording-name.mp3", "episodeId": "CANONICAL_CONVEX_EPISODE_ID" }
]
```

Overrides must identify existing, unique audio objects and episode IDs. Do not use episode numbers as IDs. Missing catalog records require a separate catalog-repair task; transcription can proceed while those records are investigated.

## Generate a bounded batch

Review the plan, then run with an explicit output directory and batch limit (default: one attempted episode):

```sh
pnpm --filter @tonyisup/bbpc-convex-api transcripts:backfill run \
  --plan /private/tmp/bbpc-backfill-plan.json \
  --python /Users/juicebox/src/bbpc/bbpc-pipeline/venv/bin/python \
  --env-file /Users/juicebox/src/bbpc/bbpc-pipeline/.env \
  --output /absolute/path/outside-git/backfill-results \
  --limit 1 --matched-only
```

Run retains the expected-target checks but does not need a Clerk JWT: it reads Azure and writes local output only. It defaults to `large-v3-turbo` on CPU with int8 computation; `--model` changes that model. Model loading may download weights if they are not cached. Start with one episode to measure runtime before increasing the limit.

`--matched-only` starts with recordings already linked to a canonical episode. Omit it to also generate unresolved recordings into `unmapped/`. You can change this option between runs of the same plan.

The source URL plus ETag identifies each job. ETag and size are checked again before downloading; changed audio requires a new plan. Source transcripts are preserved. Already imported episodes are skipped. Approved, valid local transcripts can be staged without transcription; other existing JSON is unconfirmed and will be regenerated into the separate output directory.

Successful jobs must exhaust the transcription iterator, end within 95–100% of the measured audio duration (allowing two seconds of timing drift), and pass the same segment/passage limits as the importer. Coverage is a screening heuristic: long trailing silence can require manual review. It does not certify transcription accuracy. Exceptions and interrupts retain `work/<key>/partial.json`, never mark completion, and return failure. No movie extraction, diarization, clips, or publishing runs.

- `ready/`: completed transcripts with resolved canonical episode IDs.
- `mapping.json`: complete import mapping for `ready/` only.
- `unmapped/`: completed transcripts whose episode identity still needs review.
- `receipts/` and `report.json`: source identity, completion evidence, hashes, and failures.
- `work/`: temporary audio, candidate output, and partial failures. Successful audio downloads are removed after completion.

Rerun the **same plan and output directory** to continue. Verified completed jobs do not consume the next batch limit. An interrupted episode restarts transcription from the beginning; it can reuse its finished audio download. Partial JSON is retained for diagnosis, not trusted as a resume checkpoint. Failures count toward the attempt limit and make the command exit nonzero. A different plan requires a new output directory, protecting prior mappings and results. A single-writer `.lock` prevents concurrent runs; after a forced process kill, verify that its recorded PID is no longer running before removing that stale lock.

## Import after reviewing the result

Use the existing importer against `ready/` and `mapping.json`, first without `--apply`. Set a fresh pipeline JWT for the intended backend. The backfill does not publish automatically or deploy backend code.

```sh
pnpm --filter @tonyisup/bbpc-convex-api transcripts:import \
  --source /absolute/path/outside-git/backfill-results/ready \
  --mapping /absolute/path/outside-git/backfill-results/mapping.json \
  --url "$BBPC_EXPECTED_CONVEX_URL"
```

Do not import an empty `ready/` directory. For an unmatched completed transcript, use its receipt to identify the original blob, resolve the canonical episode, and make an explicit mapping for that existing generated file; no retranscription is needed. Never mark a `partial.json` as complete just to bypass validation.

## Tests

`pnpm --filter @tonyisup/bbpc-convex-api transcripts:test` runs the synthetic matching/import tests and Python worker tests. These require `python3` (or `BBPC_TRANSCRIPT_PYTHON`), but no cloud credentials, Azure package, Whisper model, or real recordings. Live planning reads the actual catalog and Azure metadata; full transcription runtime and accuracy should be evaluated with an initial one-episode run.
