# TODOS

## Infrastructure

### Evaluate media-storage consolidation after the Convex cutover

**What:** Measure whether Azure Blob and UploadThing should remain permanent media
stores or whether some assets should migrate to Convex file storage.

**Why:** Decide from real volume, traffic, cost, lifecycle, and recording requirements
whether consolidating storage would reduce operations or merely move working systems.

**Context:** The database migration intentionally keeps media binaries in their existing
stores while moving metadata, authorization, durable side-effect intents, retries, and
reconciliation into Convex. Start by inventorying object counts, sizes, URL compatibility,
egress/storage costs, backup expectations, and Convex file/bandwidth limits. An evaluation
may conclude that no migration is appropriate.

**Effort:** M
**Priority:** P4
**Depends on:** Stable core cutover, observed media costs, and the recording migration
design.

### Consolidate BBPC into a monorepo after Convex migration stability

**Status:** In progress. The local pnpm workspace, preserved histories, internal
contract dependency, and repository-level CI/deployment controls were assembled and
verified on 2026-08-12. Canonical GitHub and Vercel cutover steps remain; see
[`docs/monorepo-rollout.md`](docs/monorepo-rollout.md).

**What:** Move `bbpc`, `bbpc-admin`, `bbpc-convex`, shared contracts, and optionally
`bbpc-recording` into one workspace after the migration has stabilized.

**Why:** Remove the temporary package-publication hop and simplify atomic cross-project
changes without mixing repository restructuring into the database cutover.

**Context:** The shared backend is deliberately being built as a standalone sibling.
Its function names, DTOs, deployment ownership, and generated client contract must remain
portable to `packages/convex-backend`. Start by choosing a workspace/build system,
preserving repository history, and translating existing CI/deployment ownership without
changing the production Convex schema or API.

**Effort:** L
**Priority:** P3
**Depends on:** Stable post-cutover backend, substantial tRPC retirement, and a settled
recording migration.

## Completed
