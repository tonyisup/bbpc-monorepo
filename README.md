# BBPC Convex

Shared Convex backend and pinned multi-repository API contract for `bbpc`,
`bbpc-admin`, `bbpc-pipeline`, and later `bbpc-recording`.

The guarded SQL production clone remains the migration source of truth until cutover.
Production-derived extracts, staging rows, backups, checkpoints, and reconciliation
details never belong in this repository.

## Foundation invariants

- Missing `systemState` denies every application/domain write.
- Raw function constructors are imported only by `convex/functions.ts`.
- Every endpoint declares its access class through an approved builder.
- Every application write supplies the pinned client API version.
- Migration, control, application, user, admin, and service writes use distinct
  boundaries.
- Clerk issuer configuration is deployment-local; no provider key is committed.
- Public functions have argument and return validators.
- CI rejects unapproved `.collect()`, `.filter()`, and unclassified endpoint exports.

## Environments

| Environment | Convex target | State |
|---|---|---|
| local | `local-tonyisup-bbpc_convex` | developer-only |
| staging | project `bbpc-convex`, reference `staging` | deployed, uninitialized, writes denied |
| production | not provisioned for consumers | intentionally unavailable |

The staging deployment is synthetic-data-only. It uses a deployment-scoped key named
`github-actions-staging`; the key value belongs in the GitHub `staging` environment as
`CONVEX_STAGING_DEPLOY_KEY`.

## Local development

1. Use Node 22 and run `npm ci`.
2. Copy `.env.example` to `.env.local` or configure a Convex local deployment.
3. Set `CLERK_JWT_ISSUER_DOMAIN`, `BBPC_ENVIRONMENT`, and `BBPC_API_VERSION` on that
   deployment.
4. Run `npm run check && npm run package:check`.

Useful commands:

```sh
npm run dev
npm run check
npm run package:check
npm run migration:test:extractor
npm run migration:rehearse:local -- --help
npm run migration:backup:local -- --help
npm run migration:restore:local -- --help
npm run contract:generate
npm run contract:build
```

`contract:generate` uses Convex’s beta multi-repository API generator and excludes
internal functions. The package compiles that generated spec to ordinary JavaScript and
declarations; backend source and schema are not shipped.

## Identity migration rehearsal

The first checkpointed migration slice covers `User`, `Role`, and `UserRole` with
synthetic fixtures:

1. initialize the backend and enter S1;
2. create a fingerprinted identity migration run;
3. import raw users and roles into the deployment-local staging tables;
4. transform roles and users in bounded, resumable batches;
5. transform user-role links only after both parent checkpoints complete;
6. verify expected counts and mark the slice transformed.

Every transform function is internal-only and accepts writes only in S1/S2 for the
matching cutover run. Legacy IDs and normalized keys make retries idempotent; a mismatch,
duplicate normalized key, missing parent, stale checkpoint, or source-fingerprint drift
rolls back the entire batch. Legacy `impersonatedUserId` is checked only by the
aggregate probe and is never extracted or staged. Auth.js accounts, sessions,
verification tokens, and provider tokens are not staged at all.

One fingerprinted global migration run owns independent per-domain run records and
checkpoints. Completing the identity domain therefore does not incorrectly mark the
full migration transformed; later catalog, episode, review, game, ranking, and archive
domains join the same cutover run.

Identity also has an independent post-transform reconciliation pass. It re-normalizes
emails and role keys, re-derives administrator permissions, resolves both user-role
parents again, and compares canonical documents without repairing them. Only exact
field, relationship, and source-count agreement marks the identity domain reconciled.

## Catalog migration rehearsal

The second checkpointed slice covers `Movie`, `Show`, and `Tag`. It preserves every
legacy UUID and deliberately does not merge movies or shows whose normalized
title/year values match. Tags use the approved-candidate normalized key and fail the
transaction on a collision. SQL smallint/int ranges, UUIDs, and tag timestamps are
validated before canonical insertion.

Catalog transforms are internal-only, bounded to 100 rows per invocation, resumable by
legacy-ID checkpoint, and idempotent against matching canonical documents. Finishing
the catalog slice marks only its domain transformed while the shared migration run
remains open. Synthetic tests cover duplicate preservation, retries, rollback,
conflicts, corrupt state, and count reconciliation.

