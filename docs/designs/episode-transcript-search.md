# Public episode transcript search

Date: 2026-09-10
Status: APPROVED — implementation authorized by the user on 2026-09-10
Workflow: office-hours

## Confirmed scope

Listeners can search words heard in an episode on the public website and see the matching passage and timestamp. The user selected this over topic/semantic search. Admin search is outside this change.

Transcript producer: the `bbpc-pipeline` repository at `/Users/juicebox/src/bbpc/bbpc-pipeline`. Pipeline-relative paths below refer to that repository; application/backend paths refer to this monorepo.

## Current behavior and evidence

- `apps/web/src/app/history/HistoryPageClient.tsx` searches episode titles, assignments, and extra movie/show titles locally using Fuse or substring matching. Preserve these results and the existing close-spelling option for metadata.
- `apps/web/src/server/convex/episodes.ts` downloads the episode archive, with a 1,000-episode compatibility limit. Do not add full transcripts to this browser payload.
- `packages/convex-backend/convex/episodes/public.ts` has a separate title/movie search API. Changing this alone would not update the public history page.
- The referenced pipeline's `lib/transcriber.py` emits JSON arrays of `{start, end, text}` with timestamps in seconds. It also saves interrupted/partial output, so file existence does not prove completion.
- The pipeline's `lib/publisher.py` publishes SEO metadata through the authenticated Convex client; it does not upload transcripts. `lib/episode_db.py` resolves dated filename stems to canonical episodes.
- `apps/web/src/components/Episode.tsx` links to the recording URL. It has no embedded player or verified timestamp-seeking behavior.

## Approach

Use a Convex full-text index on small transcript passages, queried by the public archive page. Keep transcript results separate from metadata search at the API boundary and combine them in the page by episode ID.

Alternatives considered:

- Loading transcript text into the existing browser Fuse index is the smallest conceptual change, but makes every visitor download the archive's transcript corpus. Reject this approach.
- Convex passage search reuses the existing backend and gives results with source timestamps. Recommended implementation for the selected word-search scope.
- Semantic or hybrid retrieval adds embeddings and different matching behavior. Deferred by the user's choice of word search.

