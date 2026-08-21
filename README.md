# BBPC monorepo

This workspace contains the BBPC web applications and their shared Convex backend.
The monorepo keeps application releases independent while making backend and client
contract changes atomic.

## Layout

| Path | Workspace | Purpose |
|---|---|---|
| `apps/web` | `bbpc` | Public BBPC site |
| `apps/admin` | `bbpc-admin` | Administrator application |
| `apps/recording` | `bbpc-recording` | Browser recording application |
| `packages/convex-backend` | `@tonyisup/bbpc-convex-api` | Convex schema, functions, migration tools, and generated client contract |
| `packages/movie-search-hints` | `@bbpc/movie-search-hints` | Shared movie-search query analysis, year-hint policy, and action helpers |

`bbpc-pipeline` remains a separate repository and consumes the deployed HTTP API. It
is not part of this consolidation milestone.

## Development

Use Node.js 22 or newer and install dependencies once from this directory:

```sh
pnpm install --frozen-lockfile
```

Copy the relevant `.env.example` into an app-local `.env.local`. Common commands:

```sh
pnpm run dev:web
pnpm run dev:admin
pnpm run dev:recording
pnpm run dev:backend
pnpm run check
pnpm run build
```

The consumers resolve `@tonyisup/bbpc-convex-api` directly from the workspace. The
package keeps its established import name to avoid unnecessary client churn, but it is
private and is no longer published to GitHub Packages.

## Deployment

- Vercel keeps one project per application, rooted at `apps/web`, `apps/admin`, and
  `apps/recording` respectively.
- The root CI workflow verifies the backend, all three applications, and the generated
  client contract from one lockfile.
- Only backend changes trigger the guarded Convex staging workflow. Production Convex
  deployment remains an explicitly authorized manual operation.
- Vercel Preview deployments for all three applications use the synthetic, writable S3
  Convex staging deployment. Their Production selectors remain separate and unchanged.

See [the rollout record](docs/monorepo-rollout.md) for history provenance, external
project settings, and rollback guidance.

Feature design records:

- [Movie-search release-year hints](docs/designs/movie-search-year-hint.md)
