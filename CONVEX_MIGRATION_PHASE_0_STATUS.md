# Convex Migration Phase −1 / Phase 0 Status

Updated 2026-07-24. This status report contains aggregate metadata only. The generated
census artifacts remain local and ignored under `bbpc-db/census/artifacts/`.

## Outcome So Far

Phase −1 is complete. It is implemented, verified locally, deployed from `bbpc-admin`
commit `93e2244`, and production-smoke-tested with an administrator session and an
isolated anonymous session.

The Phase 0 technical exit gate is complete against the SQL database verified as `dev`.
Machine-readable inventories exist for the live database, both Prisma consumers, all
application database operations, the Python pipeline, and the recording backend. Named
workflow baselines and canonical drift/duplicate decisions are recorded in
`CONVEX_MIGRATION_PHASE_0_DECISIONS.md`. Domain sign-off was recorded on 2026-07-24,
authorizing the production-derived local rehearsal while retaining separate
scrub/backup/cutover gates.

## Post-census implementation status

The standalone `bbpc-convex` backend now has a guarded local deployment and an isolated
named staging deployment. Its public API package, CI/deploy workflows, write-gate state
machine, Clerk boundary, service-principal boundary, and consumer fixture pass locally.
Publishing the repository and installing its staging-only GitHub environment secret
remain owner-approved actions.

All 34 SQL tables have an explicit disposition, all 31 migrated targets and their
minimum indexes are present in the Convex schema, and the mapping is checked in typed
tests. Synthetic end-to-end migration slices now cover users, roles, user-role links,
movies, shows, tags, episodes, links, bangers, episode-audio metadata, assignments,
assignment-audio metadata, syllabus entries, and assignment-point links with local-only
raw staging, bounded domain-scoped checkpoints, idempotent transforms, and batch
rollback tests. Review ratings, movie/show reviews, assignment-review links, and
extra-review links are also covered. The completed game slice transforms game types,
game-point types, seasons, points, guesses, gambling types and entries, tag votes, and
quote submissions. It retains the explicit `games.points` barrier, preserves all three
tag-vote award states—including historical dangling UUID tombstones—and finishes only
after all nine table checkpoints agree with source counts. Ranked-list types, lists,
and items are also covered with exact-one target, owning-type, rank-bound, capacity, and
unique list/rank enforcement. All archive posts are covered with nullable episode
resolution and exact scalar preservation; approved backup-only canonical storage is
implemented without a product-facing query. The catalog slice preserves
duplicate movie/show rows and
rejects normalized tag collisions transactionally. The episode slice enforces
identity-first ordering, indexed parent resolution, calendar-date preservation, and
normalized slug uniqueness. The assignment slice uses a table-checkpoint barrier:
assignment core rows
complete before reviews, while assignment-point links wait for `games.points`, avoiding
an artificial domain cycle without nullable canonical relationships. Guarded identity,
catalog, episode, assignment, review, atomic nine-table game, atomic three-table
ranking, and archive extractors are implemented and approved to run locally against
production-derived rows from the `dev` clone.

A shared immutable-manifest verifier and local-only staging command now cover all eight
extractable slices. They reject checksum, row-hash, run-ID, row-count, duplicate-ID,
field/table allowlist, and filesystem-permission drift before replacing an allowlisted
raw table in the explicitly selected Convex local deployment. The production-derived
rehearsal exercised all 31 allowlisted raw tables, including the zero-row-table path,
without sending row values outside the private local environment.

Catalog, identity, episodes, assignments, reviews, games, rankings, and archive now have
independent, checkpointed post-transform reconciliation passes. They rescan raw rows,
compare canonical scalar, normalized, derived-permission, and relationship fields without
repairing them, roll back on drift or missing parents, and mark only their own domain
reconciled after exact source-count agreement.