After transformation, a separate read/compare pass rescans every raw catalog row and
checks every canonical scalar and normalized key without repairing data. Its own
resumable checkpoints and expected counts must complete before the catalog domain moves
from `transformed` to `reconciled`; detected drift rolls back the verification batch.

## Episode migration rehearsal

The third checkpointed slice covers `Episode`, `Link`, `Banger`, and
`AudioEpisodeMessage` after the identity domain is transformed. It preserves SQL
calendar dates as `YYYY-MM-DD`, keeps external media as metadata, resolves every
non-null relationship through indexed legacy IDs, and rolls back a batch when a parent
is missing.

Episode slugs preserve their display value and add a normalized key to enforce the
source database’s case-insensitive uniqueness. UUID and SQL integer bounds, real
calendar dates, finite audio timestamps, dependency checkpoints, and final source
counts are validated transactionally. Numeric audio-message IDs use resumable numeric
cursors encoded in the shared checkpoint format.

The independent episode reconciliation pass rechecks every scalar, normalized slug,
and resolved user/episode relationship. Missing parents or canonical drift roll back
the verification batch, and exact per-table counts are required before the episode
domain becomes reconciled.

Production-derived staging is local-only and must be removed before the portable
canonical backup. Cloud staging continues to use synthetic fixtures only.

The local staging command verifies immutable manifests, checksums, row hashes, exact
field/table allowlists, unique legacy IDs, row counts, and private filesystem modes. It
is hard-wired to the Convex `local` deployment and requires explicit acknowledgement
before replacing the allowlisted `migrationRaw*` tables. This makes interrupted staging
repeatable without permitting an accidental cloud import.

## Assignment migration rehearsal

The fourth checkpointed slice covers `Assignment`, `AudioMessage`,
`AssignmentPoints`, and `Syllabus`. It starts only after identity, catalog, and
episodes are reconciled. Assignment, audio-message, and syllabus checkpoints form the
assignment-core barrier consumed by the later reviews slice.

Assignment point links intentionally wait for the `games.points` checkpoint. The
assignments domain remains `running` between those barriers, which breaks the broad
domain cycle without temporary IDs or nullable canonical relationships: reviews can
create assignment reviews, games can then create points, and assignment point links
can finally resolve both parents.

Display slugs are preserved with a normalized uniqueness key. Syllabus owner/order and
assignment/user/point relationship duplicates are rejected transactionally. The
independent reconciliation pass re-resolves every parent and compares every scalar
without repairing drift. The production-derived rehearsal reconciled all 709 assignment
domain rows.

## Review migration rehearsal

The fifth checkpointed slice covers `Rating`, `Review`, `AssignmentReview`, and
`ExtraReview`. It requires the assignment-core checkpoint rather than a finished
assignments domain, allowing review relationships to exist before game points unblock
assignment-point links.

The guarded aggregate probe found 981 movie reviews and 8 show reviews, with no missing
or dual targets and no duplicate assignment-review or extra-review relationships. The
transformer enforces those invariants and preserves both `ReviewdOn` and `reviewedOn` in
raw evidence. Canonical `reviewedAt` uses the approved
`reviewedOn ?? ReviewdOn` precedence; a conflicting pair fails the batch.

Review reconciliation independently re-resolves every user, movie/show, rating,
assignment, review, and episode parent. The production-derived rehearsal reconciled all
1,958 review domain rows.

## Game migration rehearsal

The game slice transforms `GameType`, `GamePointType`, `Season`, `Point`, `Guess`,
`GamblingType`, `GamblingPoints`, `TagVote`, and `QuoteSubmission` after identity and
reviews reconcile. Normalized lookup IDs remain unique, SQL numeric bounds are
enforced, season dates remain calendar strings, and nullable point adjustments stay
distinct from zero.

Completing `games.points` deliberately leaves the games domain `running`. That
checkpoint unlocks `AssignmentPoints`; the remaining five game checkpoints then
resolve assignment-review, point, season, episode, and user relationships. Historical
tag-vote award UUIDs that no longer reference a point become explicit
`legacyAwardTombstone` values during transform and reconciliation. The private source
archive retains the original UUIDs. The final portable scrub removes the UUID values
from canonical documents while retaining the non-rewardable tombstone marker.

