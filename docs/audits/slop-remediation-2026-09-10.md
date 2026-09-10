# Slop audit remediation — September 10, 2026

Branch: `codex/slop-audit-findings`.

This follows the [September 5 audit](./slop-audit-2026-09-05.md). The original report is retained as the record of the findings; its line references describe the pre-repair source.

## Repairs

| Finding | Implemented repair |
| --- | --- |
| S01 | Recording recovery retains microphone and sounder tracks, exposes upload errors after capture stops, retries failed tracks, and provides local downloads and explicit discard. Starting another take or ending the session is guarded while audio needs recovery. |
| S02 | Failed session events remain queued with their original IDs and timestamps. The interface shows pending writes and offers retry. Name and episode edits inspect HTTP status before committing local changes. |
| S03 | All three apps use the shared generated API references. External string IDs regain their table brands at validated input boundaries. Compiler checks compare the public contract to the backend and reject invalid endpoint names, arguments, and ID tables in a package consumer. An architecture test prevents manual API reference factories from returning. |
| S04 | Rendered interaction tests cover ranking selection, duplicate submissions, failure/retry, and saving a movie before creating its assignment. Source checks that claimed to verify those behaviors were removed. |
| S05 | Dashboard counts and episode selection use maintained projections and indexed reads. A resumable backfill runs in batches of 100; the admin shows a preparation state until it completes. Tests cross the old user, movie, review, and episode caps and exercise writes during backfill. |
| S06 | Assignment user and season selectors load subsequent cursor pages within the existing workflow. Rendered tests select records from later pages. |
| S07 | RTC and session deletion make progress through bounded batches and schedule continuations. Deleting sessions revoke participant access before child deletion begins. Existing authorization, retention cutoffs, and cutover checks remain in effect. |
| S08 | Root verification now runs lint for all three apps. Recording lint errors and remaining web/admin lint warnings were repaired. Web and admin invoke ESLint directly. |
| S09 | MCP's generated personality appraisal was replaced with a short factual host bio. |
| S10 | Admin and syllabus copy describes user tasks, limits, and recovery actions without migration implementation notes. |
| S11 | Removed the retired media page, unused sidebar provider, duplicate unused mobile hooks, obsolete type shim, and seven unused direct dependency entries. The root pnpm lockfile records the dependency removal. |
| S12 | The actual recorder MIME type reaches blobs, upload validation, filenames, and storage metadata. |
| S13 | Recorder teardown finalizes audio for recovery and releases owned microphone tracks, recorders, timers, and audio resources. |
| S14 | Stale RTC participants must satisfy room capacity again on rejoin or heartbeat. Regression tests exercise replacement and reconnect. |
| S15 | Query lint identifies database query receivers and aliases, accepts array filters, and flags unindexed bounded scans unless they have a reasoned annotation. Behavioral fixtures cover each case. |
| S16 | Recording documentation uses commands that work from the monorepo root. |

## Operational notes

Recovery is retained in this browser tab's memory across client navigation. It is not durable across a reload, tab closure, or browser crash. The interface warns before leaving with active capture or unsaved work and provides local track downloads.

Dashboard projections are derived data. The first authorized dashboard visit starts their backfill; normal writes maintain them transactionally. Counts and projection-dependent panels show preparation state until backfill completes. Restore workflows clear derived projection state so it can be rebuilt.

Large cleanup calls return counts for their first batch; scheduled continuations finish the remaining rows. A session can therefore report zero completed session deletions while its children are still being removed.

The backend schema and API changes must be released through the existing environment and production-approval runbooks. This repair task performs no backend deployment or production mutation.

## Verification

- The shared API package build and isolated consumer typecheck pass, including deliberate invalid endpoint, argument, and table-ID cases.
- Web and admin production builds pass. Admin emits a Clerk/Next `useContext` import warning; web reports its existing App Router i18n configuration warning.
- Recording production build passes using synthetic Clerk/Convex public configuration. The workspace has no recording environment configured; a build without those values correctly fails configuration validation.
- Recording behavior tests include upload remount/inflight identity, cancellation during guest microphone/recorder startup, and failed/inflight event queue remounts.
- No authenticated browser session, real microphone session, live upload, or production deployment was exercised. Component interactions and recorder/network failure scenarios were tested with controlled doubles.
- Generated PWA build output was restored so it is not part of the source change.

`pnpm run check` passes: **849 tests**, all application and backend typechecks, all three app lint commands, backend lint/query/access checks, and deployment/migration verification suites. Backend coverage is **96.06% statements and 90.24% branches**. `git diff --check` passes.