A bounded `foundation-v1` raw-staging scrub is implemented and synthetic-tested. It
requires all three current domains reconciled, deletes only their raw staging and
migration checkpoints, refuses completion if any current- or other-run staging remains,
and retains canonical plus audit/run evidence. It is explicitly an intermediate
data-minimization milestone, not authorization for the final portable backup. The final
`portable-v1` scrub is now also implemented and synthetic-tested across all 31 raw
tables. It requires all eight domains reconciled and explicit per-domain scrub evidence,
then removes all migration metadata, impersonation sessions, service principals, its
own scrub state, and local `systemState` while retaining canonical data, approved auth
identities, and audit evidence. A schema-wide retain/scrub classification test prevents
new tables from silently entering the portable backup. The final scrub has not been
executed. A guarded fresh-local rehearsal command now derives an 86-step execution DAG
from all eight verified manifests, validates every planned Convex export, initializes
S1 before staging, and resumes interrupted work from persisted domain/checkpoint state.
The first production-derived local rehearsal passed on 2026-07-24. All 9,283 migrated
rows reconciled across eight domains and 62 completed checkpoints with zero running
checkpoints or unexplained mismatches. Two encountered defects and one proactively
identified cursor-safety defect were fixed with regression coverage. Raw staging,
checkpoints, migration records, and S1 control state remain intact; the one-way
portable scrub has not run. Guarded backup tooling is now prepared and dry-run verified:
it requires separate one-way scrub and private-backup acknowledgements, validates the
31-table/9,283-row canonical allowlist, exports a local snapshot, and records only
aggregate counts and hashes. Companion restore tooling is prepared to import that
untouched snapshot into a second disposable local deployment, compare per-table
content hashes, rerun the full transform/reconciliation acceptance path with zero
new inserts, and delete the disposable deployment before writing success evidence.

Independent consumer-readiness work has started without crossing the portable scrub
gate. The first public episode read slice now provides indexed latest-published,
next-scheduled, normalized-slug, and native paginated detail queries through the shared
package contract. Public user data is limited to name/image, relationship fanout is
bounded, and missing parents fail closed. A production-derived aggregate smoke traversed
all 634 episodes in 13 pages and hydrated exactly 308 assignments, 390 extras, and 14
links, matching the source manifests. It found and fixed a SQL-collation compatibility
issue: legacy rows use `published` while a Prisma query requested `Published`; the
Convex function explicitly supports both case-preserved spellings. Bounded episode and
assigned-movie title search plus normalized legacy-ID lookup are also implemented;
private production-derived round-trips matched canonical IDs without emitting values.

The local public catalog slice is also implemented through the shared contract with
exact-ID reads, bounded full-text title search, movie year matching, de-duplication by
canonical ID, and native title/year pagination. Its aggregate production-derived smoke
traversed all 1,494 movies and 6 shows and confirmed private title/year round-trips
without emitting catalog values.

Clerk bootstrap is now implemented through the shared contract. Ordinary first-use
linking remains disabled until S3/S4 and requires a verified email. It claims exactly
one active unlinked migrated candidate or creates a new ordinary canonical user when no
candidate exists; duplicate, disabled, reused-subject, and already-claimed state fails
closed. Separate internal, run-scoped S1/S2 mutations pre-provision approved smoke users
by exact legacy ID and matching verified email, plus a bounded least-privilege pipeline
principal. Both paths are idempotent and their audit evidence excludes email, subject,
and token values. Thirteen focused security tests cover gate timing, versioning,
conflicts, administrator preservation, least privilege, and audit redaction.

Authenticated catalog mutations now preserve the legacy ranked-list workflow by
upserting validated movies and shows through an exact indexed URL match. Imported
duplicate URLs remain separate, while each upsert updates at most one deterministic
match. Administrator-only show edits and safe movie/show deletes are also implemented.
Deletes inspect every assignment, syllabus, review, and ranked-list relationship through
indexes and fail closed instead of orphaning data. All writes are S3/S4 plus API-version
gated and produce audit evidence without catalog values.

Authenticated read-only TMDB actions now provide bounded movie/show search and detail
lookups independently of application write state. Queries, pages, result counts, and
timeouts are bounded; responses are reduced to typed compatibility DTOs; and missing
configuration, transport/HTTP failures, rate limits, invalid JSON, TMDB error envelopes,
and malformed records fail through safe domain errors without exposing the API key.
Mocked transport tests cover the full action contract. `TMDB_API_KEY` still needs to be
set in the local/staging Convex deployment before the real smoke gate. An internal-only
probe is ready to return aggregate page/count/ID-presence evidence without requiring a
temporary identity link or changing preserved rehearsal data.

