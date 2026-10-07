# BBPC monorepo

This workspace contains the BBPC web applications, their shared Convex backend, and
the podcast content pipeline.
The monorepo keeps application releases independent while making backend and client
contract changes atomic.

## Layout

| Path | Workspace | Purpose |
|---|---|---|
| `apps/web` | `bbpc` | Public BBPC site |
| `apps/admin` | `bbpc-admin` | Administrator application |
| `apps/recording` | `bbpc-recording` | Browser recording application |
| `apps/pipeline` | (Python, not a workspace package) | Local episode pipeline: transcription, transcript import, clips, thumbnails, SEO publishing |
| `packages/convex-backend` | `@tonyisup/bbpc-convex-api` | Convex schema, functions, migration tools, and generated client contract |
| `packages/episode-search` | `@bbpc/episode-search` | Shared episode metadata matching, transcript search requests, and result merging |
| `packages/movie-search-hints` | `@bbpc/movie-search-hints` | Shared movie-search query analysis, year-hint policy, and action helpers |
| `packages/youtube` | `@bbpc/youtube` | Shared YouTube IFrame player loader and clip link helpers |

`apps/pipeline` is a Python operator tool run by hand on the podcast Mac. It has no
`package.json`, so pnpm, the root scripts, and Vercel ignore it; its own
[README](apps/pipeline/README.md) covers setup. It consumes the deployed service API and
calls this checkout's transcript importer, and it keeps episodes, transcripts, output,
and its `.env` outside the repository in `BBPC_PIPELINE_DATA_DIR`.

## Development

Use Node.js 22.6.0 or newer and install dependencies once from this directory:

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
- A separate Pipeline workflow runs the pipeline's pytest suite on macOS when
  `apps/pipeline` changes. The pipeline is never deployed.
- Only backend changes trigger the guarded Convex staging workflow. Production Convex
  deployment remains an explicitly authorized manual operation.
- Vercel Preview deployments for all three applications use the synthetic, writable S3
  Convex staging deployment. Their Production selectors remain separate and unchanged.

See [the rollout record](docs/monorepo-rollout.md) for history provenance, external
project settings, and rollback guidance.

Feature design records:

- [Movie-search release-year hints](docs/designs/movie-search-year-hint.md)
- [Quotabunga quote player and Quote Finder](docs/designs/quotabunga-quote-player.md)
- [Quote Finder assistant](docs/designs/quote-finder-assistant.md)
