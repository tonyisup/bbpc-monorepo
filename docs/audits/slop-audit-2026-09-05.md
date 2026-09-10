# BBPC slop audit — September 5, 2026

The most consequential problems are incomplete recording failure handling, hand-maintained contracts that bypass the shared types, and defensive limits that substitute for complete workflows. The clearest copy slop is the public MCP bio and implementation commentary throughout the admin app.

Scope: repository-wide inventory of 918 tracked files; targeted source review across all three apps, both shared packages, tests, CI, and developer documentation. Generated files and migration archives were not treated as hand-authored quality problems. This is an audit, not a rewrite. Runtime failure scenarios below are source-verified unless explicitly identified as executed; no real recordings or production rows were modified.

## Verification

| Check | Result |
|---|---|
| Node / pnpm | 22.22.3 / 10.32.1 |
| `pnpm run check` | Passed; 813 tests across the invoked suites |
| Backend coverage | 96.06% statements, 90.16% branches |
| Backend `package:check` | Passed; generated package consumer typecheck passed |
| Web lint | Passed with 8 warnings |
| Admin lint | Passed with 9 warnings |
| Recording lint | Failed with 5 errors |
| Application builds | Not run for this source audit |

Passing tests do not invalidate the findings: the important missing cases are upload recovery, reconnect admission, growth beyond caps, and actual UI interactions.

Visual coverage limitation: no application server was listening. Starting `pnpm dev:web` failed with `listen EPERM` on port 3000, and the escalation request was aborted. No rendered-page screenshots were captured, so this report makes source/copy findings and does not assign visual design grades. Authenticated admin and live recording flows were not exercised.

## Priority findings

### S01 · P1 · A failed recording upload loses the recovery path and hides its error

