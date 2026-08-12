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

## Completed

### Consolidate BBPC into a monorepo after Convex migration stability

**Status:** Completed 2026-08-12. All four histories now live in the private
`tonyisup/bbpc-monorepo` pnpm workspace. Root CI and guarded Convex staging deployment
are green, the three Vercel production projects are cut over and healthy, and the three
superseded application repositories are archived. The production Convex deployment was
not changed. See [`docs/monorepo-rollout.md`](docs/monorepo-rollout.md).

**What:** Move `bbpc`, `bbpc-admin`, `bbpc-convex`, shared contracts, and
`bbpc-recording` into one workspace after the migration has stabilized.

**Why:** Remove the temporary package-publication hop and simplify atomic cross-project
changes without mixing repository restructuring into the database cutover.
