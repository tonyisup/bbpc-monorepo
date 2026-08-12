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
269 Convex tests with 96.44% statement and 90.15% branch coverage. Owner-scoped episode
audio metadata
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
are covered by the game-domain checkpoints below.
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
ownership all have regression coverage.

Tag administration is the fifth game checkpoint. The public/member tag experience was
deliberately retired from `bbpc` and remains archive-only. Administrator functions
provide normalized catalog CRUD, exact and native-paginated vote reads, user/TMDB
filters, bounded hydration, safe vote deletion that preserves accounting events, and
current-season `tag-vote` point application for genuinely unawarded rows. Archived
award markers cannot be rewarded again, and their source UUIDs never appear in the
application contract. Aggregate-only inspection confirmed 2,194 rows, 2 unawarded,
2,192 historical markers, no invalid TMDB IDs, and no duplicate canonical vote keys.
The portable scrub now removes the 2,192 dangling UUID values from canonical documents
after raw archive deletion while retaining the non-rewardable marker; restored
reconciliation explicitly accepts that scrubbed state.

Quotabunga is covered synthetically as the sixth game checkpoint. Member operations
derive ownership from Clerk, expose the newest `next`/`recording` submission without
administrator notes, and permit one upsert or withdrawal only while the episode is
`next`; scored rows are immutable through that surface. Administrator operations cover
bounded reads and corrections, moderation, deterministic caller-seeded bracket order,
and atomic unique 40/20/10 placement awards. Re-awarding recalculates owned points and
clears omitted prior awards, while missing, shared, cross-user, and cross-season point
relationships fail closed. Aggregate-only inspection of the private source found two
clean `SUBMITTED`/`MOVIE` rows with clip metadata and listener notes, neither scored,
and no duplicate user/episode, point, bracket, or placement keys or invalid
placement/clip-start values.

Ranked lists complete the seventh and final T10 checkpoint. Authenticated owners can
create, filter, read, update, and delete their own lists, while administrators retain
explicit any-list access, filtered native pagination, type administration, and owner
transfer. Every item has exactly one movie, show, or episode target matching its type,
with unique bounded ranks and targets. Existing-target upserts swap occupied ranks, new
targets replace occupied slots, single moves shift the intervening interval, and bulk
reorders require the complete current item set before atomically assigning dense ranks.
Referenced type changes and deletes fail closed, as do missing parents, malformed
targets, duplicate ranks/targets, and oversized collections. Aggregate-only inspection
confirmed one movie type, three owners/lists, and 19 movie items, with a configured and
observed maximum of 10 and no constraint violations. Owner/admin access, all three
target kinds, ordering semantics, pagination, capacities, cascades, corruption, and
value-free audits have synthetic coverage.

Clerk bootstrap behavior is covered synthetically without changing the preserved S1
dataset. Ordinary first-use linking is unavailable before S3/S4, requires a verified
email, links exactly one active unclaimed migrated candidate or creates an ordinary user
when no candidate exists, and rejects duplicate, disabled, reused-subject, or
already-claimed state. S1/S2-only internal operations pre-provision exact smoke users and
the bounded least-privilege pipeline principal. Both paths are idempotent and emit audit
evidence without email, subject, or token values.

## Whole-system offline acceptance

The final offline matrix on 2026-07-24 passed without changing the preserved migrated
dataset:

- `bbpc`: 50 tests, strict TypeScript, lint with no errors, and successful SQL-default
  and Convex-mode production builds with all 659 static pages generated;
- `bbpc-admin`: 81 tests, strict TypeScript, the 189-procedure authorization inventory,
  lint with no errors, and successful builds in both modes with all 26 static pages
  generated;
- `bbpc-convex`: 310 tests, 56 local migration-extractor tests, query/access audits,
  TypeScript, lint, and the six-file package contract plus consumer typecheck; and
- `bbpc-pipeline`: 134 tests plus 15 subtests, entry-point compilation, and no
  application SQL or `pyodbc` dependency.

The Convex-mode frontend builds used a syntactically valid, non-live Clerk
publishable-key fixture supplied only through their process environments. This proves
static compilation and backend-selector isolation, not live authentication.

An aggregate-only local control query initially reconfirmed exactly one S1 system state
for this run, application writes disabled, no recorded first application write, and zero
service principals. The pipeline now has a read-only M2M readiness probe that validates
the JWT's issuer, subject, configured receiver-machine audience, and expiry; derives the
canonical Convex token identifier; and never prints the token, machine secret, unrelated
claims, or migrated row fields.

## Live Clerk pipeline identity acceptance — 2026-07-25

The pipeline source machine is now scoped one way to a dedicated Convex receiver
machine. Convex keeps the human Clerk audience separate from the pipeline receiver
audience. The real JWT issuer and subject were pre-provisioned into the preserved local
clone with exactly `pipeline:publish`; replay returned the existing principal rather
than creating a duplicate.

Value-free live probes established:

- the capability query succeeded with exactly the expected permission;
- an aggregate date traversal returned 630 dates;
- an exact episode-context read succeeded and reported two related movies;
- unauthenticated capability access was denied;
- the service token failed closed at the administrator identity boundary;
- a valid Clerk JWT scoped only to a temporary wrong receiver was rejected with HTTP
  401, after which both temporary probe machines were removed and the real scope was
  reconfirmed;
- an expired JWT was rejected with HTTP 401;
- disabling the principal denied a still-valid JWT, and re-enabling it restored access;
  and
- an application mutation was rejected with `WRITE_DISABLED` at S1.

The final aggregate identity query reports one active run-matching principal with one
permission, one pre-provision audit, two valid disable/re-enable audit transitions,
application writes disabled, and no first application write. No JWT, secret, identity
claim value, audit row, episode value, or movie value was emitted.

The live read exposed one client-contract defect: Convex JSON numbers arrive as
JavaScript-compatible numeric values, including integral floats. The Python validator
now accepts only finite integral values inside the JavaScript safe-integer range and
still rejects booleans, fractional values, non-finite values, and unsafe integers. A
thumbnail unit test was also isolated from live poster lookup after real credentials
made its implicit network dependency visible. The post-fix gates pass 310 Convex tests,
56 extractor tests, 134 pipeline tests plus 15 subtests, package consumer typecheck,
entry-point compilation, and the zero-SQL dependency scan.

The positive idempotent pipeline application mutation remains intentionally unexecuted:
the preserved S1 gate must not be opened before the separately approved S3 transition.

## Preserved gate

Raw staging, checkpoints, migration records, and S1 control state remain intact. The
one-way `portable-v1` scrub has not run. The guarded portable snapshot and disposable
restore tooling is ready; executing the scrub, backup, and restored-data acceptance
remains the next separately approved gate.