Convex supports ranked word matching, case/punctuation normalization, and prefix matching on the final term; it does not provide the existing Fuse typo behavior. Scope the close-spelling label to titles/movie names and explain that transcript matches use words. This version does not promise exact quoted-phrase syntax. Reference: [Convex full-text search](https://docs.convex.dev/search/text-search).

## Listener experience

Keep `/history?q=...` as the entry point. Add a transcript-results request after a 300 ms debounce for a nonblank query of at least two characters. Clearing or changing the query invalidates previous transcript results immediately; late responses cannot replace newer results.

Preserve metadata ordering, attach up to three matching transcript passages to episodes already found there, and append transcript-only episodes in search relevance order. Deduplicate by canonical episode ID. Each passage displays a plain-text excerpt with highlighted matching words and the source start timestamp, formatted as `mm:ss` or `h:mm:ss`. Merge overlapping excerpts from the same episode.

Show a transcript label so a listener understands why an episode matched. Display timestamps as text, alongside the existing episode link; playable timestamp links require a separately verified recording host and are not part of this version. Label passages as automatically generated.

While searching, keep existing metadata results visible and show transcript loading status. On transcript failure, preserve metadata results and provide an inline retry. Distinguish no transcript matches from an unavailable search service. Result counts refer to the displayed unique episodes, not an exhaustive archive total.

Initial transcript retrieval returns at most 100 ranked passages, grouped into at most 20 episodes, with three excerpts per episode. Return a `limited` flag whenever either cap is reached; the UI asks the listener to narrow the query. Do not claim exhaustive results or silently show a zero-result state on an error. Pagination and an archive-wide exact result count are deferred.

## Import and storage

Implement import tooling under `packages/convex-backend/` in this monorepo. It accepts an explicit transcript file or directory from the referenced pipeline and a mapping to canonical episode IDs. An operator can run the same importer after future pipeline runs without modifying the sibling repository. A native pipeline publishing hook can follow separately; it is not silently assumed to exist.

Provide a dry-run manifest showing file names, resolved episode IDs, segment counts, completion decisions, and errors without transcript text or credentials. Date-based resolution may propose a mapping but must fail on zero or multiple matches; never infer identity by fuzzy title matching. Import only files explicitly confirmed complete by the operator or by a completion signal from the producer. Existing JSON alone cannot establish completeness.

Validate the entire file before writing: supported array shape, nonempty usable text, finite nonnegative timestamps, end >= start, monotonic starts, and bounded UTF-8 sizes. Ignore whitespace-only segments. Reject malformed files with an actionable segment index. Preserve original timestamp values and text as evidence; do not send it to a language model.

Store transcript generation metadata separately from searchable passage records. A passage records episode ID, generation ID, sequence, start/end seconds, and text. Deterministically group adjacent segments into bounded passages (target about 800 characters, hard maximum 2,000), carrying one previous segment into the next passage when it fits. Split oversized segments on word boundaries; split pieces retain the source segment's timestamp. This improves matches that cross segment boundaries while keeping queries and excerpts small. It does not guarantee arbitrary phrases across passage boundaries.

Use a content hash and parser version for retry identity. Each episode is one bounded atomic batch: at most 400 passages, 2,000 UTF-8 bytes per passage, and 512 KiB of passage text. Validate everything before deletion, then replace at most 400 old rows with 400 new rows and update metadata/audit in the same transaction. This was verified at maximum size against an isolated local backend. No staged generations or stale index hits exist. A failed replacement leaves the current generation searchable, and expected-hash comparison prevents concurrent imports from overwriting each other. Identical retry content is a no-op.

The importer requires explicit canonical ID mapping and operator-confirmed completion; date inference and a native pipeline publishing hook are deferred. Run it after future pipeline runs. The operational instructions are in `packages/convex-backend/local-tools/transcripts/README.md`.

Public queries use indexed `isPublic` eligibility before applying their result cap, then recheck canonical episode publication status. The existing application write triggers update eligibility atomically on publication changes and remove transcript rows on episode deletion. An authenticated, expected-hash-protected removal endpoint also supports explicit cleanup. Transcript tables are included in portable backup classification. No transcript text is added to general episode DTOs, audit payloads, or committed real-data fixtures.

### Engineering review resolution

- Scope stays in the shared backend, monorepo import tooling, and public web archive. Existing metadata Fuse matching, episode hydration, pipeline authorization/write gates, and deployment workflows are reused.
- Atomic replacement avoids an upload state machine and cleanup scheduler. The enforced payload bound makes mutation work predictable; oversize transcripts fail rather than being truncated.
- Tests cover parsing, word/prefix matching, visibility indexing, publish/unpublish/delete, retries/conflicts, query races, failures, and size limits. A real local backend verifies the platform search behavior and upper-bound replacement; browser QA covers `/history` on desktop/mobile.
- Search has bounded passage/episode counts. UI distinguishes service errors and capped results. There is no semantic search, admin UI, playback seeking, or new external service.

```text
completed JSON + explicit mapping
  -> validate + group passages
  -> authenticated inspect (dry-run)
  -> expected-hash atomic replacement
  -> current public passage index
  -> anonymous bounded search + canonical visibility check
  -> merge with existing archive matches
  -> highlighted text + source timestamp
```

## Implementation sequence and validation

1. Generation activation is resolved above; read the full Convex generated guidelines before editing backend code.
2. Add schema, authenticated import endpoints, and a public transcript-search contract in the shared backend package. Preserve the API used by admin. Generate/build the shared API contract through existing root pnpm workflows.
3. Add the monorepo importer with dry-run, explicit completion confirmation, target checks, and retry support. Document the one-time archive import and repeat command for future transcripts.
4. Integrate transcript results into the public history page with excerpts, timestamp display, query state handling, and partial-service failure handling.
5. Test with synthetic transcripts: transcript-only words, case/punctuation and last-term prefixes, cross-segment matches, repeated/overlapping passages, metadata deduplication, invalid files, partial input, retry/replacement, unpublished episodes, capped results, empty input, and out-of-order requests.
6. Run relevant backend/web tests, type checks, and contract checks from the repository root with Node 22+ and pnpm. Verify desktop/mobile behavior locally. No production transcript upload or deploy occurs as part of local verification; production deployment follows the existing separate approval/runbook.

## Acceptance criteria

- A published synthetic episode whose query words occur only in its transcript appears on `/history` with the correct passage and source timestamp.
- Existing episode, assignment, and extra movie/show matches remain available with their current close-spelling behavior.
- Transcript corpus contents are not downloaded on initial page load; search returns bounded excerpts only.
- Private, staged, failed, and replaced transcript generations never leak through public search. A failed replacement does not remove the active transcript.
- Clearing/changing the query, backend failures, and capped results produce honest, accessible states.
- The importer can backfill completed files and rerun safely without duplicates; unmatched/ambiguous episode mappings are reported rather than guessed.

## Next practical check

Before archive rollout, choose three remembered phrases from existing completed transcripts and verify their episode and timestamp through the search UI. This catches transcription/timing and episode-mapping problems that synthetic tests cannot establish. No real transcript data is needed in the repository.

## Verification completed

- `pnpm run check:backend` passed, including 459 backend tests, importer tests, type/lint/access/query checks, deployment guard tests, portable migration tests, and coverage thresholds (95.97% lines; 90.10% branches).
- Public web checks passed: 41 existing contract tests, 19 behavior tests, typecheck, and lint. The new behavior tests cover transcript search and the HTTP route.
- Shared API generation was checked against the isolated backend's public function specification; package build and consumer typechecking passed.
- Real local Convex verification passed for word/prefix/case/punctuation search, correct timestamps, rejected anonymous writes, identical retries, and 400-passage replacement. The real importer independently confirmed client/server hashes and repeat-import behavior.
- Browser QA at 1280×900 and 375×812 confirmed transcript-only results, highlighting, timestamp display, title matches, no results, query clearing, and bookmarked prefix search. Mobile document width matched viewport width. No application console errors were observed; Clerk emitted its normal development-key warning.
- Independent review findings about query revisits and unpublished hits consuming the search budget were fixed and re-reviewed, with regression tests.
- Local verification used synthetic transcripts only. Deployment and real archive import remain rollout steps governed by the existing runbook.
