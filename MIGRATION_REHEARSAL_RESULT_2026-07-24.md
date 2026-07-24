# Production-Derived Local Rehearsal Result — 2026-07-24

Status: **passed through reconciliation; portable scrub not executed**

This record contains aggregate evidence only. Production-derived row values remain in
the ignored, private local extraction directory and local Convex deployment.

## Run identity

- Run ID: `dev-rehearsal-20260724-01`
- SQL source: guarded read-only clone named exactly `dev`
- Source schema fingerprint:
  `5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a`
- Convex API version: `0.1.0`
- Mapping approval commit: `30a5449`
- Production-scale resume fixes: `3f16962`
- Aggregate evidence query: `95636b6`
- Final stage: S1, application writes disabled

SQL was never mutated. Production-derived rows were never sent to cloud staging,
production, CI, Git, tickets, screenshots, or chat.

## Reconciliation counts

| Domain | Canonical rows independently reconciled |
|---|---:|
| identity | 40 |
| catalog | 1,507 |
| episodes | 688 |
| assignments | 709 |
| reviews | 1,958 |
| games | 3,925 |
| rankings | 23 |
| archive (backup-only) | 433 |
| **Total** | **9,283** |

The aggregate evidence query reported:

- all 8 domains `reconciled`;
- 62 of 62 transform/reconciliation checkpoints complete;
- 0 running checkpoints;
- 18,566 rows processed: 9,283 canonical inserts plus 9,283 independent
  reconciliation matches; and
- zero count, scalar, relationship, normalized-key, or approved anomaly mismatches.

No transformation reject or collision was produced. Retired Auth.js account, session,
verification-token, provider-token, and legacy impersonation state was not extracted.

## Timing evidence

The migration run spanned 537.049 seconds, including two defect investigations and
checkpoint-safe restarts. Domain wall-clock intervals were:

| Domain | Elapsed |
|---|---:|
| identity | 7.423 s |
| catalog | 61.039 s |
| episodes | 31.202 s |
| assignments | 123.198 s |
| reviews | 77.218 s |
| games | 181.007 s |
| rankings | 7.388 s |
| archive | 18.325 s |

Assignment elapsed time includes its deliberate pause across the review/game dependency
barrier. These are correctness-run measurements, not production SLOs; the next clean
rehearsal will provide steady-state timing evidence.

## Defects found and retained regression coverage

1. Convex rejected a newline-only JSONL file for a zero-row table. Zero-row replacement
   now uses a private temporary empty JSON array; nonempty tables continue to import
   their verified immutable JSONL.
2. The episode prerequisite accepted only `transformed` identity state, even though
   `reconciled` is stronger. The shared prerequisite now accepts both and has an
   explicit regression test.
3. Resume review found that replacing raw staging after checkpoints begin would change
   raw Convex document IDs and invalidate stored cursors. Resume now replaces all raw
   staging only before any domain/checkpoint progress exists; afterward it preserves
   raw IDs and skips completed operations from persisted progress.

The full post-fix gate passed: typecheck, lint, query/access audits, 56 local
extractor/staging/planner tests, 112 Convex tests, package contract, and 90.08% branch
coverage.

## Post-rehearsal public episode read smoke

The first consumer-facing episode read slice was deployed only to the preserved local
backend and exercised against the migrated dataset. An aggregate-only traversal
completed all 13 pagination requests and hydrated exactly 634 episodes, 308 assignments,
390 extra reviews, and 14 episode links. Those totals match the independently verified
source manifests, and no missing parent or relationship-fanout guard fired.

The smoke check found that all 633 completed episodes store status `published`, while
the legacy Prisma call requested `Published`. SQL's case-insensitive comparison hid that
difference; Convex index equality does not. `latestPublished` now checks both preserved
legacy spellings, with regression coverage. Aggregate smoke checks then confirmed a
latest episode, a next episode, and a normalized slug round-trip without emitting row
values.