Assignment administration and owner-safe syllabus workflows are now available through
the shared contract. Administrator functions provide exact and native-paginated
assignment reads, bounded episode hydration, strict assignment types, legacy-compatible
collision-safe slugs, and safe deletion that refuses every indexed dependency.
Authenticated syllabus functions derive ownership from Clerk, preserve the canonical
pending-before-assigned order, support `TOP`, `AFTER_NEXT`, and `END` insertion, require
a complete pending-item set for reorders, normalize dense order atomically, and enforce
per-user capacity and note limits. Administrator syllabus operations paginate by indexed
creation time, reuse the exact user/movie/episode assignment triple, repair missing
slugs, assign or unlink episodes, and normalize order in the same transaction. All
writes remain S3/S4 plus API-version gated and audit without titles, notes, names, or
emails. Synthetic coverage includes access gates, collisions, dependency failures,
ownership isolation, all insertion positions, complete-order validation, assignment
reuse/repair, concurrent additions, and capacity boundaries.

Ratings and review workflows complete the non-game portion of the workflow domain.
Anonymous consumers can read the bounded rating catalog by ID or value, while
administrator-only mutations validate the SQL `TINYINT` range, normalize optional
metadata, and refuse deletion while a review or guess still references the rating.
Self-service movie/show extras derive the reviewer from Clerk and cannot nominate
another user. Administrator review operations enforce exactly one movie/show target,
derive an assignment review's movie from the assignment, provide indexed filtered
pagination, update or clear ratings, and remove reviews through a bounded atomic cascade
of extra links, assignment links, and guesses. Removing only an assignment-review link
fails closed while guesses exist. All writes are S3/S4 plus API-version gated and emit
value-free audit records. Synthetic tests cover public/admin/owner access, target and
parent validation, filtered/native pagination, dependency-safe deletion, bounded
cascades, fanout limits, assignment-link safety, actor derivation, and concurrent
self-service submissions. The game-domain workflows are recorded below.

The game-domain application layer has its first guarded checkpoint. Anonymous consumers
can resolve the newest active season from an explicit `YYYY-MM-DD` input, including
overlapping seasons, without nondeterministic wall-clock access in a Convex query.
Authenticated consumers can read the canonical WTFIR scoring values. Administrator
functions now provide bounded game-type and game-point-type catalogs, normalized lookup
CRUD, SQL `SMALLINT` point validation, native season pagination, exact season reads, and
exactness-labeled bounded relationship counts. Season writes require real calendar
dates and valid ranges; game configuration and season deletion fail closed while any
indexed canonical relationship remains. All writes are S3/S4 plus API-version gated
and produce value-free audit records. Synthetic tests cover access and write gates,
normalization collisions, nullable updates, safe deletion, deterministic current-season
selection, pagination limits, relationship counts, and scoring lookup.

Point-event administration is also implemented through the shared contract. Admins can
create manual, lookup-derived, and assignment-linked events; update nullable reason,
adjustment, type, and earned time; read exact detail; paginate by user or season; and
calculate bounded user or multi-assignment totals. Point adjustments enforce the
authoritative nullable SQL `INT` decision. Missing lookup IDs or current seasons fail
explicitly rather than creating untyped or mis-scoped rows. Assignment links are
duplicate-safe and idempotently removable. Deleting a point atomically removes its
assignment links and clears guess, gambling-award, live tag-award, and quote-award
relationships through dedicated indexes and bounded fanout; historical tag tombstones
remain untouched. Authenticated available-point reads derive the Clerk user and deduct
only pending/locked wagers, while anonymous current-performance reads return bounded
chronological events and descending public-user totals. Synthetic tests cover arithmetic,
all/current/explicit season selection, native pagination, lookup/default paths, link
invariants, broken relationships, authorization/write gates, and the complete deletion
cascade.