**Confidence: 10/10.** [useRecordingEngine.ts](../../apps/recording/src/hooks/useRecordingEngine.ts#L227) sets `isRecording: false`; lines 268–269 clear both chunk arrays. [DashboardHeader.tsx](../../apps/recording/src/components/DashboardHeader.tsx#L270) returns `finalStatus === 'done'`, but the stop caller at line 448 ignores it and retains no pending blobs. End Session proceeds at lines 474–480 even after failed uploads. Lines 624–639 render upload progress/error only inside the `recording.state.isRecording` branch, so the normal stopped state displays “Ready” instead. The error is also reset after three seconds.

**Impact:** A transient upload failure can leave no retry or local-download path while the interface implies readiness. This is the first repair to make.

**Change:** Retain pending tracks until successful upload or explicit disposal; offer retry and local download. Make upload state independent of recording state, and require confirmed persistence before completing the end-session workflow.

### S02 · P2 · Recording writes look successful when persistence fails

**Confidence: 9/10.** [useSessionSync.ts](../../apps/recording/src/hooks/useSessionSync.ts#L98) catches append failures and only calls `console.error`. [SessionProvider.tsx](../../apps/recording/src/components/SessionProvider.tsx#L137) has already applied `rawDispatch(action)`. Separately, [DashboardHeader.tsx](../../apps/recording/src/components/DashboardHeader.tsx#L105) saves episode/name edits using `fetch(...).catch(...)` without inspecting HTTP status, including the name save at line 131.

**Impact:** Rejected notes/cues appear saved, recording broadcasts can diverge across participants, and rejected names/titles remain visible locally. HTTP 403/500 responses do not enter those fetch catch handlers.

**Change:** Surface unsynced state, preserve retryable events, propagate failures, and inspect mutation/HTTP outcomes before committing or rolling back optimistic UI.

### S03 · P2 · The apps bypass the generated API contract

**Confidence: 10/10.** There are **248** `makeFunctionReference<...>` declarations across app source. For example, [ratings.ts](../../apps/admin/src/convex/ratings.ts#L20) manually defines endpoint strings, arguments, and `unknown` results. The only imports from `@tonyisup/bbpc-convex-api` in app source use the `/contracts` entry point for `BBPC_API_VERSION`; none imports the generated `api`.

**Impact:** Endpoint names and argument types can drift without a consumer compile failure. A package smoke consumer passes while the real apps continue maintaining their own parallel contracts. Runtime Zod validation catches some response drift only when a call executes.

**Change:** Use the package's generated references and derive argument/result types from them. Keep runtime validation where it serves a real external boundary; avoid manually maintaining a second internal API. Preserve version and environment guards.

### S04 · P2 · Some tests certify source wording instead of behavior

**Confidence: 10/10.** [ui-redesign-contract.test.mjs](../../apps/web/tests/ui-redesign-contract.test.mjs#L212) claims ranking candidates “submit once,” but checks strings such as `await upsertConvexMovieRankingItem`; it never submits or counts calls. [EpisodeRelationships.test.ts](../../apps/admin/src/components/Episode/EpisodeRelationships.test.ts#L15) claims the selected movie is saved before assignment creation, but checks component/function names and a placeholder.

**Impact:** Broken handlers can keep these tests green. Harmless renaming/refactoring can fail them. They create false confidence and make cleanup unnecessarily expensive.

**Change:** Render the relevant components and exercise selection, submit, ordering, failure, and duplicate-click paths. Keep source checks for genuine architecture constraints, such as preventing retired SQL imports; those have a different, valid purpose.

### S05 · P2 · The dashboard turns normal data growth into an outage

**Confidence: 10/10.** [dashboard.ts](../../packages/convex-backend/convex/admin/dashboard.ts#L64) reads seven tables into memory for counts and ten episodes' guess statistics. [limits.ts](../../packages/convex-backend/convex/admin/limits.ts#L2) caps users at 500 and movies/reviews at 3,000. The limit check at dashboard line 96 throws for the entire overview.

**Impact:** The 501st user or 3,001st movie can make the whole dashboard unavailable. Bounded reads are useful, but these bounds encode a product-size ceiling rather than a scalable query.

**Change:** Maintain count aggregates and query relationships for the displayed episodes through indexes. Keep each query bounded without making ordinary growth an error.

### S06 · P2 · Assignment selectors stop after the first page

**Confidence: 10/10.** [ConvexAssignmentDetailPage.tsx](../../apps/admin/src/components/Assignment/ConvexAssignmentDetailPage.tsx#L423) fetches only cursor `null` for users and seasons. Their page sizes are 50 and 30. It sets `selectorsIncomplete` and tells users at line 791 to use other tools when a record is missing, instead of allowing selection of later records.

**Impact:** Adding a review or guess becomes dependent on whether its user/season happens to be in the initial page. This is an incomplete workflow disguised by explanatory copy.

**Change:** Add server-backed searchable selectors or explicit pagination within the workflow. Do not replace the bounded backend queries with unlimited collection reads.

### S07 · P2 · Cleanup refuses the backlog it should clean

**Confidence: 9/10.** [rtc.ts](../../packages/convex-backend/convex/recording/rtc.ts#L514) reads up to 501 expired signals and throws before deleting any when the count exceeds 500. [sessions.ts](../../packages/convex-backend/convex/recording/sessions.ts#L916) similarly refuses session cleanup above 2,000 RTC child rows. No application or scheduler call to `cleanupRtcSession` was found; the retention path calls ended-session cleanup.

**Impact:** Historical signal accumulation eventually defeats normal cleanup. An administrator can manually choose smaller time windows, but routine retention does not make progress through the backlog.

**Change:** Delete bounded batches and schedule/continue subsequent batches. Preserve authorization and retention cutoffs; fix progress rather than raising safety limits indefinitely.

### S08 · P2 · CI omits app lint, hiding an existing failure

**Confidence: 10/10; executed.** [package.json](../../package.json#L15) runs app typechecks and tests but no app lint; [.github/workflows/ci.yml](../../.github/workflows/ci.yml#L33) uses that command. Running recording lint separately returns five errors: synchronous state writes in `SessionProvider.tsx:93` and `useMeshAudioRoom.ts:493`, and render-time `Date.now()` calls at lines 649, 655, and 656.

**Impact:** The advertised verification command passes while a configured application quality gate is red.

**Change:** Resolve the five errors, then include all app lint commands in root verification and CI. Do not suppress the rules simply to restore green output.

### S09 · P2 · Public host copy is six sections of generated praise

**Confidence: 10/10 on content; editorial judgment.** [about/mcp/page.tsx](../../apps/web/src/app/about/mcp/page.tsx#L9) explicitly identifies its source as ChatGPT's response to “describe me based on all our chats.” It contains “The Analytical Creator,” “The Inventive Aesthetician,” “The Entrepreneurial Architect,” and “Your Superpower?” with emoji headings and repeated praise. This is linked from the main About page, not an unreachable draft.

**Impact:** A visitor seeking a host bio gets a long personality appraisal addressed to “you,” with little useful information about the show. It breaks the more concrete voice of the main About page.

**Change:** Replace it with a short factual host bio using known facts: Tony/MCP's role, how he joined, and what he contributes to the podcast. If the generated profile is an intentional joke, label it as a separate bit and give the actual bio first.

### S10 · P2 · Admin copy reads like implementation acceptance notes

**Confidence: 10/10 on content; editorial judgment.** Examples include:

- [Dashboard error](../../apps/admin/src/components/Dashboard/ConvexAdminDashboard.tsx#L183): “No legacy SQL fallback was attempted.”
- [Point-type dialog](../../apps/admin/src/components/Game/ConvexGameConfigPage.tsx#L225): “migrated SQL SMALLINT range.”
- [Media detail](../../apps/admin/src/components/Media/ConvexMediaDetailPage.tsx#L243): “Bounded canonical assignment and extra-review links.”
- [Ratings](../../apps/admin/src/components/Rating/ConvexRatingsPage.tsx#L289): “Manage the bounded movie and show rating catalog.”

**Impact:** Routine tasks require admins to interpret backend architecture. The numeric dialog opens with implementation jargon even though it already provides the concrete range farther down.

**Change:** Use task language: “Couldn't load the dashboard. Try again,” “Enter a value between −32,768 and 32,767,” “Related episodes,” and “Manage movie and TV ratings.” Keep implementation details in logs and runbooks. The numeric range was checked against the backend validator.

### S11 · P3 · Retired components and unused packages remain in the live workspace

**Confidence: 9/10.** [MediaDetailPage.tsx](../../apps/admin/src/components/Media/MediaDetailPage.tsx#L35) is a 312-line old implementation with `reviews: any[]`; routes use `ConvexMediaDetailPage` and no importer of the old component was found. [SideBarProvider.tsx](../../apps/web/src/components/SideBarProvider.tsx#L5) is an unused async client component that still produces a lint warning. Both `src/hooks/use-mobile.tsx` and `src/components/hooks/use-mobile.ts` export unused implementations of the same hook.

No references outside the manifest were found for these web runtime dependencies: `@react-spring/web`, `pure-react-carousel`, `react-card-flip`, `react-responsive`, `react-tinder-card`, and `uuid`. The old `@types/uuid` entry also remains.

**Impact:** Unreachable code contributes warnings, misleading search results, duplicate patterns, and dependency maintenance. This is not evidence that the unused packages are shipped in browser bundles.

**Change:** Remove confirmed dead modules and unused direct dependencies through the root pnpm workspace, then rerun checks. Do not consolidate UI packages merely because multiple apps use similar primitives.

## Additional concrete defects

These are smaller independent repairs, not reasons for a broad rewrite.

| ID / priority | Evidence and consequence | Repair | Confidence |
|---|---|---|---|
| S12 / P2 | [Recording codec fallback](../../apps/recording/src/hooks/useRecordingEngine.ts#L33) negotiates Ogg/MP4, then lines 234–247 label all blobs `audio/webm`. The upload route also uses a `.webm` suffix and WebM metadata. Fallback bytes can be mislabeled. | Carry the actual recorder MIME type through capture, validation, filenames, and storage metadata. | 10/10 |
| S13 / P2 | [Engine teardown](../../apps/recording/src/hooks/useRecordingEngine.ts#L76) closes only the audio context and animation frame. The interval at line 186 uses `window.__recordingTimer`; owned mic tracks and recorders lack unmount cleanup. Client navigation during capture can leave resources active. | Use instance refs and one complete teardown routine, coordinated with pending-recording recovery. | 9/10 |
| S14 / P2 | [RTC admission](../../packages/convex-backend/convex/recording/rtc.ts#L152) checks capacity only for a missing row; heartbeat at line 241 revives stale rows. Four active users → one expires → replacement joins → old user resumes can create five active participants. | Recheck admission when reviving stale presence; add a reconnect-boundary test. This sequence was traced in source, not executed against a room. | 9/10 |
| S15 / P3 | [Query checker](../../packages/convex-backend/scripts/check-convex-queries.mjs#L65) flags every `.filter()` by name, including array filters. Meanwhile broad `.take()` scans pass. | Identify actual Convex query chains, so suppressions and diagnostics correspond to database risk. | 10/10 |
| S16 / P3 | [Recording README](../../apps/recording/README.md#L12) instructs root execution, then documents `pnpm run lint` and `pnpm run merge-session`, which root does not define. | Use root-safe `pnpm --filter bbpc-recording ...` commands or explicitly identify the app working directory. | 10/10 |

## What to preserve

The backend's access wrappers, target/environment checks, migration reconciliation, explicit errors, and substantial behavioral test suite have clear purposes. They should not be removed as “slop.” The shared movie-search-hints package has conformance fixtures and focused behavior tests; this audit found no comparably strong issue there. File length alone is not a finding, although the recording header's mixed responsibilities directly contribute to S01/S02.

## Cleanup order

1. Protect captured recordings and make save/upload failures visible (S01, S02, S12, S13).
2. Repair verification gaps and API contract integration (S03, S04, S08).
3. Complete bounded workflows and reconnect handling (S05, S06, S07, S14).
4. Replace filler copy, remove dead code/dependencies, and correct developer commands (S09–S11, S15, S16).

Quick wins: replace the migration jargon in admin copy, shorten the MCP bio, remove the confirmed dead components/hooks, correct README commands, and move upload status outside the recording-only branch. The status change is useful immediately but does not by itself fix lost-upload recovery.
