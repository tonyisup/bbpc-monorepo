# BBPC Convex Migration Assessment

## Goal

Assess whether BBPC should migrate from Prisma + SQL Server to Convex, and define a safe sequencing plan if a Convex spike proceeds.

## Snapshot

- 2 Next apps share the same relational domain:
  - `bbpc` user-facing app
  - `bbpc-admin` admin app
- 32 Prisma models in both schemas
- SQL Server-specific stack:
  - `provider = "sqlserver"` in both Prisma schemas
  - `@prisma/adapter-mssql` in both apps
- Separate SQL project:
  - 32 table definitions
  - 4 SQL views
  - 2 stored procedures
- Prisma-coupled auth in both apps:
  - `bbpc/src/server/auth.ts`
  - `bbpc-admin/src/pages/api/auth/[...nextauth].ts`

## ① Full migration inventory

### A. Routers that would need migration

#### `bbpc` app routers

| Router key | File | DB rewrite? | Models touched | Risk | Why |
|---|---|---:|---|---|---|
| `year` | `bbpc/src/server/api/routers/yearRouter.ts` | Yes | `review` | Medium | Relational review reads |
| `tag` | `bbpc/src/server/api/routers/tagRouter.ts` | Yes | `tag`, `tagVote` | High | Uses `groupBy`, transaction |
| `rankedList` | `bbpc/src/server/api/routers/rankedListRouter.ts` | Yes | `rankedItem`, `rankedList`, `userRole` | High | Reordering + transaction + role checks |
| `uploadInfo` | `bbpc/src/server/api/routers/uploadInfo.ts` | Yes | `assignment`, `audioEpisodeMessage`, `audioMessage`, `episode`, `user` | Medium | DB lookups tied to uploads |
| `gambling` | `bbpc/src/server/api/routers/gamblingRouter.ts` | Yes | `gamblingPoints`, `gamblingType` | High | Transaction + game-state logic |
| `episode` | `bbpc/src/server/api/routers/episodeRouter.ts` | Yes | `audioEpisodeMessage`, `episode` | High | Deep nested graph fetches |
| `auth` | `bbpc/src/server/api/routers/authRouter.ts` | Yes | `userRole` | Medium | Auth-role coupling |
| `user` | `bbpc/src/server/api/routers/userRouter.ts` | Yes | `user`, `userRole` | Medium | User/role reads and updates |
| `movie` | `bbpc/src/server/api/routers/movieRouter.ts` | Yes | `assignment`, `movie`, `rating` | High | Uses raw SQL view `AssignmentRatings` |
| `review` | `bbpc/src/server/api/routers/reviewRouter.ts` | Yes | `assignmentReview`, `audioMessage`, `extraReview`, `gamblingPoints`, `gamblingType`, `guess`, `rating`, `review` | Very high | Core domain complexity; stored proc `SubmitGuess`; `groupBy` |
| `admin` | `bbpc/src/server/api/routers/adminRouter.ts` | Yes | `user` | Low | Simple user admin operations |
| `video` | `bbpc/src/server/api/routers/videoRouter.ts` | Probably no | none | Low | No Prisma usage found |
| `feature` | `bbpc/src/server/api/routers/featureRouter.ts` | Yes | none directly | Very high | Calls stored proc `AddVoteForFeature` |
| `syllabus` | `bbpc/src/server/api/routers/syllabus.ts` | Yes | `syllabus` | High | Transactional relational workflow |
| `show` | `bbpc/src/server/api/routers/showRouter.ts` | Yes | `show` | Medium | CRUD but still data-layer rewrite |
| `season` | `bbpc/src/server/api/routers/seasonRouter.ts` | Yes | `point`, `season`, `user` | High | Leaderboard/timeline-style reads |

#### `bbpc-admin` app routers

