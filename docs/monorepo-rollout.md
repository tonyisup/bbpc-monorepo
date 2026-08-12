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

The original sibling checkouts remain untouched during rollout. Archive them only
after the canonical remote, CI, staging deployment, and three application deployments
have all been verified.

## CI and deployment ownership

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

Keep the existing Vercel projects and change only their repository and root directory:

| Vercel project | Root directory |
|---|---|
| Public web | `apps/web` |
| Admin | `apps/admin` |
| Recording | `apps/recording` |

Preserve each project's existing environment variables, domains, build settings, and
deployment protection. Preview all three applications from the monorepo before changing
their production branch.

## Rollout checklist

- [x] Import all four histories without squashing.
- [x] Establish the root pnpm workspace and internal contract dependency.
- [x] Move CI, staging deployment, and ownership controls to repository scope.
- [x] Leave the production Convex schema and public function API unchanged.
- [ ] Create or select the canonical private GitHub repository and push `main`.
- [ ] Recreate the protected `staging` environment and its existing secret on that
  repository.
- [ ] Require the root CI check and owner review on `main`.
- [ ] Point the three Vercel projects at the monorepo roots and verify previews.
- [ ] Verify a backend-only change performs the guarded staging deployment.
- [ ] Switch production branches, observe all applications, then archive the four
  legacy repositories as read-only.

## Rollback

Repository consolidation does not alter production data or deploy the Convex schema.
Before production project pointers change, rollback is simply to keep using the four
legacy repositories. After a Vercel project is repointed, restore its former repository
and production commit. If the staging workflow is misconfigured, disable it and restore
the former backend repository; never substitute a production deploy key. The imported
tip table above identifies the exact pre-consolidation source state.
