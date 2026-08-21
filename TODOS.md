# TODOS

## Infrastructure

### Establish authenticated browser E2E coverage for public and admin journeys

**What:** Add a reusable Playwright harness for authenticated flows across the public
and admin applications, starting with movie-search focus, keyboard, timing, and
responsive-layout behavior.

**Why:** Replace manual-only browser verification with deterministic regression coverage
for interactions that component tests cannot fully reproduce against the real DOM.

**Context:** The movie-search year-hint design deliberately uses focused Vitest component
tests plus a manual browser pass rather than expanding that feature branch into general
test infrastructure. The admin app already declares Playwright packages, but the
repository has no Playwright configuration, test script, authentication fixture, local
server orchestration, or deterministic Convex/TMDB response layer. Start by defining
test identities and service fixtures, then prove one cross-app authenticated journey
before broadening coverage.

**Effort:** L
**Priority:** P3
**Depends on:** Deterministic test authentication, local app startup orchestration, and
fixture-backed or mocked Convex and TMDB responses

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

**Status:** Completed 2026-08-12. All four histories now live in the public
`tonyisup/bbpc-monorepo` pnpm workspace. Root CI and guarded Convex staging deployment
are green, the three Vercel production projects are cut over and healthy, and the three
superseded application repositories are archived. The production Convex deployment was
not changed. See [`docs/monorepo-rollout.md`](docs/monorepo-rollout.md).

**What:** Move `bbpc`, `bbpc-admin`, `bbpc-convex`, shared contracts, and
`bbpc-recording` into one workspace after the migration has stabilized.

**Why:** Remove the temporary package-publication hop and simplify atomic cross-project
changes without mixing repository restructuring into the database cutover.