The public catalog read slice then traversed 15 movie pages and one show page, returning
exactly 1,494 movies and 6 shows. Private title and year round-trips matched their
original canonical IDs for both catalog types; only totals and match booleans were
emitted. Private episode-title, assigned-movie-title, and normalized legacy-ID
round-trips also matched their original canonical episode IDs. The expanded gate passes
238 Convex tests with 90.14% branch coverage. Owner-scoped episode audio metadata
operations are covered synthetically because the preserved S1 rehearsal intentionally
keeps application mutations disabled and contains no linked Clerk identities.
Administrator identity reads are likewise covered synthetically: the preserved data has
no linked administrator subject, while the regression suite exercises admin-only user
pagination and exact lookup, resolved roles, bounded next-syllabus hydration, capped
role counts, ordinary-user self-role reads, and all limit and missing-reference failures.
Administrator identity mutations are covered synthetically as well. Their suite verifies
S3/version/administrator gating, normalized user and role uniqueness, bounded role
membership writes, PII-free audit records, safe role deletion, non-destructive user
disablement, and prevention of final-administrator lockout.
Administrator episode operations are also covered synthetically. Their suite verifies
exact reads, bounded slug-collision allocation, lifecycle and nullable-metadata updates,
transactional pending-gambling locks, link and audio-message limits, broken-reference
failures, administrator authorization, write/version gates, and PII-free audit records.
Hard episode deletion and remote audio-file effects remain outside this checkpoint.
Catalog writes are covered synthetically as well. The suite preserves authenticated
movie/show URL upserts without collapsing imported duplicates, validates normalized
catalog fields, keeps administrative edits/deletes administrator-only, rejects every
canonical relationship before deletion, and confirms value-free audit records.
TMDB search/detail actions are covered with mocked transport because the local Convex
deployment does not yet contain `TMDB_API_KEY`. Their suite verifies authentication
without a write-state dependency, bounded search/page/result limits, typed movie/show
mapping, timeouts, HTTP and rate-limit translation, missing configuration, invalid JSON,
TMDB error envelopes, and malformed records. A real smoke call remains pending secret
configuration.
Assignment and syllabus application workflows are covered synthetically without
changing the preserved S1 dataset. The suite verifies administrator and owner access
classification, S3/API-version gates, legacy-compatible slug allocation and explicit
slug updates, strict assignment types, indexed dependency-safe deletion, canonical
pending-before-assigned syllabus order, all three insertion positions, complete-set
reordering, owner isolation, note normalization, exact assignment reuse and missing-slug
repair, indexed/native pagination, concurrent owner additions, and the 100-entry
capacity. The regenerated shared package contract and its fixture consumer type-check.
Rating and review application workflows are also covered synthetically. Anonymous
rating reads, administrator rating CRUD, SQL `TINYINT` validation, and indexed
review/guess deletion guards are exercised. Review coverage verifies Clerk-derived
self-service actors, exact movie/show target shape, assignment-derived movies,
rating/user compound-index filters, native relationship pagination, explicit rating
clear, bounded atomic review/assignment/extra/guess deletion semantics, relationship
fanout failures, and concurrent extra submissions. Guess submission and award workflows
are covered by the game-domain checkpoints below; gambling remains pending.
The first game-application checkpoint is also covered synthetically. Anonymous
current-season reads accept an explicit plain date instead of reading wall-clock time
inside a query, choose the newest overlapping active season, ignore undated legacy
rows, and fail closed at a bounded inspection limit. Administrator game-type,
game-point-type, and season operations normalize lookup IDs, enforce SQL `SMALLINT`
point values and real calendar dates, use native pagination and exactness-labeled
bounded relationship counts, and refuse deletion while indexed relationships remain.
Authenticated prediction scoring resolves the three canonical WTFIR point types without
exposing configuration writes. All mutations remain S3/S4 plus API-version gated and
emit value-free audit records.
Point-event administration is now covered synthetically as a second game checkpoint.
Administrator operations create manual, lookup-based, and assignment-linked events;
update nullable reason, adjustment, type, and earned-time fields; paginate by user or
season; calculate bounded all/current/explicit-season and multi-assignment totals; and
idempotently link or unlink assignments. Adjustments enforce the authoritative nullable
SQL `INT` contract, and lookup/current-season failures are explicit instead of silently
creating ambiguous rows. Point deletion transactionally removes assignment links and
clears guess, gambling-award, live tag-award, and quote-award relationships through
dedicated indexes and bounded fanout. Authenticated availability subtracts only pending
and locked wagers for the selected season, while anonymous current performance returns
bounded chronological points and descending public-user totals. Broken relationships,
budget inputs, access/write gates, aggregate arithmetic, overlapping season selection,
and the full deletion cascade have regression coverage.
Guess workflows are covered synthetically as the third game checkpoint. Authenticated
submissions derive the user from Clerk, require a playable assignment whose episode is
`next`, validate the nominated host through the assignment-review relationship, resolve
the season from an explicit date, and idempotently update the one user/host-review row.
Owner reads support one or a bounded distinct assignment set without cross-user
disclosure. Administrator functions provide exact and native-paginated reads, direct
and host-batched upserts, rating updates, validated point attachment, default or
explicit point awards, and two intentional deletion modes: single-row deletion keeps
the accounting event, while assignment/user cleanup removes award points only after
their final guess reference disappears. Point user/season mismatches, locked rounds,
invalid hosts, duplicate rows and batch inputs, missing canonical relationships,
value-free audit records, shared awards, and orphan cleanup all have regression
coverage.
Gambling workflows are covered synthetically as the fourth game checkpoint. Public
queries return active types only. Authenticated submissions derive the user from Clerk,
resolve the season from an explicit date, require non-negative SQL `INT` points, enforce
the same playable/`next` assignment rule as guesses, validate `-1x` targets through an
assignment review, and upsert one user/season/type/assignment/target key. Available
points and pending/locked wagers are evaluated in the same Convex transaction, including
the concurrent-write regression that permits only one of two collectively
over-budget wagers.

Administrator functions cover normalized, dependency-safe type CRUD; exact and
native-paginated entry reads; balance-aware creation and point changes; manual award
links; pending-only deletion; typed statuses; and win/loss settlement. Win awards use
`floor(points * multiplier)`, losses use `-points`, resolved point changes recalculate
their award, and status replacement refuses to delete a point shared by another
relationship. Aggregate-only inspection of the private 74-row rehearsal set found zero
duplicate canonical keys, negative values, missing seasons, unsupported statuses,
target-shape violations, or targets without assignments. It also documented preserved
legacy state rather than rewriting it: 27 lost entries have no linked award and 13 won
awards have adjustments stale relative to their current wager. Same-status settlement
can repair a missing resolved award, and an explicit point update repairs stale award
arithmetic. Authorization/write gates, round/target/type failures, owner isolation,
serial budgets, pagination, malformed relationships, PII-free audits, and award
ownership all have regression coverage. Tag, quote, and ranking workflows remain in
T10.

## Preserved gate

Raw staging, checkpoints, migration records, and S1 control state remain intact. The
one-way `portable-v1` scrub has not run. The guarded portable snapshot and disposable
restore tooling is ready; executing the scrub, backup, and restored-data acceptance
remains the next separately approved gate.
