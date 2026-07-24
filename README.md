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
full migration transformed; later catalog, episode, review, game, and ranking domains
join the same cutover run.

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
without repairing drift. Its guarded extractor and immutable manifest support are
implemented but have not been run against production-derived rows.

## Review migration rehearsal

The fifth checkpointed slice covers `Rating`, `Review`, `AssignmentReview`, and
`ExtraReview`. It requires the assignment-core checkpoint rather than a finished
assignments domain, allowing review relationships to exist before game points unblock
assignment-point links.

The guarded aggregate probe found 981 movie reviews and 8 show reviews, with no missing
or dual targets and no duplicate assignment-review or extra-review relationships. The
transformer enforces those invariants and preserves both `ReviewdOn` and `reviewedOn` in
raw evidence. Canonical `reviewedAt` uses the pending recommended precedence only when
the source values are equal or one is null; a conflicting pair fails the batch.

Review reconciliation independently re-resolves every user, movie/show, rating,
assignment, review, and episode parent. Its guarded extractor and local manifest support
are implemented, but production-derived execution remains blocked on the timestamp and
normalization approval gate.

## Foundation raw-staging scrub

After identity, catalog, and episodes are each independently reconciled, an internal
`foundation-v1` scrub may remove their raw staging and migration checkpoints in bounded
batches. It records per-scope deletion totals, refuses to finish while any raw row or
checkpoint from any run remains, and retains canonical data, domain/run records, scrub
state, and audit evidence.

This is an intermediate data-minimization milestone, not the portable-backup gate.
Later domains must be migrated and reconciled before the final scrub removes all
migration/control metadata and a canonical backup may be approved.

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