Guess workflows are now implemented through the shared contract. Authenticated members
submit against an open playable/`next` assignment, select only a host with an existing
assignment review, resolve the current season from an explicit date, and upsert one
guess per user/host review while deriving ownership from Clerk. Owner reads support one
or a bounded distinct set of assignments without exposing another member's guesses.
Administrator operations provide exact and native-paginated reads, direct and batched
upserts, rating edits, validated point attachment, default or explicit point awards,
single deletion that preserves accounting events, and assignment/user cleanup that
deletes only truly orphaned award points. Point links must match the guess user and
season, and all relationship scans are index-backed and bounded. Synthetic tests cover
authorization/write gates, open-round rules, invalid hosts and seasons, idempotent
resubmission, ownership isolation, batch uniqueness, pagination, point invariants,
value-free audit records, broken relationships, and shared-versus-orphan award cleanup.

Gambling workflows are now implemented through the shared contract. Anonymous consumers
can read active wager types, while authenticated members derive ownership from Clerk,
use an explicit date for current-season resolution, and transactionally upsert one
pending row per canonical user/season/type/assignment/target key. New wagers require an
active type, non-negative SQL `INT` points, an open playable/`next` round when assigned,
and exact target shape: `-1x` types require a host with an assignment review and all
other types forbid a target. Point availability and all pending/locked wagers are read
inside the same Convex transaction, preventing concurrent overspend.

Administrator operations provide normalized gambling-type CRUD, native-paginated user
and type reads, bounded assignment reads, direct wager creation, balance-aware point
updates, manual award linkage, typed status transitions, win/loss settlement, and
pending-only deletion. Won awards use `floor(points * multiplier)` and loss awards use
`-points`; changing a resolved status safely replaces only an award point owned solely
by that wager, and changing wager size recalculates its award. Aggregate-only rehearsal
inspection found zero invalid canonical keys, statuses, target shapes, negative values,
or missing seasons in all 74 imported rows. It also confirmed preserved legacy drift:
27 lost rows have no award and 13 won awards contain stale adjustments. Explicit
same-status settlement repairs missing awards, and point updates repair stale
adjustments without rewriting the imported rehearsal data. Synthetic tests cover
authorization/write gates, public visibility, key idempotency, serial concurrent
budgets, round/host/type validation, pagination, status/award transitions, referenced
type deletion, malformed historical rows, PII-free audits, and shared-point safety.

Tag workflows are now implemented through the shared contract as the fifth game
checkpoint. The deliberately retired primary-app tag discovery/voting surface remains
archive-only. Administrator functions provide normalized bounded catalog CRUD, exact
and native-paginated vote reads, user and TMDB filters, deletion that preserves point
events, and current-season `tag-vote` point creation for only genuinely unawarded rows.
Historical markers remain non-rewardable and their UUIDs are omitted from all API
responses. Aggregate-only inspection of 2,194 rows found 2 unawarded, 2,192 historical
dangling awards, no invalid TMDB IDs, and no duplicate canonical
`(user, tmdbId, normalizedTag)` keys. The prepared portable scrub now strips those
2,192 UUIDs from canonical documents after raw archival staging is removed, while
retaining the marker and restore-safe reconciliation semantics. Synthetic tests cover
access/write gates, normalization, capacity, pagination, relationship hydration,
archived-marker redaction, award idempotency, bounded reasons, retained accounting,
audit privacy, portable scrubbing, and restored reconciliation.

Quotabunga is now the sixth game checkpoint. Members derive ownership from Clerk, read
the newest `next` or `recording` episode, and can upsert or withdraw one submission only
while that episode is `next`; scored rows are immutable through the member surface and
administrator notes never leave the administrator contract. Administrator functions
provide bounded episode and submission reads, correction and moderation, deterministic
seeded ordering of `INCLUDED` rows, and atomic placement awards worth 40/20/10 points.
Re-awarding recalculates owned points and clears prior placements not selected in the
same transaction; missing, shared, cross-user, or cross-season award relationships fail
closed. Aggregate-only inspection found 2 source rows, both `SUBMITTED`/`MOVIE`, both
with clip metadata and listener notes, neither scored, and no duplicate user/episode,
point, bracket, or placement keys or invalid placement/clip-start values. Synthetic
tests cover access/write gates, open-round ownership, optional fields, deterministic
brackets, award replacement and cleanup, relationship corruption, bounded reads, and
PII/value-free audits.

