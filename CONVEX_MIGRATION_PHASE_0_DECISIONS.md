# Convex Migration Phase 0 Decisions

Updated 2026-07-24. This report contains aggregate metadata only. Production-derived
row values remain in the guarded local clone and are not retained here.

## Phase 0 Technical Exit

The technical Phase 0 exit gate is complete:

- The live `dev` clone has a stable source fingerprint.
- All 34 live tables, 7 programmable objects, constraints, indexes, relationships,
  sizes, duplicate candidates, declared orphans, and large-value boundaries are
  inventoried.
- All 477 application operations and SQL artifacts have an owner and migration
  disposition.
- Six named representative workloads have sequential and four-way-concurrency latency,
  row-count, and payload-size baselines.
- The census validator passes and confirms that generated artifacts contain no loaded
  environment values.

Domain sign-off was recorded on 2026-07-24. The operation dispositions and canonical
anomaly rules below are approved together with the timestamp, review precedence,
normalization, and backup-only archive decisions in
`bbpc-convex/MIGRATION_MAPPING_DRAFT.md`. This authorizes the production-derived local
rehearsal, but not the portable scrub, cloud staging, backup promotion, or cutover.

## Operation Dispositions

The generated operation census is accepted as the exhaustive source inventory. Its
disposition groups resolve as follows:

| Count | Generated disposition | Canonical treatment |
|---:|---|---|
| 245 | `migrate-to-convex` | Implement in the owning Convex capability and retain observable contracts until the adapter is retired. |
| 71 | `replace-with-Clerk-M2M-Convex-HTTP-call` | Replace Python SQL access with least-privilege pipeline service functions; no SQL fallback. |
| 47 | `migrate-to-convex-or-remove-duplicate-access` | Move behavior into one capability function; remove duplicate direct Prisma access after adapter parity. |
| 34 | `map-to-Convex-schema` | Map every SQL table explicitly; identity/session tables may be retired or transformed as described below. |
| 30 | `retain-temporarily; consolidate-into-shared-backend-in-Phase-8` | Keep the recording deployment until the core cutover stabilizes, then transform into the shared backend. |
| 13 | `migrate-domain-state; wrap-external-effect-in-durable-intent` | Persist domain state and an idempotent effect intent before dispatching external work. |
| 11 | `reimplement-or-retire-after-production-census` | Reimplement two procedures and five views as capability operations; retire the four SQL security artifacts after cutover evidence is archived. |
| 6 | `replace-with-clerk-and-convex-identity` | Retire Auth.js account/session/token state and link Clerk subjects to canonical users. |
| 20 | `retain-or-refactor-after-domain-review` | Keep tRPC routes as temporary adapters, retire sample restricted routes, retain external catalog lookups behind bounded actions, and consolidate scoring helpers into canonical game functions. |

Specific ambiguous cases:

- `AddVoteForFeature` and `SubmitGuess` become transactional Convex mutations.
- `AssignmentRatings`, `EpisodeMovies`, `MovieReviews`, `NextEpisode`, and
  `NextFullEpisode` become indexed queries or rebuildable summaries if measured budgets
  require materialization.
- Both `/api/trpc` routes remain only while compatibility adapters exist.
- The sample `/api/restricted` routes are retired.
- Movie/show title and search calls remain bounded external catalog actions; durable
  intents are required only when a remote side effect is created.
- Movie/show URL upserts remain authenticated because they are part of the ranked-list
  self-service workflow. Show edits and catalog deletion remain administrator-only;
  deletion fails closed on canonical references. An upsert may update one deterministic
  exact-URL match but never collapses imported duplicate rows.
- Direct SSR, slug, point, prediction, and upload database helpers move behind the same
  capability functions used by public APIs.
- The administrator `user.remove` adapter disables the canonical user instead of
  deleting it. This preserves domain history, Clerk-link evidence, and immutable audit
  attribution while enforcing the intended loss of account access. Role deletion remains
  available only for roles with no memberships.

### Clerk identity bootstrap

Ordinary first-use linking is an application write and remains unavailable until S3.
A verified Clerk email may claim exactly one active canonical user with the same
normalized email only when that user has no identity link. No match creates a new
ordinary user; duplicate candidates, disabled users, unverified email, reused subjects,
and already-claimed users fail closed. During S1/S2, internal run-scoped operations may
pre-provision only the named smoke users by exact migrated legacy ID and matching
verified email, plus the bounded least-privilege pipeline principal. All bootstrap
operations are idempotent and omit email, subject, and token values from audit evidence.

## Duplicate Semantics

No duplicate candidate is automatically merged or rejected:

| Candidate | Decision |
|---|---|
| `Account.provider` | Expected repetition under the unique `(provider, providerAccountId)` pair. The table is retired after Clerk linking. |
| `Episode.title` | Titles are display data and may repeat. `legacyId` and the existing non-null unique slug identify records. |
| `Movie.title` | Titles may repeat across releases and legacy catalog entries. Preserve every row and `legacyId`; normalized title is a search key, not a unique key. |
| `Movie.url` | The live database does not declare uniqueness. Preserve every row; do not merge by URL. |
| `VerificationToken.identifier` | Expected repetition across tokens. Verification tokens are not migrated. |

Any later deduplication is a separate domain cleanup with explicit merge records; it is
not part of the data migration.

## Schema Drift Decisions

### `Point.adjustment`

The authoritative SQL type is nullable `INT`. The target is an optional integer-valued
Convex number with:

- finite, safe-integer validation;
- SQL `INT` import bounds (`-2,147,483,648` through `2,147,483,647`);
- explicit preservation of `null` versus zero during import;
- narrower domain validation on individual write operations where their rules demand it.

The Prisma `SmallInt` annotation is not copied.

### `QuoteSubmission.pointId`

This is a real optional SQL foreign key plus a filtered unique index. The target keeps an
optional `Id<"points">`, an index by point, and a mutation-time uniqueness check for every
non-null value. The import resolves the SQL UUID through `points.legacyId` and fails
reconciliation on zero, multiple, or reused matches.

### Quotabunga workflow

Canonical self-service ownership comes only from the linked Clerk identity. One
submission is allowed per user and episode; self-service writes are open only for the
`next` episode, and a scored submission cannot be edited or withdrawn. Administrator
moderation can include or reject rows, order included rows deterministically from an
explicit seed, and award unique first/second/third placements worth 40/20/10 points.
Award creation, replacement, clearing, and quote updates are one transaction. An award
point must be owned solely by that quote and match its user and season; otherwise the
operation fails closed.

### Ranked-list workflow

Canonical ownership comes from Clerk. Owners manage their lists; administrators have
explicit cross-owner read/write and transfer operations. Every item has exactly one
target matching its list type, and list/rank plus list/target keys are unique. Moving an
existing target through upsert swaps an occupied destination, single-item moves shift
the interval, and bulk reorder is accepted only as a complete set. Referenced types
cannot change target kind, shrink below current data, or be deleted; list deletion
cascades its bounded items transactionally.

### `TagVote.pointId`

This field is not a live or checked-in foreign key. The guarded logical-relation census
found 2,192 populated values and 2,192 unresolved values. Application code nevertheless
uses non-nullness as “points already awarded.”

The target therefore models the behavior explicitly:

- `pending`: no award marker and no linked point;
- `awarded`: a new or resolved award with a real `Id<"points">`;
- `legacyAwardTombstone`: the source contained a non-null historical UUID that no longer
  resolves, so the vote remains non-rewardable without fabricating a point.

The original UUID is retained through transform/reconciliation and in the private source
archive, but it is backup-only rather than product data. The one-way portable scrub
removes it from canonical documents while retaining the tombstone marker, and restored
reconciliation accepts that scrubbed marker because the source archive is independently
hash-verified. Future explicit point deletion follows current application behavior by
clearing a live award link transactionally; historical tombstones remain closed.

## Named SQL Baseline

Client-observed measurements from the `dev` clone:

| Workload | Sequential p50/p95/p99 | Payload | Four-way request p95 |
|---|---:|---:|---:|
| `public.latestEpisodeGraph` | 30.576 / 32.392 / 32.412 ms | 942 B | 113.058 ms |
| `public.episodeArchivePage` | 63.320 / 92.139 / 92.631 ms | 12,038 B | 344.582 ms |
| `admin.dashboard` | 31.034 / 33.322 / 34.201 ms | 197 B | 126.700 ms |
| `member.rankedLists` | 29.782 / 30.492 / 33.222 ms | 6,817 B | 31.322 ms |
| `pipeline.episodeBundle` | 30.561 / 39.658 / 48.919 ms | 684 B | 156.891 ms |
| `member.currentSeasonPoints` | 29.285 / 33.789 / 47.187 ms | 81 B | 79.721 ms |

These are comparison inputs rather than production SLOs. Convex target budgets are
declared per function and tested on production-scale fixtures; the episode archive is
the first measured candidate for explicit pagination and response budgeting.

## Phase 1 Inputs

- Initial data volume is approximately 14.2 MiB across 9,510 rows, so a normal Convex
  project is sufficient for foundation and rehearsal work. Final production plan/cost
  selection still uses observed traffic and rehearsal metrics.
- The backend must be default-deny before `systemState` initialization.
- Raw public builders are restricted to the boundary module; exported operations declare
  one access class.
- Clerk issuer configuration is deployment-local and required at deploy time.
- Production-derived extraction and staging remain local-only; cloud staging uses
  synthetic fixtures.
