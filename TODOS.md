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

## Games

### Return lean projections from the member season point and wager reads

**What:** Replace per-row `hydratePointMemberActivity` and `hydrateGamblingEntry` in
`games.member.mySeasonPointsPage` and `mySeasonWagers` with projections that load the
member, season, game type, and point types once and share assignment, movie, and episode
lookups across rows.

**Why:** Each row costs about fifteen database calls, so a member with roughly 270
wagers in one season would hit the per-function call budget before the 500-entry app
guard fires, and a 100-point page costs about 1,500 calls for rows that share the same
user and season.

**Context:** Raised by the ship review of the profile seasons work. The season page only
renders a handful of fields per row.

**Effort:** M
**Priority:** P2
**Depends on:** Nothing

### Store final standings when a season ends

**What:** Persist each member's final rank and player count when an administrator ends a
season, and have `games.member.mySeasonStanding` read the stored value for ended seasons.

**Why:** The profile fires one season-wide read (up to 2,000 points) per past season on
every visit to show "Finished Nth of M"; the answer never changes once a season ends.

**Context:** Raised by the ship review of the profile seasons work. Keep the live
computation for the current season and as a fallback for undated seasons.

**Effort:** M
**Priority:** P2
**Depends on:** A season-end transition in the admin season editor

### Derive an episode's Quotabunga season from the episode, not the client date

**What:** Resolve the season for a quote submission from the episode's own date instead
of the caller's `today` in `games.quotes.submitMine`.

**Why:** The first submitter's client date fixes the season for every later entry and
its placement points, so a member sending a past date can file an episode under a prior
season.

**Context:** Pre-existing behaviour surfaced by the ship review. Episodes are not linked
to seasons; `resolveQuoteSeasonForEpisode` inherits from the earliest submission.

**Effort:** S
**Priority:** P3
**Depends on:** Every episode that accepts quotes having a date

### Share one round-clock hook between the prediction and Quotabunga panels

**What:** Extract the `predictionWindow` subscription, the ticking `now`, and the
countdown formatter used by both `ConvexPredictionGame` and `ConvexQuotabungaSubmission`
into one hook, and consider the shared recharts theme and Pacific-day formatter too.

**Why:** Both panels sit on the same page and each runs its own one-second timer and
subscription; a change to the lock behaviour has to be made twice.

**Context:** Raised by the ship review of the Quotabunga round-window fix.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

### Retire `games.quotes.currentForMe` after the web deploy lands

**What:** Remove the current-entry query, its README paragraph, and its tests once no
deployed web client calls it.

**Why:** The web moved to `mineForEpisode`; the old query stays only for clients
deployed before 2026-09-25.

**Context:** Deploy order for that change is backend first, then web.

**Effort:** S
**Priority:** P3
**Depends on:** The profile seasons web deploy

### Budget the profile season list across many seasons

**What:** Give `games.member.mySeasons` a lifetime document budget that leaves a season
row blank instead of failing the whole query when a member's history across up to 100
seasons approaches the scanned-document limit.

**Why:** Each season is bounded separately, but all of them run in one transaction, so
a very long history could still fail the entire list with a platform error rather than a
domain conflict.

**Context:** Raised by the ship adversarial review; unreachable at current volumes.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

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
