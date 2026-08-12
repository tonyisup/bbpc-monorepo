# BBPC monorepo rollout

Updated 2026-08-12.

## Decision

BBPC uses pnpm workspaces without an additional build orchestrator. The current graph
has only one shared package, so explicit root scripts keep build and deployment
behavior visible; an orchestrator can be added later if build caching becomes a
measured need.

pnpm's isolated dependency graph is important here: the Next.js 15 applications use
React 18 while the recording application uses Next.js 16 and React 19. Isolation keeps
each app's React peers local and prevents duplicate-React runtime failures without
forcing a framework upgrade into the repository move.

The repository layout is:

```text
apps/
  web/
  admin/
  recording/
packages/
  convex-backend/
```

The generated contract retains the import name `@tonyisup/bbpc-convex-api` so this
repository move does not also become an API rename. It is now a private workspace
package. The apps depend on workspace version `0.1.0`, which pnpm resolves locally,
and their write-gate version comes from its `contracts` export. The GitHub Packages
release workflow and registry configuration are retired.

## History provenance

The source histories were imported without squashing. Each import commit has the
original repository tip as a parent, so `git log --all` and `git blame` retain the
original commits.

| Destination | Source repository | Imported tip |
|---|---|---|
| `apps/web` | `tonyisup/bbpc` | `5ecd6ca927b06c0bc2d410bd5510405784faef86` |
| `apps/admin` | `tonyisup/bbpc-admin` | `e3dc01649e9213037a55563bb0139436f9229dba` |
| `packages/convex-backend` | `tonyisup/bbpc-convex` | `afd5d7c7596d9dba9e9b29e1ec4ccd28dbe01fc4` |
| `apps/recording` | `tonyisup/bbpc-recording` | `41424de9b9632792c9c8607d21f01b1b0006a038` |

The original sibling checkouts remain untouched as local rollback sources. The three
superseded application repositories are archived on GitHub after verification. The
former backend repository became the canonical monorepo, and its legacy `master`
branch remains available as a rollback source.

## CI and deployment ownership

The canonical private repository is
[`tonyisup/bbpc-monorepo`](https://github.com/tonyisup/bbpc-monorepo), with `main` as
its default branch.

`@tonyisup` owns the root lockfile, workspace manifest, application directories,
backend package, workflow files, and deployment checker scripts through `CODEOWNERS`.

The root CI workflow installs the single lockfile and runs:

1. the backend's complete check suite and generated-contract package check;
2. type checks and tests for the web, admin, and recording applications.

The Convex staging workflow keeps the existing `staging` GitHub environment,
`CONVEX_STAGING_DEPLOY_KEY` secret, expected staging deployment, forbidden production
deployment, and S2 invariant. It runs backend commands from
`packages/convex-backend` and is triggered only by backend or workspace dependency
changes.

The existing Vercel projects retain their environment variables and domains. They now
use the canonical repository with these roots:

| Vercel project | Root directory | Production domain |
|---|---|---|
| `bbpc` | `apps/web` | `badboyspodcast.com` |
| `bbpc-admin` | `apps/admin` | `admin.badboyspodcast.com` |
| `bbpc-recording` | `apps/recording` | `record.badboyspodcast.com` |

All three projects enable Corepack through `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel
honors the repository's pinned pnpm version. They also skip deployments when neither
their root nor a dependency changed.

## Production verification

Application commit `18cfbb4` produced ready production deployments for all three Vercel
projects. Each production domain returned HTTP 200 with the expected application, and
Vercel reported no runtime errors during the post-deploy observation window.

Root CI and the guarded Convex staging workflow passed. The staging workflow deployed
only to `merry-shepherd-928`, preserved its S2 invariant, and verified the public API
contract. The production Convex deployment `determined-wombat-872` was not deployed or
modified during this rollout.

## Rollout checklist

- [x] Import all four histories without squashing.
- [x] Establish the root pnpm workspace and internal contract dependency.
- [x] Move CI, staging deployment, and ownership controls to repository scope.
- [x] Leave the production Convex schema and public function API unchanged.
- [x] Create the canonical private GitHub repository and push `main`.
- [x] Preserve the protected `staging` environment and its existing secret on that
  repository.
- [x] Install root CI and `CODEOWNERS` on `main`.
- [ ] Enforce required CI and owner review if the GitHub account gains private-repository
  branch protection. GitHub rejected this setting on the current plan; repository
  privacy was not weakened to obtain it.
- [x] Point the three Vercel projects at the monorepo roots and verify production.
- [x] Verify a backend-only change performs the guarded staging deployment.
- [x] Observe all production applications, then archive the three superseded application
  repositories as read-only.

## Rollback

Repository consolidation does not alter production data or deploy the Convex schema.
To roll an application back, unarchive its former GitHub repository and reconnect its
Vercel project to the prior production commit. For the backend, the canonical repository
retains the legacy `master` branch and the untouched sibling checkout. If the staging
workflow is misconfigured, disable it and restore the former workflow; never substitute
a production deploy key. The imported-tip table above identifies the exact
pre-consolidation source state.
