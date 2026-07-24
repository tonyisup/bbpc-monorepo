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

Production-derived staging is local-only and must be removed before the portable
canonical backup. Cloud staging continues to use synthetic fixtures only.

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