Ranked lists complete the seventh T10 checkpoint. Authenticated owners can create,
filter, read, update, and delete lists through Clerk-derived identity; administrators
retain any-list access, filtered native pagination, type administration, and owner
transfer. Each item has exactly one movie, show, or episode target matching its type,
and both ranks and targets are unique and bounded per list. Existing-target upserts swap
an occupied destination, new targets replace an occupied slot, single moves shift the
intervening interval, and bulk reorders require the complete current item set before
assigning dense ranks atomically. Type target changes, capacity shrinkage, and deletion
fail closed when they would invalidate referenced data; list deletion cascades through
bounded items. Aggregate inspection found 1 movie type, 3 owners/lists, and 19 movie
items, a configured/observed maximum of 10, and no invalid status, target, rank,
duplicate-rank, or duplicate-target state. Synthetic tests cover owner/admin and write
gates, all three target kinds, ordering, filtering/pagination, capacity, cascades,
broken relationships, and value-free audits. T10 is complete.

Authenticated episode audio metadata reads/updates/deletes are now implemented behind
the shared contract. They derive ownership from the linked Clerk identity, paginate on
a compound user/episode/time index, enforce a bounded 50-message usage cap, conceal
non-owned rows as `NOT_FOUND`, require S3 and the pinned API version for writes, and
emit cutover-scoped audit evidence. Synthetic tests cover the authorization and write
gate because the preserved S1 rehearsal correctly has writes disabled and no linked
Clerk subjects.

Administrator identity reads are now available through the shared contract. Admin-only
functions provide name-ordered user pagination, exact user/role reads, resolved role
memberships and admin status, bounded next-syllabus hydration, and capped role user
counts that explicitly report whether the count is exact. Authenticated users can read
only their own role memberships. Synthetic authorization, pagination, nullable-field,
limit, and broken-reference tests cover this slice because the preserved S1 rehearsal
contains no linked administrator subject.

Administrator identity writes now cover normalized user creation/update, active/disabled
status, role creation/update/deletion, and role assignment/removal. The legacy hard user
delete is intentionally adapted to disable the canonical account so domain history,
Clerk linkage evidence, and immutable audit attribution remain intact. Every mutation is
administrator-only, S3/S4 plus API-version gated, audited without profile PII, bounded
to the established role limits, and prevents removal of the final active administrator.

Administrator episode reads and writes now cover exact ID/number lookup, creation,
lifecycle and nullable-metadata updates, bounded slug-collision allocation, native
audio-message pagination, link add/remove, and administrator-authored audio metadata.
Transitions to `recording` or `published` lock all bounded pending gambling entries in
the same transaction. Every mutation is administrator-only, S3/S4 plus API-version
gated, and emits PII-free audit evidence. Synthetic tests cover authorization,
validation, missing-reference, capacity, audit, and transactional-lock behavior. Hard
episode deletion awaits its verified cascade contract, and remote audio-file deletion
awaits a durable external-effect intent.

## Phase −1 Authorization

- 189 `bbpc-admin` tRPC procedures are in the generated authorization matrix:
  165 administrator, 23 authenticated/self-service, and 1 public.
- `auth.getSession` is the only public procedure.
- No mutation is public.
- User, role, points, gambling, guesses, content administration, destructive operations,
  uploads, and external-effect triggers now require an administrator.
- Authenticated non-admin access is limited to ranked-list self-service, the catalog
  lookup needed by that workflow, the current-season read, and existing recording-guest
  reads.
- Anonymous, ordinary-user, and administrator middleware regression tests pass.
- Guest/list screens now defer protected queries until a session exists and do not issue
  admin-only recording queries for guests.
- The production build succeeds. A localhost production-server smoke test returned 200
  for anonymous session discovery and 401 for both an anonymous administrator mutation
  and an anonymous protected ranked-list query.
- Commit `93e2244` was pushed directly to `bbpc-admin` `master` on 2026-07-23. Vercel
  reported the production deployment completed successfully.
- Production read-only smoke checks loaded the administrator dashboard, users, roles,
  ranked lists, and recording studio without console errors. An isolated anonymous
  session saw only the sign-in surfaces, could not access ranked lists, and was redirected
  away from the protected recording-guest route.