An independent pass re-resolves every relationship and compares every mapped scalar
without repairing drift before the domain becomes reconciled. The guarded games
extractor reads all nine source tables in one serializable transaction and emits one
immutable local-only manifest. The production-derived rehearsal reconciled all 3,925
game domain rows.

## Ranking migration rehearsal

The ranking slice transforms `RankedListType`, `RankedList`, and `RankedItem` after
identity, catalog, and episodes reconcile. It accepts only the existing
`MOVIE`/`SHOW`/`EPISODE` type contract and `DRAFT`/`PUBLISHED` statuses, requires every
item to have exactly one target matching its owning list type, and enforces unique
list/rank slots within `1..maxItems`.

Independent reconciliation re-resolves every user, type, list, movie, show, and episode
relationship and detects scalar or ordering drift without repair. The guarded ranking
extractor captures all three tables in one serializable local-only snapshot. The
production-derived rehearsal reconciled all 23 ranking rows.

## Archive migration rehearsal

The archive slice preserves all 433 `Archive.Posts` rows after episodes reconcile,
including 327 nullable episode relationships and 106 intentionally unlinked posts.
Legacy SQL integer IDs remain indexed, `PostedOn` uses the approved UTC conversion
rule as other legacy timestamps, and empty content or title strings are retained
without normalization.

Its bounded transform and independent reconciliation pass detect missing episode
parents, source-count drift, invalid cursors, and canonical scalar or relationship
changes. The guarded extractor reads the archive table in one serializable local-only
snapshot. The production-derived rehearsal reconciled all 433 rows. Approved canonical
retention is backup-only, with no product-facing archive query.

## Raw-staging and portable scrubs

After identity, catalog, and episodes are each independently reconciled, an internal
`foundation-v1` scrub may remove their raw staging and migration checkpoints in bounded
batches. It records per-scope deletion totals, refuses to finish while any raw row or
checkpoint from any run remains, and retains canonical data, domain/run records, scrub
state, and audit evidence.

This is an intermediate data-minimization milestone, not the portable-backup gate.
The final `portable-v1` scrub requires all eight domains reconciled. It records a
zero-or-greater deletion result for every domain, removes all 31 raw staging tables
across every run, strips archive-only legacy tag-award UUIDs while retaining their
non-rewardable marker, then removes checkpoints, migration/domain/scrub records,
impersonation sessions, and service principals in bounded batches. Its final atomic
step writes audit evidence, removes its own scrub record, and deletes the local
`systemState`, restoring the backend's default-deny state before backup.

The portable table allowlist is schema-tested: canonical domain tables, approved auth
identities, and audit evidence are retained. Every other current table is explicitly
classified for deletion, and adding an unclassified table fails tests. The portable
scrub is intentionally one-way once `systemState` is removed and must not be executed
until the runbook's production-derived rehearsal and backup gate are approved.

The guarded local rehearsal is specified in
[`MIGRATION_REHEARSAL_RUNBOOK.md`](./MIGRATION_REHEARSAL_RUNBOOK.md). Its manifest-derived
86-step plan is checked against real function exports, initializes S1 before staging so
interruptions remain resumable, preserves raw document IDs after checkpoints begin, and
uses persisted domain/checkpoint progress to skip completed work. It stops with all
eight domains reconciled and raw evidence intact.

The first production-derived local result is recorded in
[`MIGRATION_REHEARSAL_RESULT_2026-07-24.md`](./MIGRATION_REHEARSAL_RESULT_2026-07-24.md).
It reconciled all 9,283 migrated rows across 62 completed checkpoints and records only
aggregate counts, timings, and defect dispositions.

The next one-way gate is implemented but not executed. The guarded backup command
resumes the final scrub, checks the portable ZIP allowlist/counts/hashes, and writes a
private manifest. Its companion restore command imports the unchanged ZIP into a
second disposable local backend, requires exact table hashes, and reruns all migration
and reconciliation operations with zero canonical inserts.