| Router key | File | DB rewrite? | Models touched | Risk | Why |
|---|---|---:|---|---|---|
| `rankedList` | `bbpc-admin/src/server/trpc/router/rankedListRouter.ts` | Yes | `rankedItem`, `rankedList`, `rankedListType`, `userRole` | High | List/item ordering and permissions |
| `point` | `bbpc-admin/src/server/trpc/router/pointRouter.ts` | Yes | `assignment`, `assignmentPoints`, `point` | High | Transactional point issuance |
| `review` | `bbpc-admin/src/server/trpc/router/reviewRouter.ts` | Yes | `assignmentReview`, `extraReview`, `guess`, `rating`, `review` | High | Review graph maintenance |
| `assignment` | `bbpc-admin/src/server/trpc/router/assignmentRouter.ts` | Yes | `assignment`, `audioMessage` | High | Transaction + nested assignment state |
| `episode` | `bbpc-admin/src/server/trpc/router/episodeRouter.ts` | Yes | `assignment`, `audioEpisodeMessage`, `episode`, `link` | Very high | Slug uniqueness, transactions, deep includes |
| `user` | `bbpc-admin/src/server/trpc/router/userRouter.ts` | Yes | `gamblingPoints`, `guess`, `point`, `syllabus`, `user`, `userRole` | Very high | Cross-domain user/game mutations |
| `role` | `bbpc-admin/src/server/trpc/router/roleRouter.ts` | Yes | `role` | Medium | CRUD, but tied to auth model |
| `movie` | `bbpc-admin/src/server/trpc/router/movieRouter.ts` | Yes | `movie` | Medium | Standard CRUD |
| `show` | `bbpc-admin/src/server/trpc/router/showRouter.ts` | Yes | `show` | Medium | Standard CRUD |
| `auth` | `bbpc-admin/src/server/trpc/router/auth.ts` | Likely partial | none in router | Low | Router light, but auth stack still must move |
| `guess` | `bbpc-admin/src/server/trpc/router/guessRouter.ts` | Yes | `assignment`, `assignmentReview`, `gamePointType`, `guess`, `point`, `season`, `userRole` | Very high | Guessing game core workflow, transactions |
| `gambling` | `bbpc-admin/src/server/trpc/router/gamblingRouter.ts` | Yes | `assignment`, `gamblingPoints`, `gamblingType`, `point` | Very high | Transactional game/accounting logic |
| `syllabus` | `bbpc-admin/src/server/trpc/router/syllabusRouter.ts` | Yes | `assignment`, `episode`, `syllabus` | High | Multi-entity workflow |
| `dashboard` | `bbpc-admin/src/server/trpc/router/dashboardRouter.ts` | Yes | `episode`, `movie`, `review`, `syllabus`, `user` | High | Aggregated admin reporting |
| `test` | `bbpc-admin/src/server/trpc/router/testRouter.ts` | Probably no | none | Low | No Prisma usage found |
| `season` | `bbpc-admin/src/server/trpc/router/seasonRouter.ts` | Yes | `gamblingPoints`, `guess`, `point`, `season`, `user` | Very high | Raw SQL + `groupBy` + deep nested reads |
| `game` | `bbpc-admin/src/server/trpc/router/gameRouter.ts` | Yes | `assignmentPoints`, `gamePointType`, `gameType`, `point` | High | Game rules and point configuration |
| `azure` | `bbpc-admin/src/server/trpc/router/azureRouter.ts` | No/partial | none | Low | Storage integration, not core DB |
| `rating` | `bbpc-admin/src/server/trpc/router/ratingRouter.ts` | Yes | `rating` | Low | Basic CRUD |
| `banger` | `bbpc-admin/src/server/trpc/router/bangerRouter.ts` | Yes | `banger` | Low | Basic CRUD |
| `tag` | `bbpc-admin/src/server/trpc/router/tagRouter.ts` | Yes | `gamePointType`, `movie`, `tag`, `tagVote` | High | Transaction + tagging/voting linkage |

### B. Non-router backend surfaces that also need migration

| File | Why it matters |
|---|---|
| `bbpc/src/server/auth.ts` | PrismaAdapter + `user`/`userRole` lookups + impersonation logic |
| `bbpc-admin/src/pages/api/auth/[...nextauth].ts` | PrismaAdapter + admin role resolution |
| `bbpc/src/utils/points.ts` | Raw SQL + transaction-based point calculations |
| `bbpc-admin/src/server/trpc/utils/points.ts` | Raw SQL point calculation helper |
| `bbpc/src/server/db.ts` | Prisma SQL Server client bootstrap |
| `bbpc-admin/src/server/db/client.ts` | Prisma SQL Server client bootstrap |
| `bbpc-db/.../Views/*.sql` | Convex has no direct SQL-view equivalent |
| `bbpc-db/.../StoredProcedures/*.sql` | Must be rewritten as Convex mutations/actions |

### C. Every Prisma model that would need a Convex schema/query/mutation redesign