- The recording `guest=true` path intentionally means an authenticated non-administrator;
  its full real-identity workflow remains part of later acceptance testing, while the
  Phase −1 authorization gate is covered by the ordinary-user middleware regression
  tests.

Source: `bbpc-admin/docs/AUTHORIZATION_MATRIX.md`.

## Database Census

The guarded tool verified `SQL_DATABASE=dev` before connection and `DB_NAME()=dev` after
connection. It uses read-only intent and rejects statements other than `SELECT`, `WITH`,
or session-level `SET`.

Aggregate inventory:

- 34 tables: 33 in `dbo` plus `Archive.Posts`.
- 220 columns, 103 indexes, 55 foreign keys, and 4 check constraints.
- 5 views and 2 stored procedures.
- 9,510 rows and approximately 14.2 MiB reserved across all tables.
- 0 orphan rows across all declared foreign keys.
- 0 values above the 750 KB warning threshold and 0 above 1 MB.
- 5 columns contain normalized duplicate candidates, totaling 313 rows beyond the first
  normalized value. These are review candidates rather than presumed corruption:
  account providers, episode/movie titles, movie URLs, and verification identifiers can
  have domain-specific duplicate semantics. No values were retained.

All 34 live table names match the checked-in SQL table sources when the archive schema is
included. All 7 live programmable objects match the expected five views and two stored
procedures by name.

## Schema Drift

Both Prisma schemas differ from live introspection. The exact local-only patches are in
the ignored census artifact directory.

Semantic items to resolve in target-model review:

- `Point.adjustment` is SQL `INT` in the live clone and SQL project, while both Prisma
  schemas declare `@db.SmallInt`.
- `QuoteSubmission.pointId` has a live and checked-in filtered unique index for non-null
  values. Prisma introspection cannot represent that filtered uniqueness and therefore
  reports a one-to-many relation; the Convex model must preserve the intended non-null
  one-to-one rule explicitly.
- `TagVote.pointId` is a scalar without a live/checked-in foreign key. `bbpc-admin`
  declares a `Point` relation that `bbpc` and the database do not have.
- The two consumers use many different Prisma relation-field names. Those are code
  contract differences, not separate database structures, and must be normalized in the
  canonical Convex DTO/API mapping rather than copied blindly.

Explicit native annotations for `nvarchar(1000)`, `datetime2`, and default `NO ACTION`
referential behavior account for several introspection-only formatting differences.

## Operation Census

The source-only census found:

- 39 tRPC routers and 273 tRPC procedures.
- 11 HTTP/API routes.
- 47 direct TypeScript database-access sites outside router/API directories.
- 71 Python SQL connection/query sites.
- 30 existing `bbpc-recording` Convex functions.
- 45 checked-in SQL artifacts.
- 477 total operation/artifact records.

Every record has an owning project/component and a proposed migration disposition.
Every generated record remains marked for domain review; the census does not silently
turn an inferred disposition into an approved decision.

## Performance Baseline

The initial connection/size probe measured `COUNT_BIG` across all 34 tables at roughly
29.4 ms p50, 32.9 ms p95, and 34.0 ms p99 from this development machine.

Query Store was enabled and yielded 84 query hashes with aggregate p50/p95/p99 interval
timings without retaining SQL text. The slowest observed maximum among those aggregates
was approximately 374 ms.

Six named representative workloads now have sequential p50/p95/p99, payload-size, and
one-way/four-way concurrency measurements. The sequential p95 range is approximately
30.5–92.1 ms and the four-way request p95 range is approximately 31.3–344.6 ms. The
episode archive is the first explicit pagination/response-budget target. These numbers
complete the Phase 0 baseline, but they remain comparison inputs rather than production
SLOs.

## Remaining Gates

1. Obtain domain-owner sign-off on the recorded anomaly and operation rules before
   promoting the Phase 2 production-derived transform.
2. Exercise the authenticated non-administrator ranked-list and recording-guest paths
   during full consumer acceptance.

Phase 1 implementation may now begin. Phase 2 promotion remains gated on domain sign-off.