## Public episode read API

The first consumer-facing domain slice exposes anonymous, read-only episode functions:

- `episodes.public.latestPublished` takes an explicit `YYYY-MM-DD` bound so cached
  Convex queries never depend on the server wall clock, and explicitly supports the
  preserved `published`/`Published` spellings that SQL compared case-insensitively;
- `episodes.public.nextScheduled` chooses the highest-numbered `next` or `recording`
  episode through a compound index;
- `episodes.public.getBySlug` applies the approved trim/NFKC/lowercase lookup rule; and
- `episodes.public.getByLegacyId` supports the temporary SQL-UUID adapter path;
- `episodes.public.search` performs bounded full-text matching across episode and
  assigned-movie titles, de-duplicates canonical IDs, and preserves date-desc order; and
- `episodes.public.listPage` passes native Convex pagination options through unchanged.

The shared episode DTO contains the episode display fields, assignments, public user
name/image, movies, extras, shows, and links needed by the primary site. It deliberately
limits users to public name/image fields; the prior broad Prisma include also returned
identity fields such as email. Relationship fanout is bounded and missing canonical
parents fail closed instead of returning a partial graph.

Authenticated episode audio operations replace the primary app's owner-scoped Prisma
routes. `episodes.audio.listMine` uses native pagination over a compound
user/episode/created-at index, and `usageForEpisode` enforces the bounded 50-message
domain cap. `updateMine` and `deleteMine` derive ownership from Clerk identity, return
the same `NOT_FOUND` result for absent and non-owned rows, require S3 plus the pinned
client API version, and write cutover-scoped audit evidence.

Administrator episode operations provide exact ID/number reads, create/update
lifecycle mutations, bounded native audio-message pagination, link add/remove, and
administrator-authored audio metadata. Slugs use the legacy-compatible normalized
algorithm with bounded collision allocation, optional metadata can be explicitly
cleared, and transitions to `recording` or `published` transactionally lock pending
gambling entries. All writes require administrator access, S3/S4 application writes,
and the pinned client API version, and emit PII-free audit evidence. Hard episode
deletion remains deferred until its relationship-cascade contract is verified; remote
audio-file deletion remains deferred until it can use a durable external-effect intent.

## Public catalog read API

The local catalog read slice exposes anonymous exact-ID reads, bounded full-text title
search, exact four-digit year matching for movies, and native title/year pagination for
movies and shows. Search limits are validated from 1 through 20, blank searches return
no rows, and year/title matches are de-duplicated by canonical Convex ID without merging
the intentionally preserved catalog duplicates.

These functions read only the migrated local catalog.

Authenticated `catalog.external` actions provide bounded TMDB movie/show search and
detail lookups without depending on application write state. Searches normalize at most
200 characters, accept pages 1 through 500, return at most 20 typed results, and skip
the upstream call for a blank query. Requests use an eight-second timeout and translate
missing configuration, transport failures, rate limits, HTTP failures, invalid JSON,
TMDB error envelopes, and malformed records into bounded domain errors without exposing
the API key. Set `TMDB_API_KEY` as a Convex deployment environment variable; it is never
committed or returned to clients. An internal-only smoke action returns just page,
result-count, and first-ID-presence evidence, allowing upstream validation without a
linked Clerk subject or changes to preserved rehearsal data.

Authenticated `catalog.write` mutations preserve the legacy ranked-list workflow:
movie and show inputs are validated and upserted by an exact indexed URL match. Existing
imported duplicate URLs remain separate; an upsert updates one deterministic match and
never collapses rows. Administrator mutations can edit shows or delete unreferenced
movies and shows. Deletes inspect every canonical assignment, syllabus, review, and
ranked-list relationship through indexes and fail closed instead of orphaning data. All
writes require S3/S4, the pinned API version, and emit catalog-value-free audit evidence.

## Administrator identity read API

The admin slice now exposes administrator-only exact user and role reads, native
name-ordered user pagination, and the complete bounded role list. User DTOs include
admin-safe identity fields, resolved role memberships, the derived `isAdmin` flag, and
the highest unassigned syllabus entry with its movie title. `identity.roles.mine`
separately gives any authenticated user their own resolved memberships without exposing
the broader administrator surface.