| Model | Used in runtime? | Migration pressure | Notes |
|---|---:|---:|---|
| `Episode` | Yes | High | Central content object, nested reads |
| `Link` | Yes | Medium | Child of episode |
| `Movie` | Yes | High | Assignment/review/tag/ranked-list joins |
| `Show` | Yes | Medium | Review/ranked-list joins |
| `Rating` | Yes | Medium | Guess/review dependency |
| `Review` | Yes | Very high | Core entity across user/game/content flows |
| `ExtraReview` | Yes | High | Join-like review↔episode link |
| `AssignmentReview` | Yes | Very high | Connects assignments, reviews, guesses |
| `Assignment` | Yes | Very high | Core content/game join entity |
| `Banger` | Yes | Low | Simple child entity |
| `Role` | Yes | Medium | Auth/authorization |
| `UserRole` | Yes | High | Permissions and admin checks everywhere |
| `Account` | Yes | High | NextAuth Prisma adapter |
| `Session` | Yes | High | NextAuth Prisma adapter |
| `VerificationToken` | Yes | High | Email auth flow |
| `User` | Yes | Very high | Referenced almost everywhere |
| `Guess` | Yes | Very high | Stored proc/business rules/leaderboards |
| `Season` | Yes | Very high | Core game aggregation root |
| `GameType` | Yes | High | Game configuration |
| `Point` | Yes | Very high | Accounting/leaderboard spine |
| `AudioMessage` | Yes | Medium | Upload/workflow data |
| `AudioEpisodeMessage` | Yes | Medium | Upload/workflow data |
| `GamblingPoints` | Yes | Very high | Stateful game/accounting logic |
| `GamblingType` | Yes | High | Used by gambling workflows |
| `Syllabus` | Yes | High | User planning + assignment generation |
| `AssignmentPoints` | Yes | High | Join-like accounting table |
| `GamePointType` | Yes | High | Raw SQL and score calculations depend on it |
| `TagVote` | Yes | High | Grouping/aggregation |
| `Tag` | Yes | Medium | Relatively simple, but connected |
| `RankedItem` | Yes | High | Ordered child collection |
| `RankedList` | Yes | High | Ordered aggregate root |
| `RankedListType` | Yes | Medium | Configuration model |

### D. SQL artifacts that Convex cannot take as-is

| Artifact | File(s) | Why this matters |
|---|---|---|
| View | `AssignmentRatings.sql` | Reimplement in Convex query logic |
| View | `MovieReviews.sql` | Same |
| View | `NextEpisode.sql` | Same |
| View | `NextFullEpisode.sql` | Same |
| Stored proc | `AddVoteForFeature.sql` | Rewrite as mutation/action |
| Stored proc | `SubmitGuess.sql` | Rewrite as mutation/action with correctness tests |

## ② Phased migration plan with week-by-week sequencing

Assumption: 1 strong full-stack engineer + part-time product validation. If fewer people, stretch by 1.5–2x.

### Phase 0 — Decision gate

Do this before any full migration.

| Week | Goal | Output |
|---|---|---|
| Week 1 | Run a bounded Convex spike on one seasonal dashboard slice only | Convex POC for `season` read path, data model draft, measured DX/perf notes |

Decision at end of Week 1:

- If Convex is not clearly better for one high-value realtime slice, stop.

### Phase 1 — Foundations

| Week | Goal | Output |
|---|---|---|
| Week 2 | Domain mapping and target data model | Convex schema draft; entity ownership map; join/denormalization strategy |
| Week 3 | Auth strategy | Decision: Convex Auth vs external auth; impersonation/admin-role design; session migration plan |
| Week 4 | Data migration tooling | Export scripts from SQL Server, import scripts to Convex, reconciliation checks |

### Phase 2 — Low-risk domains first

| Week | Goal | Output |
|---|---|---|
| Week 5 | Migrate low-risk config/content CRUD | `rating`, `banger`, `show`, `tag`, maybe `movie` basic CRUD |
| Week 6 | Migrate medium-risk content domains | `episode`, `link`, `audioEpisodeMessage`, `audioMessage`, `uploadInfo` support |

### Phase 3 — User/auth/admin surfaces

| Week | Goal | Output |
|---|---|---|
| Week 7 | Migrate user/admin read paths | `user`, `role`, `userRole`, admin dashboards, auth-adjacent reads |
| Week 8 | Cut over auth/session layer | Replace PrismaAdapter flows, role checks, impersonation, session hydration |

### Phase 4 — Ordered collections and planning domains

| Week | Goal | Output |
|---|---|---|
| Week 9 | Migrate ranking + syllabus | `rankedList`, `rankedItem`, `rankedListType`, `syllabus`, related admin flows |

### Phase 5 — Game/accounting core

| Week | Goal | Output |
|---|---|---|
| Week 10 | Migrate points/game config | `gameType`, `gamePointType`, `point`, `assignmentPoints`, leaderboard calculations |
| Week 11 | Migrate assignments/reviews | `assignment`, `review`, `extraReview`, `assignmentReview` |
| Week 12 | Migrate guesses/gambling | `guess`, `gamblingPoints`, `gamblingType`, stored proc replacements |

### Phase 6 — Cutover and stabilization

| Week | Goal | Output |
|---|---|---|
| Week 13 | Parallel run + diffing | SQL Server vs Convex result comparisons on critical endpoints |
| Week 14 | Production cutover | Convex live for selected surfaces; rollback plan validated |
| Week 15 | Cleanup | Remove Prisma SQL Server code, db views/procs dependencies, stale routes |

### Realistic sequencing notes

- The hard stop is Weeks 10–12.
- That is where Convex stops being “new query API” and becomes “rewrite your business semantics correctly.”
- If `SubmitGuess` or season leaderboard semantics are subtle, add another 2–3 weeks.

### Safer alternative sequencing

Instead of full migration:

| Week | Goal |
|---|---|
| 1 | Spike seasonal dashboard in Convex |
| 2–3 | Mirror only season/point/guess read models into Convex |
| 4–5 | Move only realtime leaderboard/timeline UI to Convex |
| 6+ | Decide whether to keep hybrid or stop |

That is materially safer than a big-bang rewrite.

## ③ Recommendation memo — should we actually do this?

## Recommendation

Do not commit to a full Convex migration now. Run a narrow Convex spike on the seasonal realtime dashboard. Keep Prisma as the system of record. If broader modernization is needed later, a Prisma → Postgres migration is lower risk than Prisma/SQL Server → Convex.

## Current architecture reality

BBPC is not a simple CRUD app.

It is:

- two Next apps sharing one relational domain
- Prisma tightly coupled to SQL Server
- NextAuth tightly coupled to Prisma models
- separate SQL project with views and stored procedures
- game/accounting logic with transactions, aggregates, ordered entities, and cross-entity workflows

This is a platform rewrite, not an ORM swap.

## Option A — Full Convex migration

### Upside

- Better live-query/realtime UX
- Single TypeScript-centric backend surface
- Less custom plumbing for subscriptions/polling/Pusher in selected features
- Potentially cleaner developer experience on new reactive features

### Downside

- You must redesign:
  - joins/includes
  - aggregate queries
  - auth/session persistence
  - stored procedures
  - SQL views
  - uniqueness/ordering workflows
- The heaviest domains (`review`, `assignment`, `guess`, `point`, `gamblingPoints`, `season`) are exactly where relational semantics are doing real work today.
- Significant effort will go into rebuilding correctness rather than shipping new user value.

### Fit assessment

Convex fits best when:

- realtime collaboration is the product center
- data model can be denormalized safely
- the team is willing to re-architect query patterns around documents/reactive reads

BBPC today looks more like:

- content + workflow + scoring + accounting + auth + reporting

That leans relational.

## Option B — Stay on Prisma + SQL Server

### Upside

- Lowest immediate migration risk
- Preserves current relational semantics
- No auth rewrite
- No stored procedure/view rewrite
- Fastest path to continue shipping product features

### Downside

- SQL Server operational complexity remains
- Realtime remains more manual
- Raw SQL/view/proc debt remains
- Dev experience stays split across TypeScript and SQL objects

## Option C — Stay on Prisma, move relational backend to Postgres later

### Upside

- Keeps the current app-layer programming model
- Removes SQL Server-specific friction over time
- Much smaller conceptual change than Convex
- Lets the team retire SQL Server-specific raw SQL gradually
- Easier hiring/debugging/tooling story than Azure SQL + custom SQL artifacts

### Downside

- Still a migration
- Raw SQL/view/proc work still needs translation
- Does not provide Convex-style live queries by itself

## Decision summary

### Should BBPC do a full Convex migration now?

No.

### Should BBPC test Convex on one slice?

Yes.

### Which slice?

Seasonal dashboard / leaderboard / timeline.

Why:

- `bbpc/CONVEX_SPIKE.md` already identifies this area as the spike target
- realtime upside is clearest there
- the scope is bounded enough to evaluate honestly
- it avoids rewriting auth + all CRUD + all game mutations up front

### If the Convex spike succeeds, should it replace everything?

Still probably no by default.

More likely winning path:

1. Keep SQL/Prisma as source of truth.
2. Mirror a bounded read model into Convex for realtime UX.
3. Reassess after operating that in production.

## Bottom-line recommendation

### Recommended path

1. Do not start a full Convex rewrite.
2. Run a 1-week spike on seasonal dashboard read models in Convex.
3. If the spike is strong, use Convex as a bounded realtime/read-model layer first.
4. If the actual pain is SQL Server, plan a separate Prisma → Postgres migration instead of Convex.

### Why

The current codebase has too much:

- relational density
- auth coupling
- SQL artifact coupling
- transactional game logic

for Convex to be the default safe next move.

## Working assumption for next step

If work continues, the next practical move is:

- create isolated spike branches/worktrees for `bbpc` and `bbpc-admin`
- keep Prisma + SQL Server as the system of record during the spike
- build Convex around a seasonal dashboard read-model experiment only