Role membership hydration is limited to 50 entries per user and syllabus hydration to
100 entries per user; missing referenced roles or movies fail closed. Role summaries
inspect at most 101 memberships and return a capped `userCount` plus
`userCountIsExact`, so consumers never mistake a bounded count for an exact total.

Administrator mutations create and update normalized user profiles, switch users
between `active` and `disabled`, create/update/delete unassigned roles, and assign or
remove role memberships. The legacy hard user delete maps to `setUserStatus("disabled")`
so authentication stops without orphaning domain history, Clerk links, or immutable
audit evidence. Normalized email and role-name collisions fail transactionally, role
permissions are derived from the admin flag, and changes that would remove the final
active administrator are rejected. All identity mutations require administrator access,
S3/S4 application writes, and the pinned client API version, and emit PII-free audit
evidence.

## Quotabunga API

Authenticated members can read their current `next` or `recording` episode submission.
Only a `next` episode accepts writes, ownership is always derived from the linked Clerk
identity, and the mutation upserts at most one submission per user and episode. Scored
submissions cannot be edited or withdrawn. Member responses expose the public quote
fields and score state but never administrator notes.

Administrator operations provide bounded episode selectors, exact and per-episode reads,
submission creation and correction, moderation, seeded bracket ordering, placement
awards, and deletion. Only `INCLUDED` submissions can be randomized or awarded.
Randomization is deterministic for a caller-supplied normalized seed; placements are
unique and map to 40, 20, and 10 point events. Award creation, recalculation, clearing,
and quote updates happen atomically, and a quote refuses to alter or delete a point
shared by another relationship or owned by a different user or season.

Aggregate-only rehearsal inspection found two source submissions. Both are
`SUBMITTED`/`MOVIE` rows with clip metadata and listener notes, neither has a point, and
there are no duplicate user/episode or bracket/placement keys and no invalid placement
or clip-start values. Synthetic tests cover access/write gates, open-round ownership,
normalization, deterministic brackets, award recalculation and cleanup, relationship
corruption, audit privacy, and bounded reads.

## Ranked-list API

Authenticated users can list their own ranked lists, filter by target kind, read a list
they own, and create or edit lists through their Clerk-derived identity. Administrators
retain explicit oversight of any list, including filtered native pagination and owner
transfer. Type discovery is authenticated; type creation, constraint changes, and
deletion are administrator-only. A referenced type cannot change target kind, shrink
below an existing item, or be deleted.

Each item has exactly one movie, show, or episode target matching its list type. Ranks
and targets are unique per list and bounded by a 1–100 type capacity. Upserting an
existing target moves it and swaps an occupied destination back to the prior rank;
upserting a new target into an occupied rank replaces that slot. Single-item moves
shift the intervening range, while bulk reorder requires the complete, duplicate-free
current item set and writes dense ranks atomically. List deletion cascades through its
bounded items in the same transaction.

Aggregate-only rehearsal inspection found one movie-list type, three lists owned by
three users, and 19 movie items. The configured and observed maximum is 10 items; there
are no invalid statuses, target shapes, target/type combinations, ranks, duplicate
list/rank keys, or duplicate list/target keys. Synthetic tests cover owner/admin access,
write gates, target hydration, all ordering modes, filtering/pagination, type
constraints, capacity, cascade deletion, broken relationships, and audit privacy.

## Package consumers

TypeScript consumers pin an exact GitHub Packages release:

```ts
import { api } from "@tonyisup/bbpc-convex-api";
import {
  BBPC_API_VERSION,
  type DomainErrorData,
} from "@tonyisup/bbpc-convex-api/contracts";
```

The release tag must exactly match `v<package.json version>`. Staging deploy CI verifies
that the deployed public contract is identical to the committed artifact before a tag
may publish it. Previous compatible backend functions remain deployed until every
consumer has moved off the prior package.

## Deployment safety

`master` deploys only to the isolated staging reference after all checks pass. Production
has no workflow or key yet. Creating production, initializing `systemState`, or entering
S1–S4 requires the migration runbook and its explicit backup/reconciliation gates.
