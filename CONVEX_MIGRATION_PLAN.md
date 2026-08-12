# BBPC Full Convex Migration Plan

Status: production S4 and Convex-only runtime cleanup complete; retention closure in progress
Generated: 2026-07-23
Primary projects: `bbpc`, `bbpc-admin`
Secondary project: `bbpc-pipeline`
Follow-on project: `bbpc-recording`
Legacy source: `bbpc-db`

## Outcome

Move BBPC application data and business behavior from SQL Server/Prisma to one shared
Convex production deployment without dual-writing production data.

The migration is complete when:

1. `bbpc`, `bbpc-admin`, `bbpc-pipeline`, and later `bbpc-recording` use one shared
   Convex backend.
2. Every production SQL table, view, stored procedure, relationship, constraint, raw
   query, transaction, and consumer operation has a migrated, transformed, adapted, or
   explicitly retired disposition.
3. A fresh production clone can be extracted, transformed, reconciled, backed up, and
   restored reproducibly with no unexplained loss.
4. Clerk owns authentication while Convex owns canonical users, roles, authorization,
   service principals, and audited impersonation.
5. Production SQL is frozen and all SQL-backed consumers switch together. SQL rollback
   is available through cutover state S2 only.
6. Prisma, SQL Server application credentials, and `pyodbc` are removed from runtime
   application-data paths.
7. Every new migration/backend branch and changed compatibility adapter has automated
   coverage, and critical cross-system flows have real integration or end-to-end tests.
8. Two production-scale rehearsals pass functional, reconciliation, restore, security,
   and performance gates before production cutover.

Rough planning envelope after the database clone exists: human team approximately
10–14 weeks; Codex-assisted implementation approximately 5–7 focused weeks, excluding
observation windows and production scheduling. The census may materially revise this.

## Locked Decisions

| Area | Decision |
|---|---|
| Program scope | Plan the complete migration, implemented as gated releases rather than one branch or PR. |
| Backend ownership | Create a new sibling `bbpc-convex` repository; keep `bbpc-db` frozen as migration evidence. |
| Future repository shape | Preserve portability to a monorepo, but defer consolidation until after stability. |
| Source of truth | The isolated production SQL clone is authoritative; checked-in SQL and Prisma schemas are comparison inputs. |
| First milestone | Complete a repeatable offline data migration, reconciliation, backup, and restore before app cutover work. |
| ID strategy | Preserve SQL UUIDs as indexed `legacyId` values; use Convex `_id` values for runtime relationships. |
| Production writes | No dual-write period. S1/S2 allow only audited reversible restore/migration/control writes; the first post-S3 application/domain write is the point of no return. |
| Authentication | Use the existing Clerk application `app_2XzsQIxG2mvqYQ1ZNxqQMUsw89u`; force reauthentication at cutover. |
| Service authentication | `bbpc-pipeline` uses Clerk M2M tokens mapped to least-privilege Convex service principals. |
| Authorization | Migrate intended policy, not accidental legacy exposure; unclassified operations are denied. |
| Frontend boundary | Keep tRPC temporarily as thin Convex compatibility adapters, then retire it domain by domain. |
| Contract distribution | Publish a pinned, fail-closed `@tonyisup/bbpc-convex-api` package through GitHub Packages. |
| Recording sequence | Move `bbpc-recording` after the core SQL-backed cutover as a separate release. |
| Media | Keep Azure Blob and UploadThing during this program; Convex owns metadata and durable effect state. |
| Legacy archive | Preserve archive source data in the private migration backup only; do not promote it into the live Convex application model. |
| Performance | Functional parity, measured resource budgets, and two rehearsal passes are hard cutover gates. |

## NOT in Scope

- **Monorepo consolidation:** deferred so repository restructuring cannot obscure data
  or behavior parity; captured in `TODOS.md`.
- **Azure Blob or UploadThing binary migration:** existing media stores remain; a later
  evidence-based evaluation is captured in `TODOS.md`.
- **UI redesign or new product features:** only migration-required loading, error,
  read-only, and recovery states may change.
- **Preserving known authorization defects:** legacy unauthenticated writes are bugs,
  not compatibility requirements.
- **Production dual writes or row-by-row live synchronization:** the project has time
  for an offline parity-first migration and coordinated cutover.
- **Sequential production consumer cutover:** `bbpc`, `bbpc-admin`, and
  `bbpc-pipeline` switch as one unit.
- **SQL rollback after the first post-S3 application/domain write:** after that point,
  recovery is forward-fix or Convex restore. Audited S1/S2 restore, migration,
  reconciliation, smoke-identity, and control writes are reversible snapshot setup.
- **Migrating Auth.js sessions, verification tokens, OAuth tokens, recording invite
  tokens, participant access tokens, or admin secrets:** all are retired, invalidated,
  or regenerated.
- **Moving `bbpc-recording` before the core cutover:** its unfinished identity and
  episode model must not enter the critical path.

## What Already Exists

| Existing asset | How the plan uses it |
|---|---|
| Two 33-model Prisma schemas and the SQL project | Inputs to the schema-drift report; never treated as more authoritative than the production clone. |
| Thirty-nine tRPC router modules plus direct page/server callers | The initial operation census and differential behavior oracle. |
| Two stored procedures and five SQL views | Explicit compatibility cases with tested Convex replacements or retirement decisions. |
| Existing tRPC protected/admin middleware | Reused immediately for the Phase −1 legacy authorization patch, then replaced by Clerk/Convex guards. |
| `bbpc` date and point helpers plus admin variants | Differential fixtures expose disagreements and drive canonical domain decisions. |
| Azure Blob, UploadThing, email, webhook, and Pusher flows | Existing effects remain integrations; database-plus-effect work moves behind durable intents. |
| `bbpc-pipeline` pytest suite | Retained and extended around the typed Convex wrapper and Clerk M2M boundary. |
| `bbpc-recording` Vitest and `convex-test` setup | Reused as the backend testing pattern, while its custom auth and episode string linkage are redesigned. |
| Existing Clerk application | Reused for Google/email identity; development and production keys remain separate secrets. |
| Prior Convex assessment | Useful inventory hints only; its hybrid recommendation is superseded by the production-clone and no-rush premises. |

No reusable asset eliminates the need for the production database census or operation
census. Those two artifacts decide what actually exists.

## Target Architecture

```text
                                       GitHub Packages
                                @tonyisup/bbpc-convex-api
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
              bbpc Next.js          bbpc-admin Next.js      bbpc-pipeline
              Clerk session          Clerk session           Clerk M2M
                    │                      │                      │
          temporary tRPC adapter  temporary tRPC adapter   typed Python client
                    └──────────────────────┼─────────────── HTTP service gate
                                           │
                                           ▼
                              public Convex function builders
                        validate → identify → authorize → write gate
                                           │
                                           ▼
                                internal capability modules
                identity | catalog | episodes | reviews | assignments
                  games | rankings | side effects | system | migration
                                           │
                                           ▼
                           Convex tables, indexes, summaries, jobs

     bbpc-recording current deployment ── follow-on export/transform/import ──┘
```

Boundary rules:

- Public functions are organized by capability, not by consuming application.
- Raw public `query`, `mutation`, and `action` constructors are restricted to approved
  boundary modules. Typed builders require an explicit access class.
- Every mutation builder enforces the global application write gate.
- Internal functions contain reusable behavior and are not directly callable by clients.
- Expected failures use validated domain error codes. tRPC and Python translate them
  without parsing prose.
- Every query declares an index/range, bounded cardinality, pagination or `take`, and a
  response budget.
- Stable expensive aggregates are materialized only after measurements show the indexed
  query cannot meet its budget; every summary has rebuild and reconciliation functions.

## Migration Pipeline

```text
encrypted production clone
          │
          ▼
catalog + source fingerprint
          │
          ├── schema/constraints/indexes/code artifacts
          ├── row counts, byte estimates, duplicates, orphans
          └── per-table dependency and batch budgets
          │
          ▼
immutable per-table JSONL extraction
          │
          ▼
raw local Convex staging tables
          │
          ▼
checkpointed dependency-ordered transforms
          │
          ├── root documents + normalized legacyId
          ├── legacy FK → Convex _id resolution
          ├── children and joins
          ├── canonical-rule dispositions
          └── rebuildable derived summaries
          │
          ▼
structural + behavioral + security + performance reconciliation
          │
          ▼
portable-snapshot scrub and audit
          │
          ├── delete raw staging and migration checkpoints
          ├── require zero pending side-effect intents/jobs
          ├── exclude deployment-local system/control state
          └── retain canonical data + approved S2 smoke identities only
          │
          ▼
checksummed canonical Convex backup → disposable restore → acceptance rerun
```

Each migration run has an immutable manifest containing:

- source server/database fingerprint and extraction timestamp
- source table counts and checksums
- extractor and transformer versions
- target schema/API version
- per-table batch byte/document budgets and concurrency cap
- checkpoint sequence and retry history
- inserted, skipped, repaired, rejected, and unresolved counts
- canonical-rule and data-repair disposition identifiers
- reconciliation, test, performance, backup, and restore results

The migration refuses to continue if the source fingerprint, transformer version,
schema version, or prior checkpoint state does not match the run manifest.

The dependency scheduler uses table-level checkpoints where broad domain completion
would create an artificial cycle. After identity, catalog, and episodes reconcile,
assignment records/audio/syllabus form an `assignments.assignments` core barrier.
Reviews may then transform assignment reviews. Games may create types, seasons, and
points; `AssignmentPoints` waits specifically for `games.points`. Only then does the
assignments domain finish and reconcile, followed by the remaining game relationships.
This ordering keeps canonical foreign keys mandatory and avoids temporary IDs or
nullable backfills.

Function builders are default-deny when `systemState` is absent. A portable backup never
supplies production write mode or a local cutover run ID. After exact code, schema, and
environment configuration are deployed and the canonical backup is restored, a separately
protected initialization function creates a new production `systemState` in
write-disabled mode for the current cutover run. Production reconciliation must pass
before any consumer enters S2. Cloud staging uses synthetic data only; production-derived
raw staging never leaves the approved encrypted machine.

## Data Rules

| SQL shape | Convex target | Required behavior |
|---|---|---|
| `uniqueidentifier` | `_id` plus indexed lowercase `legacyId` | Runtime relations use `_id`; import/reconciliation use `legacyId`. |
| `date` | `YYYY-MM-DD` | Preserve calendar meaning without timezone conversion. |
| `datetime`/`datetime2` | UTC epoch milliseconds | Document source timezone; reject ambiguous conversions. |
| integer types | `number` | Validate SQL range and domain bounds. |
| nullable scalar | explicit optional or `null` union | Decide per field; never silently interchange absent and `null`. |
| case-insensitive unique text | display text plus normalized key | Match production collation, trim, Unicode, and case rules. |
| filtered unique index | indexed lookup plus transactional check | Every write path enforces the same predicate. |
| computed/view result | indexed query or rebuildable summary | Exact parity fixture and deterministic rebuild required. |

Sensitive-data rules:

- Clone, JSONL, local staging state, backups, and raw reports remain on the approved
  encrypted machine and are excluded from Git and cloud sync.
- Synthetic fixtures contain no production-derived values.
- Logs and shared reports contain redacted counts, hashes, timings, and disposition IDs
  only.
- Tokens, credentials, and free-form production content never appear in test snapshots,
  screenshots, CI artifacts, or task logs.
- Raw extracts and temporary staging are deleted according to the signed retention entry
  in the final go/no-go record.

## Authorization and Identity

Canonical tables:

- `users`: BBPC person, profile data, normalized email where needed, and SQL `legacyId`
- `authIdentities`: unique `(issuer, subject)` to canonical user mapping, with verified
  email observed at link time
- `roles` and `userRoles`: explicit domain authorization
- `impersonationSessions`: actor, target, reason, started/ends/revoked timestamps, audit
- `servicePrincipals`: Clerk machine subject, status, permissions, rotation/audit fields
- `systemState`: application write mode, cutover run ID, actor, timestamps

Access classes:

1. anonymous
2. authenticated owner
3. administrator
4. pipeline service
5. recording capability
6. internal only

Every operation has exactly one declared class plus any narrower ownership check. CI fails
if an exported operation lacks a classification.

Identity linking:

1. User signs into Clerk after cutover.
2. Convex looks up `(issuer, subject)`.
3. If absent, a verified email may select one unlinked migrated candidate.
4. Zero candidates creates a new canonical user only where product policy allows.
5. Multiple candidates or conflicting existing identity returns a safe conflict requiring
   an audited admin resolution.
6. Matching an unverified email never links an account.
7. Auth.js sessions/tokens are not copied; all users reauthenticate.

S2 authentication is a deliberate exception to ordinary first-use flow, not to the write
gate. During S1, a migration-only internal function pre-provisions an approved regular
user Clerk subject, an administrator Clerk subject, and the pipeline service principal,
all tied to the cutover run and audited. S2 smoke tests use only these identities.
Automatic first-time identity linking remains disabled until S3, and a dedicated E2E test
proves both the S2 read-only path and the first ordinary post-S3 link.

Pipeline:

- The Python process obtains a short-lived Clerk M2M token.
- A Convex HTTP action verifies issuer, audience, expiry, token type, and machine subject.
- The subject maps to an enabled service principal with operation-level permissions.
- Only internal functions execute after authorization; every service mutation is audited.
- A user token cannot call service-only functions, and a machine token cannot call user or
  admin functions.

## Structured Errors and Side Effects

Every expected error has:

- stable code
- safe user/operator message
- retryability
- optional validated safe details
- private incident ID linking to redacted server diagnostics

Database-plus-network workflows use a durable intent:

```text
user/service mutation
        │
        ├── domain write
        └── sideEffectIntent(idempotencyKey, pending)
                 │
                 ▼
        bounded scheduled dispatcher
          ├── success → succeeded + remote reference
          ├── retryable → backoff + attempt audit
          └── terminal → failed + recovery action
                 │
                 ▼
       periodic remote-state reconciliation
```

Each effect defines an idempotency key, duplicate behavior, retry schedule, terminal
state, compensation/operator action, user-visible state, and reconciliation rule.
Pusher is removed only where Convex subscriptions provide the same experience.

## Phased Execution

Each phase ships as one or more independently reviewable changes. A phase may not enter
the next gate because it is “mostly done.” Implementation work may overlap across phase
boundaries only as scaffolding or against an individually frozen, versioned domain
contract. Overlap never advances the later phase’s status or permits its final build,
acceptance gate, or production use before all prior gates pass.

### Phase −1 — Secure the Current Admin Application

Goal: remove verified unauthenticated mutation exposure before the long migration.

Work:

- Produce an authorization matrix for every `bbpc-admin` tRPC procedure.
- Change all user/role, points, gambling, guesses, destructive, and administrative writes
  to the correct protected/admin procedure.
- Review public reads for personal or administrative data.
- Add allow/deny regression tests for anonymous, ordinary user, and admin identities.
- Deploy separately and verify production behavior.

Exit gate:

- No mutation remains public without an approved anonymous-use case.
- Negative authorization tests pass.
- Existing intended admin workflows pass smoke tests.
- This patch is deployed before Convex implementation starts.

### Phase 0 — Census and Baselines

Goal: replace assumptions with authoritative inventories.

Work:

- Clone production SQL Server into an isolated development database without repairing it.
- Generate a machine-readable database census:
  schema, types, defaults, computed columns, constraints, indexes, views, procedures,
  triggers, functions, row counts, byte estimates, duplicates, orphans, large values, and
  dependency order.
- Generate a machine-readable operation census:
  all 39 routers, direct page/server reads, auth callbacks, upload handlers, Python SQL
  callers, raw SQL, transactions, views, procedures, background work, and effects.
- Record each operation’s validators, access class, ownership rule, state transition,
  response/error contract, query cardinality, and side effects.
- Capture representative SQL p50/p95/p99, payload, and concurrency baselines.
- Record all schema/code drift without selecting a winner yet.

Exit gate:

- Every production artifact and application operation has an owner and disposition slot.
- Source fingerprint and sensitive-data policy are recorded.
- No unexplained production-only object remains.
- Database size and row distribution can support an initial Convex deployment/cost choice.

### Phase 1 — Standalone Backend Foundation

Goal: make `bbpc-convex` independently buildable, testable, deployable, and consumable.

Work:

- Create the new repository with local/dev, staging, and production Convex environments.
- Pin Convex, `convex-helpers`, Vitest, and `convex-test`.
- Configure TypeScript, lint, no-floating-promises, query-scan restrictions, secret
  validation, coverage, and CI.
- Implement structured errors, typed access/write-gate builders, audit helpers, and
  internal-only conventions.
- Implement `systemState` with protected cutover transitions.
- Configure Clerk for development and production without committing keys.
- Establish staging deployment and fail-closed API generation/publication to GitHub
  Packages.
- Add package compatibility tests and retain the last known good package/backend pair.

Exit gate:

- CI builds, type-checks, lints, tests, deploys staging, generates the API package, and
  verifies a consumer fixture.
- Raw public constructors cannot bypass the guard architecture.
- The global write gate blocks user, service, scheduled, HTTP, and stale-client writes in
  tests.

### Phase 2 — Offline Data Migration Milestone

Goal: finish the user’s first milestone—complete data migration before consumer cutover.

Work:

- Approve the SQL-to-Convex mapping matrix and target indexes from the census.
- Implement identity, catalog, episode, review, assignment, game, ranking, system, and
  migration tables with `legacyId`.
- Build immutable extraction and raw staging import.
- Build dependency-ordered, size-aware, checkpointed transformers.
- Add explicit data repair/rejection dispositions; never silently normalize anomalies.
- Build structural reconciliation: counts, checksums, relationships, uniqueness, orphan
  outcomes, normalized keys, and derived summaries.
- Inject failures before/after every checkpoint and prove exact resume/repeat behavior.
- Delete raw staging/checkpoints and deployment-local system/queue state, require zero
  pending effects/jobs, audit the portable table allowlist, and create a checksummed
  canonical-only backup containing only canonical data and approved smoke identities.
- Restore the backup into a disposable deployment, initialize a fresh disabled
  `systemState`, and rerun reconciliation.

Exit gate:

- Fresh-clone runs are repeatable and resumable.
- Zero unexplained row, relationship, uniqueness, or checksum mismatches.
- Zero unreviewed rejected records and zero migrated credential/session secrets.
- Portable-snapshot allowlist, default-deny initialization, backup, and disposable restore
  pass.
- This gate can be completed offline without changing any production consumer.

### Phase 3 — Canonical Domain Behavior

Goal: replace SQL/Prisma business behavior with one tested Convex implementation.

Dependency order:

1. identity and catalog
2. episodes and media metadata
3. assignments, reviews, ratings, and syllabus
4. seasons, games, points, guesses, gambling, tags, and quote submissions
5. rankings and ordered lists
6. external side-effect intents and reconciliation

For each domain:

- Turn every operation-census row into migrate, adapt, or retire.
- Run identical synthetic fixtures against SQL and Convex.
- Compare normalized responses, final state, errors, authorization, and effect intents.
- Resolve disagreements explicitly into a canonical rule.
- Add indexes, pagination, concurrency controls, and derived summaries based on budgets.
- Reach 100% branch coverage before the domain package/API is considered ready.

Exit gate:

- Every inventoried operation has a tested disposition.
- Critical writes, scoring, ordering, authorization, and destructive behavior agree with
  the approved canonical rules.
- No public query or mutation exceeds its measured budget on production-scale fixtures.

### Phase 4 — Consumer Adapters Against Local/Staging Convex

Goal: prepare all SQL-backed consumers without changing production data ownership.

Clerk/provider scaffolding, package installation, shared adapter infrastructure, and an
individually frozen domain slice may begin early for integration feedback. Final consumer
builds and this phase’s exit gate remain blocked until the complete offline-data and
canonical-domain gates pass.

`bbpc`:

- Integrate Clerk and canonical identity linking.
- Convert tRPC handlers into thin calls to the shared Convex API.
- Preserve approved DTO/error behavior.
- Add route smoke tests and critical Playwright flows.

`bbpc-admin`:

- Integrate Clerk, role checks, and expiring audited impersonation.
- Convert routers to thin Convex adapters.
- Preserve canonical admin workflows while rejecting previously accidental public access.
- Add route smoke, destructive, ordering, concurrency, and authorization E2E coverage.

`bbpc-pipeline`:

- Add the typed Python wrapper.
- Replace each application-data `pyodbc` path with an explicit Convex operation.
- Add Clerk M2M acquisition/rotation, scoped error mapping, retry, and idempotency.
- Retain pytest and prove no SQL fallback exists.

Exit gate:

- All three consumers compile against one pinned API package and pass staging contract
  tests.
- Representative calls succeed against restored production-scale data.
- Production builds are ready to switch by configuration but still use SQL.

### Phase 5 — Whole-System Acceptance and Rehearsals

Goal: prove the coordinated cutover is repeatable inside the chosen window.

Work:

- Run every synthetic unit, function, adapter, contract, and E2E suite.
- Run private production-clone differential suites and redact reports.
- Exercise token expiry/revocation, duplicate requests, stale clients, network failures,
  effect retry/terminal recovery, package rollback, and function limits.
- Measure query latency/scan/response budgets and migration throughput.
- Run rehearsal 1 from a fresh clone through S2, including forced rollback to SQL.
- Tune only documented batches/indexes/queries; update the run manifest.
- Run rehearsal 2 from another fresh clone through S2, create the named backup, restore
  it into a disposable deployment, and rerun acceptance.
- In each rehearsal, pre-provision the exact S2 smoke identity classes during S1, prove
  that those identities can read while all writes remain blocked, and prove that an
  unlinked ordinary Clerk identity cannot create a link before S3.
- Set the maximum read-only window and per-state deadline from measured results.

Exit gate:

- Two consecutive rehearsals produce identical acceptance outcomes.
- No unexplained p95 regression above 20%.
- Every query/mutation/action stays inside platform and approved budgets.
- The signed go/no-go template, rollback steps, backup checksum, restore command,
  responsible operators, and state deadlines are complete.

### Phase 6 — Coordinated Production Cutover

```text
S0  SQL writable; production consumers use SQL
 │  Preconditions, manifests, builds, credentials, operators, comms verified
 ▼
S1  Freeze every SQL writer; maintenance/read-only mode
 │  Final extract → isolated transform → reconcile → portable-snapshot scrub
 │  Canonical-only backup with approved smoke identities; checksum and allowlist
 │  Deploy exact code/schema/env → restore production backup
 │  Initialize fresh write-disabled systemState → verify gate and checksums
 ▼
S2  Point bbpc + bbpc-admin + bbpc-pipeline to Convex; writes still disabled
 │  Smoke all reads/auth; create/download/checksum backup
 │  Restore backup in disposable deployment and rerun acceptance
 ├── failure → point all consumers to frozen SQL, then unfreeze SQL
 ▼
S3  Explicit signed approval; enable Convex writes
 │  First accepted application/domain write = point of no return
 ▼
S4  Observe; forward-fix or restore Convex only; SQL remains immutable archive
```

S0 prerequisites:

- exact source/backend/package/consumer commit identifiers
- successful rehearsal manifests
- Clerk production configuration and M2M machine ready
- approved regular-user, administrator, and pipeline S2 smoke subjects ready for
  migration-only pre-provisioning
- write-gate and rollback commands tested
- Azure/UploadThing/email/webhook credentials verified
- named backup retention and restore owner
- portable-backup table allowlist, zero-pending-effects assertion, and default-deny
  missing-`systemState` behavior verified
- maintenance communication and operator assignments

S2 acceptance:

- all consumers authenticated with the pre-provisioned smoke identities and reading
  expected production data
- an unlinked ordinary Clerk identity cannot create an identity link before S3
- zero writes from browser, HTTP, pipeline, scheduled jobs, or side-effect dispatcher
- production Convex data fingerprint matches the final transformed backup and frozen SQL
- production has a newly initialized disabled `systemState` for the exact cutover run;
  no local deployment control, checkpoint, staging, or pending-effect state exists
- only audited restore, migration, reconciliation, smoke-identity, and control-state
  writes occurred; application mutations, scheduled domain work, and external effects
  remain blocked
- contract and critical smoke suites pass
- final reconciliation matches the frozen source
- backup download/checksum/restore succeeds

S3 requires a typed, audited transition naming the cutover run and approved backup.
After the first successful post-S3 application/domain write, SQL must never be reopened
as the writable system. Before that write, S1/S2 Convex state is a disposable,
reproducible projection of frozen SQL plus audited control/smoke configuration.

### Phase 7 — Direct Convex Clients and tRPC Retirement

Goal: remove the temporary compatibility layer without coupling it to data cutover.

Work:

- Move screens domain by domain from tRPC to direct Convex queries/mutations.
- Preserve SSR behavior where needed and introduce subscriptions where user value exists.
- Keep old functions and package versions until telemetry and contract tests show zero
  callers.
- Remove adapters, tRPC dependencies, Prisma clients, SQL adapters, `DATABASE_URL`, and
  obsolete Pusher paths only after each domain gate passes.

Exit gate:

- No runtime Prisma/SQL dependency in either Next.js app.
- No remaining tRPC calls or deployed compatibility functions.
- Direct-client E2E and performance gates pass.

### Phase 8 — Recording Consolidation

Goal: move the work-in-progress recording domain into the stable shared backend.

Work:

- Map recording episodes and users to canonical IDs.
- Redesign participant/invite capabilities so they cannot escalate to account privileges.
- Export, transform, import, and reconcile recording sessions and metadata.
- Regenerate or invalidate all recording capabilities and admin secrets.
- Move functions and clients to the shared API package.
- Verify sessions, participants, RTC state, manifests, favorites, uploads, cleanup, and
  export flows with existing and expanded Vitest/E2E coverage.

Exit gate:

- Recording data reconciles with no live secret migration.
- Clients use the shared deployment.
- The old recording deployment is read-only, backed up, retained for the approved window,
  then retired.

### Phase 9 — Archive and Close

Work:

- Confirm all runtime SQL/Prisma/`pyodbc` imports and credentials are removed.
- Retain the frozen SQL clone/project, manifests, redacted reports, and cutover evidence
  under the approved archive policy.
- Delete raw extracts, temporary staging, and obsolete secrets at the recorded retention
  deadline.
- Document Convex backup/restore, environment recovery, package publication, Clerk
  recovery, service-token rotation, side-effect recovery, and on-call diagnostics.
- Start—but do not automatically execute—the accepted monorepo and media-evaluation
  TODOs.

## Verification and Performance Gates

Test layers:

| Layer | Tool | Required proof |
|---|---|---|
| Pure mapping/domain | Vitest | Every branch, boundary, null/error, canonical rule |
| Convex query/mutation/job | Vitest + `convex-test` | State transitions, indexes, auth builders, gate, retries |
| tRPC compatibility | Vitest | DTO and domain-error translation |
| Python service | pytest | M2M, typed errors, retry/idempotency, no SQL fallback |
| Contract/package | TypeScript consumer fixtures + staging calls | Compatible package/backend matrix and fail-closed release |
| Browser/service E2E | Playwright and service harness | Auth, critical writes, admin, concurrency, effects, cutover |
| Differential | SQL clone + local/staging Convex | Response, state, auth, error, effect intent |
| Rehearsal | Fresh clone + disposable restore | Full duration, rollback, backup, restore, acceptance |

Required metrics:

- operation p50/p95/p99 and error rate
- response bytes and documents/bytes scanned
- transaction conflicts and retries
- effect queue depth, oldest age, attempts, and terminal failures
- batch rows/bytes per second, retries, and checkpoint duration
- total S1 and S2 duration
- backup creation/download/checksum/restore duration

No production cutover waiver may replace a failed security, reconciliation, restore, or
performance gate.

## Failure Modes

| Codepath | Realistic production failure | Test | Handling | User/operator visibility |
|---|---|---|---|---|
| Phase −1 auth patch | Intended admin workflow is accidentally denied | Role-matrix unit + admin E2E | Roll back isolated patch or correct classification | Clear forbidden result and deploy alert |
| Source extraction | Wrong or changing source database | Fingerprint mismatch test | Refuse run before export | Operator error names expected/actual fingerprint |
| JSONL/staging import | Process stops midway, batch redelivers, or staging leaks into promotion | Before/after checkpoint failpoints plus portable-backup allowlist test | Resume from manifest; idempotent duplicate detection; block backup until scrub passes | Progress report shows checkpoint/retry or blocked promotion |
| Type conversion | Ambiguous date/null/collation value | Mapping boundary fixtures | Reject with disposition ID; no silent coercion | Redacted operator report |
| Relationship transform | Missing parent or duplicate target | Orphan/duplicate fixtures and clone census | Recorded repair/reject decision required | Go/no-go remains blocked |
| Identity linking | Verified email matches multiple users, or S2 needs an unprovisioned identity | Clerk linking integration test plus S2/pre-S3 E2E | Refuse automatic link; use only audited pre-provisioned smoke identities in S2; enable ordinary linking at S3 | Safe account-conflict/read-only message |
| Clerk availability | Sign-in/token refresh fails | Provider timeout/expiry E2E | No write; retry/re-auth path | Recoverable authentication message |
| Pipeline M2M | Expired, revoked, wrong-audience, or over-scoped token | pytest/service integration | Reject before internal call; audit denial | Typed service error and alert |
| Query execution | Full scan or response exceeds budget | Lint + production-scale budget test | CI/rehearsal failure; add index/pagination | Operator metric names operation |
| Concurrent mutation | Double submit or stale reorder conflicts | Multi-client function/E2E tests | Transaction retry or typed conflict | User sees retry/refresh guidance |
| Side effect | Remote succeeds, response times out, delivery repeats | Deterministic dispatcher failpoints | Idempotency lookup and reconciliation | Pending/retry/failed state is visible |
| Package generation | Beta generator or consumer contract fails | CI failure injection | Fail closed; retain last known pair | Release blocked with artifact logs |
| Stale frontend | Old package calls removed function | Compatibility matrix test | Keep old function until zero callers | No user-visible break |
| Write gate | Missing/restored local `systemState`, stale client, HTTP caller, scheduler, or service tries to write in S1/S2 | Default-deny initialization plus boundary-specific negative tests | Builder rejects before mutation/effect; protected initializer creates new production-disabled state | Maintenance/read-only state |
| S2 acceptance | One consumer fails smoke or data mismatch appears | Full rehearsal and cutover smoke | Repoint all consumers to frozen SQL; unfreeze | Maintenance message plus operator alert |
| Backup | Backup corrupt, contains non-portable tables/state, or restore does not match | Table allowlist, zero-pending-state, checksum, and real restore tests | Block promotion/S3; scrub, recreate, and verify | Go/no-go remains blocked |
| Post-S3 defect | Failure occurs after the first post-S3 application/domain write | Restore/forward-fix game day | Do not reopen SQL; restore Convex or patch forward | Incident status and recovery audit |
| Recording move | Old participant token grants shared access | Capability negative tests | Invalidate/regenerate; reject legacy token | Join error with re-invite path |

Critical silent gaps: **0**. Every listed failure has a planned test, explicit handling,
and visible user or operator outcome.

## Inline Diagrams to Keep with the Implementation

Add compact ASCII comments to these intended files because their state or trust flow is
not obvious from types alone:

- `bbpc-convex/convex/system/cutover.ts` — S0–S4 state transitions and rollback boundary
- `bbpc-convex/convex/migration/orchestrator.ts` — extract/stage/transform/checkpoint flow
- `bbpc-convex/convex/sideEffects/dispatcher.ts` — pending/retry/terminal/reconcile states
- `bbpc-convex/convex/identity/linking.ts` — Clerk identity-link decision tree
- `bbpc-convex/convex/identity/impersonation.ts` — actor/target privilege boundary
- `bbpc-pipeline/lib/convex_client.py` — M2M token acquisition/refresh/request flow

Comments must describe invariants and state transitions, not duplicate implementation
line by line.

## Worktree Parallelization

### Dependency Table

| Step | Modules touched | Depends on |
|---|---|---|
| Legacy security patch | `bbpc-admin/src/server/trpc`, admin tests | — |
| Database/operation census | `bbpc-db`, workspace migration artifacts, all consumers read-only | production clone |
| Backend foundation | `bbpc-convex` CI, system, identity foundations, client package | legacy patch |
| Target schema and migration harness | `bbpc-convex/convex/schema`, migration modules | census + foundation |
| Domain functions | `bbpc-convex/convex` capability modules | target schema + identity foundation |
| Side-effect subsystem | `bbpc-convex/convex/sideEffects` | foundation + domain intent contracts |
| Primary adapter | `bbpc/src/server`, auth/provider, app tests | scaffolding: foundation; domain slice: its frozen contract; final build: Phases 2–3 |
| Admin adapter | `bbpc-admin/src/server`, auth/provider, app tests | scaffolding: foundation; domain slice: its frozen contract; final build: Phases 2–3 |
| Pipeline adapter | `bbpc-pipeline/lib`, pytest | scaffolding: service auth; domain slice: its frozen contract; final build: Phases 2–3 |
| Whole-system QA/rehearsals | all test/config/runbook modules | backend + three consumers |
| Direct-client conversion | `bbpc/src`, `bbpc-admin/src` | successful production cutover |
| Recording consolidation | `bbpc-recording`, recording domain in backend | stable production backend |

### Parallel Lanes

- **Lane A:** legacy security patch; sequential within `bbpc-admin`.
- **Lane B:** production clone census → mapping matrix; may run alongside Lane A because it
  is read-only and does not implement Convex.
- **Lane C:** backend foundation → schema/identity → domain functions → side effects;
  sequential where modules share the backend schema and public contracts.
- **Lane D:** migration extractor/staging/transform/reconciliation; begins after the census
  and schema contract, then runs alongside later domain-function work.
- **Lane E:** `bbpc`, `bbpc-admin`, and `bbpc-pipeline` scaffolding may begin after the
  foundation; each domain slice waits for its frozen published contract, and final builds
  wait for complete Phase 2–3 acceptance.
- **Lane F:** whole-system QA and rehearsals after C + D + E merge.
- **Lane G:** direct-client conversion and recording consolidation may run in parallel
  after core production stabilization because they touch different repositories/domains.

Execution order:

1. Launch A + B in parallel.
2. After A passes, launch C foundation; after B and schema approval, launch D.
3. Launch E scaffolding in parallel. Publish frozen domain contracts one at a time, then
   integrate only those slices while C/D continue; do not publish final consumer builds.
4. After complete Phase 2–3 acceptance, finalize and merge compatible consumer builds,
   then run F sequentially.
5. Perform production cutover.
6. Launch G follow-on lanes after the observation gate.

Conflict flags:

- Backend domain and migration lanes both touch `bbpc-convex/convex/schema`; schema changes
  must land through Lane C before Lane D consumes them.
- `bbpc-admin` Phase −1 and later admin adapter work share router/auth modules and must be
  sequential.
- API package publication is a dependency boundary; consumer lanes must pin published
  versions rather than copying generated files.

## Implementation Tasks

Synthesized from the engineering review. Checkbox each task as its verification gate
ships.

- [x] **T1 (P1, human: ~2–4d / Codex: ~1d)** — Legacy security — Protect current admin procedures.
  - Surfaced by: Code Quality — unauthenticated user, role, gambling, and other admin writes.
  - Files: `bbpc-admin/src/server/trpc/`, `bbpc-admin` test configuration.
  - Verify: authorization matrix tests, admin Playwright smoke, build.
- [x] **T2 (P1, human: ~3–5d / Codex: ~1–2d)** — Census — Inventory production data and every database operation.
  - Surfaced by: Scope/Architecture — checked-in schemas drift and production is authoritative.
  - Files: `bbpc-db/`, workspace migration artifacts, read-only scans of all four projects.
  - Verify: census schema validation; 34 tables, production artifacts, and all consumers have dispositions.
- [x] **T3 (P1, human: ~2–3d / Codex: ~1d)** — Backend foundation — Scaffold and distribute `bbpc-convex`.
  - Surfaced by: Architecture — standalone deployment and multi-repository contract ownership.
  - Files: new `bbpc-convex` repository, CI, client-package modules.
  - Verify: build, lint, Vitest coverage, staging deploy, package consumer fixture.
  - Progress: the backend is published as private `tonyisup/bbpc-convex`; exact commit
    `920beecaa31763471d143dfe793dc20e9b5d08d2` passed independent CI, the guarded
    staging deploy, generated-contract comparison, coverage, and the package consumer
    fixture. Registry publication remains deferred until a consumer is ready to pin
    the package.
- [x] **T4 (P1, human: ~4–7d / Codex: ~2–3d)** — Data model — Approve target schema, indexes, mappings, and error contracts.
  - Surfaced by: Architecture/Performance — legacy drift, bounded query contracts, canonical identity.
  - Files: `bbpc-convex/convex/schema`, validators, DTO/error package.
  - Verify: mapping fixtures, schema tests, index/cardinality review, generated contract.
  - Progress: all 31 migrated target tables and their typed minimum indexes are defined
    and schema-tested; the four mapping decisions and Phase 0 anomaly/operation
    dispositions were approved on 2026-07-24 for the production-derived local rehearsal.
- [x] **T5 (P1, human: ~4–6d / Codex: ~2–3d)** — Security foundation — Implement Clerk identity, roles, service principals, audited impersonation, and write gate.
  - Surfaced by: Architecture/Code Quality — one shared auth boundary and structural guards.
  - Files: `bbpc-convex/convex/identity`, `system`, boundary builders.
  - Verify: complete allow/deny matrix, Clerk integration, M2M tests, stale-client gate tests.
  - Progress: the shared Clerk boundary, role-derived administrator checks, service
    principal boundary, global S0–S4 write gate, and stale-client guard are implemented.
    First-use linking is S3/S4-only: a verified email claims exactly one active unlinked
    migrated user or creates an ordinary canonical user, while duplicate, disabled,
    reused-subject, and already-claimed state fails closed. Internal run-scoped S1/S2
    mutations idempotently pre-provision exact smoke users and a bounded least-privilege
    pipeline principal without opening ordinary linking. Link/provision audits exclude
    email, subject, and token values. Expiring administrator impersonation is now
    restricted to S3/S4, bounded to 60 minutes, reason-required, automatically expired,
    explicitly revocable, and audited with the original administrator plus session ID.
    Owner calls resolve to the target without transferring administrator permissions,
    while the admin application retains the base administrator identity. The backend
    allow/deny, expiry, conflict, disabled-target, audit, and privilege-boundary tests
    pass in the 314-test full gate at 90.09% branch coverage. The backend is committed
    as `cf62af8`, with admin controls in `da39b7e` and the public exit control in
    `3348bcf`.
- [x] **T6 (P1, human: ~7–10d / Codex: ~3–5d)** — Migration — Build extraction, staging, checkpointed transformation, and reconciliation.
  - Surfaced by: Architecture/Tests/Performance — offline data milestone, resumability, platform limits.
  - Files: `bbpc-convex/convex/migration`, local extractor tooling.
  - Verify: fresh-clone repeat, deterministic failpoints, zero unexplained mismatch.
  - Progress: all eight identity, catalog, episode, assignment, review, game, ranking,
    and archive domains have guarded local-only extraction, immutable manifest support,
    bounded idempotent transforms, and independent read/compare reconciliation with
    synthetic rollback/conflict coverage. Production-derived local extraction and
    rehearsal were authorized on 2026-07-24. The intermediate `foundation-v1`
    scrub and final `portable-v1` scrub are implemented and synthetic-tested. The final
    scrub covers all 31 raw tables, all migration metadata, and deployment-local
    control state; it requires per-domain evidence, deletes `systemState` last, and has
    a schema-wide retain/scrub classification test. A guarded local rehearsal command
    now verifies all eight immutable manifests, executes the tested 86-step dependency
    DAG, and resumes from persisted domain/checkpoint progress after interruption. The
    first production-derived local run passed on 2026-07-24 with all 9,283 rows
    reconciled, all 62 data checkpoints completed, and zero running checkpoints or
    unexplained mismatches. The explicitly approved one-way `portable-v1` scrub
    completed on 2026-07-27 with exact bounded deletion counts and left the shared
    local backend fail-closed. The resulting private portable backup and its
    disposable restore are recorded under T7. A second clean production-derived run,
    `dev-rehearsal-20260727-02`, independently reconciled the same 9,283 SQL-derived
    rows and 828 recording catalog rows, completed its one-way scrub, and passed the
    exact disposable restore plus S2→S0 rollback exercise.
- [x] **T7 (P1, human: ~2–3d / Codex: ~1d)** — Recovery — Produce and restore the data-milestone backup.
  - Surfaced by: Test Review — backups and resumability must be exercised.
  - Files: migration runbooks and acceptance artifacts.
  - Verify: checksum, disposable restore, full reconciliation rerun.
  - Progress: local-only backup/restore automation is complete. The backup command validates
    exact canonical table counts, performs the resumable final scrub, exports a private
    allowlisted snapshot, and hashes canonicalized table content. The restore command
    uses a second disposable local deployment, compares all table hashes, reruns the
    full migration/reconciliation DAG expecting zero inserts, and removes the disposable
    deployment before recording success. Run `dev-rehearsal-20260724-01` produced a
    mode-`0600` backup with 45 portable tables and 10,559 rows: 10,111 canonical rows,
    two linked auth identities, and 446 value-reduced audit events. The 2026-07-27
    disposable restore matched every table hash, preserved all 828 recording catalog
    rows, reran all eight domains and 62 checkpoints with zero inserts, wrote
    aggregate-only restore evidence, and deleted its local deployment. The second run
    produced a separate 45-table, 10,552-row portable snapshot containing 10,111
    canonical rows, zero auth identities, and 441 value-reduced audit events. Its
    disposable restore matched every table hash, reused all 9,283 SQL-derived rows with
    zero inserts, preserved all 828 recording catalog rows, proved the actor-scoped
    S1→S2→S0 rollback sequence with application writes disabled, and deleted the target.
- [x] **T8 (P1, human: ~5–7d / Codex: ~2–3d)** — Core domains — Implement identity, catalog, and episodes.
  - Surfaced by: Code Quality — capability-oriented canonical behavior.
  - Files: `bbpc-convex/convex/identity`, `catalog`, `episodes`.
  - Verify: differential contracts, authorization, indexes, 100% new-code branches.
  - Progress: the first anonymous episode read slice is implemented with indexed
    latest/next/normalized-slug queries and native paginated detail hydration. Its
    privacy-reduced DTO, relationship limits, missing-parent behavior, generated package
    contract, and SQL case-insensitive `Published` compatibility have synthetic coverage.
    An aggregate production-derived smoke traversed all 634 episodes and matched the
    manifest totals for 308 assignments, 390 extras, and 14 links without exposing rows.
    Public catalog exact-ID, bounded title/year search, and native pagination are also
    implemented and contract-generated. Their aggregate smoke traversed all 1,494 movies
    and 6 shows and confirmed private title/year lookup round-trips without exposing
    catalog values. Bounded episode/assigned-movie search and transitional legacy-ID
    lookup also passed private production-derived ID round-trips. Identity profile,
    episode, and catalog read foundations are ready. Owner-scoped episode audio
    pagination, usage, update, and delete operations are also implemented with Clerk-
    derived ownership, S3/version write gating, hidden non-owner results, and audit
    coverage. Administrator identity reads now include admin-only paginated/exact user
    and role DTOs, resolved memberships, bounded syllabus hydration, exactness-labeled
    role counts, and authenticated self-role reads. Administrator identity mutations now
    cover normalized user profiles, active/disabled status, role CRUD, and membership
    assignment/removal with write/version gating, PII-free audit evidence, and
    final-administrator lockout prevention. Legacy hard user deletion is adapted to
    account disablement so canonical history and audit attribution remain intact.
    Administrator episode operations now cover exact lookup, create/update lifecycle,
    nullable metadata, bounded collision-safe slugs, transactional gambling locks,
    links, and administrator-authored audio metadata with native pagination. Hard
    episode deletion is deferred until its cascade contract is verified, and remote
    audio deletion is deferred until a durable external-effect intent exists.
    Authenticated catalog URL upserts now preserve the ranked-list workflow without
    collapsing imported duplicates; administrator show edits and safe movie/show deletes
    reject indexed assignment, syllabus, review, and ranked-item references.
    Authenticated read-only TMDB search/detail actions are implemented with bounded
    inputs, results, timeouts, typed compatibility DTOs, and fail-closed transport/
    payload handling. Production and staging now contain `TMDB_API_KEY`, and real
    external-catalog search passed. The post-S4 release also added owner-derived episode
    and assignment voice-message creation plus durable abandoned-upload cleanup; the
    production Leave Message contract and authenticated browser canary passed on
    2026-08-03.
- [x] **T9 (P1, human: ~7–10d / Codex: ~3–5d)** — Workflow domains — Implement assignments, reviews, ratings, and syllabus.
  - Surfaced by: Architecture — transactional and ordered workflows replace SQL/Prisma behavior.
  - Files: `bbpc-convex/convex/assignments`, `syllabus`, `reviews`.
  - Verify: differential state/error/effect tests, concurrent reorder/submission tests.
  - Progress: assignment administration and owner/admin syllabus workflows are
    implemented and contract-generated. Assignment reads are exact or natively
    paginated, episode fanout is capped, assignment types are strict, slug generation
    preserves the legacy format with bounded collision allocation, and deletion refuses
    audio, point, syllabus, review, or gambling references. Owner syllabus writes derive
    the actor, enforce a 100-entry cap, keep pending items before assigned history,
    normalize dense descending order atomically, and require every pending ID exactly
    once for reorder. Administrator assignment linking reuses the indexed
    user/movie/episode triple, repairs missing slugs, and normalizes the affected
    syllabus transactionally. Access/write gates, ownership isolation, all insertion
    positions, collision/error behavior, reuse/repair, native pagination, concurrent
    additions, and capacity limits have synthetic regression coverage. The rating
    catalog now has anonymous bounded reads and administrator CRUD with SQL `TINYINT`
    validation and indexed review/guess deletion guards. Review creation derives the
    self-service actor, enforces exactly one movie/show target, and derives assignment
    movie relationships; administrator reads use native pagination across indexed
    rating/user combinations. Rating updates can be cleared explicitly, full review
    deletion performs a bounded atomic extra/assignment/guess cascade, and isolated
    assignment-review unlinking refuses live guesses. Filter, fanout, missing-parent,
    access, cascade, and concurrent-submission tests are included. Game workflows are
    covered in T10.
- [x] **T10 (P1, human: ~8–12d / Codex: ~4–6d)** — Game domains — Implement seasons, points, guesses, gambling, tags, quotes, and rankings.
  - Surfaced by: Code Quality — conflicting point rules and high-risk aggregates.
  - Files: `bbpc-convex/convex/games`, `rankings`.
  - Verify: canonical-rule fixtures, exact integer/scoring parity, concurrency and budget tests.
  - Progress: the game foundation checkpoint is implemented and contract-generated.
    Anonymous current-season queries accept an explicit plain date, choose the newest
    overlapping active season, ignore undated legacy rows, and enforce bounded
    inspection. Authenticated WTFIR scoring resolves the canonical correct-host,
    all-correct, and all-incorrect point types. Administrator game-type and
    game-point-type CRUD normalizes lookup IDs, enforces SQL `SMALLINT` point values,
    and blocks referenced deletes. Season administration validates real date ranges,
    uses native pagination, reports bounded exactness-labeled relationship counts, and
    refuses deletion while points, guesses, gambling entries, or quote submissions
    remain. All mutations are S3/S4 plus API-version gated and value-free audited.
    Synthetic access, collision, validation, pagination, scoring, overlap, and deletion
    tests are included. Point-event administration is now contract-generated as the
    second checkpoint: manual, lookup-derived, and assignment-linked creation; nullable
    field updates; exact/native-paginated reads; bounded user and multi-assignment
    totals; duplicate-safe assignment links; Clerk-derived available points; and public
    current-performance aggregation. Adjustments enforce nullable SQL `INT` semantics.
    Missing lookups/current seasons fail explicitly, and deletion atomically removes
    assignment links while clearing indexed guess, gambling-award, live tag-award, and
    quote-award relationships within a fixed fanout budget. Historical tag tombstones
    remain closed. Arithmetic, season selectors, ordering, pagination, defaults, broken
    relationships, availability deductions, and the full cascade have synthetic
    coverage. Guess submission is now contract-generated as the third checkpoint:
    Clerk-derived owners can upsert one prediction per host assignment review only
    while the playable assignment's episode is `next`, with current-season selection
    driven by an explicit date. Owner reads cover one or a bounded distinct assignment
    set. Administrator reads and writes support native pagination, direct and batched
    upserts, rating changes, user/season-validated point links, default or explicit
    point awards, and deletion semantics that distinguish durable accounting events
    from assignment/user cleanup. Bulk cleanup removes only award points no longer
    referenced by any guess. Open-round, invalid-host, idempotency, ownership,
    pagination, point-integrity, broken-reference, audit, shared-award, and orphan-award
    cases have synthetic coverage. Gambling is now contract-generated as the fourth
    checkpoint. Public reads expose only active type configuration. Clerk-derived member
    writes use an explicit current-season date and transactionally enforce available
    points across all pending/locked wagers before creating or updating the one
    user/season/type/assignment/target key. Assignment wagers share the playable/`next`
    round rule with guesses; normalized `-1x` types require an assignment-review-backed
    host and non-targeted types reject one. Administrator type CRUD is normalized and
    dependency-safe; entry reads use native pagination or bounded indexes; entry writes
    cover creation, balance-aware point changes, manual award links, pending-only
    deletion, typed status changes, and win/loss settlement. Settlement uses
    `floor(points * multiplier)` or `-points`, recalculates resolved awards after point
    changes, and refuses to delete an award point shared by another relationship.
    Aggregate-only rehearsal checks found no duplicate keys, negative values, missing
    seasons, unsupported statuses, or invalid target shapes among 74 rows. They also
    identified 27 preserved loss rows without awards and 13 stale win adjustments;
    explicit settlement/update paths repair those anomalies without bulk rewriting
    imported history. Access, idempotency, target/round validation, serial budget,
    pagination, lifecycle, malformed-history, and award-ownership cases have synthetic
    coverage. Tag administration is now contract-generated as the fifth checkpoint.
    The primary public/member experience was deliberately retired and remains
    archive-only. Admin catalog CRUD is normalized and bounded; exact and native
    paginated vote reads support user/TMDB filters; vote deletion preserves accounting;
    and only genuinely unawarded rows can create a current-season `tag-vote` point.
    Aggregate inspection found 2 unawarded and 2,192 historical markers among 2,194
    rows, with no invalid TMDB IDs or duplicate canonical vote keys. Historical markers
    never expose their dangling UUID through the API. The prepared one-way portable
    scrub removes those UUID values from canonical documents after raw archival staging
    is deleted, retains the non-rewardable marker, and remains compatible with restored
    reconciliation. Authorization, normalization, capacity, pagination, hydration,
    marker redaction, award idempotency, point retention, audit privacy, scrub, and
    restore semantics have synthetic coverage. Quotabunga is now contract-generated as
    the sixth checkpoint. Clerk-derived members can read their current
    `next`/`recording` submission and upsert or withdraw one row only while the episode
    is `next`; scored rows are member-immutable and administrator notes are redacted.
    Administrator operations provide bounded reads and corrections, moderation,
    deterministic caller-seeded ordering of included rows, and atomic unique placement
    awards worth 40/20/10 points. Re-awarding recalculates owned points and removes
    omitted prior awards, while missing, shared, cross-user, or cross-season point
    relationships fail closed. Aggregate inspection found two clean unscored source
    submissions and no duplicate canonical keys or invalid placement/clip-start values.
    Access/write gates, ownership, optional fields, ordering, award replacement and
    cleanup, broken relationships, bounds, and value-free audits have synthetic
    coverage. Ranked lists complete the seventh checkpoint. Authenticated owners get
    bounded filtered reads and owner/admin CRUD; administrators retain native filtered
    pagination, type CRUD, and owner transfer. Canonical items enforce one target
    matching the list type plus unique bounded ranks and targets. Existing-target
    upserts swap, new-target upserts replace occupied slots, single moves shift an
    interval, and complete reorders assign dense ranks atomically. Referenced type
    changes/deletes and broken relationships fail closed, while list deletion cascades
    through bounded items. The 1-type/3-list/19-item source shape has no invalid status,
    target, rank, or duplicate keys. Access/write gates, all target kinds, ordering,
    pagination, capacities, cascades, corruption, and audit privacy have synthetic
    coverage. T10 is complete.
- [x] **T11 (P1, human: ~4–6d / Codex: ~2–3d)** — Side effects — Implement durable intents, retries, terminal recovery, and reconciliation.
  - Surfaced by: Architecture/Tests — database and remote effects cannot share a transaction.
  - Files: `bbpc-convex/convex/sideEffects`, existing provider adapters.
  - Verify: success/timeout/duplicate/terminal failpoints and remote-state reconciliation.
  - Progress: UploadThing cleanup for episode and assignment audio now uses a durable
    canonical intent created atomically with metadata deletion. Leased dispatch calls
    the documented REST endpoint without the vulnerable provider SDK, redacts keys and
    provider responses, retries on a bounded 1m/5m/30m/2h schedule, reaches terminal
    state after five attempts, and supports compare-and-swap administrator redrive of
    terminal or succeeded intents for recovery and remote reconciliation. Duplicate
    scheduling, live/stale leases, stale completions, write-gate enforcement,
    configuration failures, HTTP/network/response classification, requester ownership,
    provider-key redaction, and remote-state reconciliation are covered. The production
    dependency audit reports zero advisories. The portable schema now retains the
    intent table and refuses the one-way scrub while any unresolved intent exists; the
    updated read-only backup dry run verified all eight immutable manifests, 32
    canonical tables, and 9,283 rows without changing state or files. Profile uploads
    now verify the authenticated write gate before the provider accepts a file,
    atomically adopt the new image/key while queuing the prior key, and attempt durable
    cleanup of an unadopted new file if adoption fails, explicitly surfacing operator
    recovery when that second write is unavailable. Provider keys and opaque upload IDs
    remain server-only. The admin consumer exposes redacted native pagination, status filters,
    compare-and-swap terminal retry, and successful-intent remote reconciliation at
    exact `/admin/side-effects`; its production build and all 84 tests pass. T11 is
    complete. Durable profile adoption is committed as `9c56063` in `bbpc-convex`,
    the operator recovery console as `23481ec` in `bbpc-admin`, and the public
    UploadThing/Convex profile flow as `b276962` in `bbpc`.
- [x] **T12 (P1, human: ~5–8d / Codex: ~2–4d)** — Primary consumer — Move `bbpc` behind Clerk and Convex compatibility adapters.
  - Surfaced by: Architecture — preserve contracts before direct-client modernization.
  - Files: `bbpc/src/server`, auth/provider, app tests.
  - Verify: package contracts, route smoke, critical Playwright flows, no direct Prisma in migrated paths.
  - Progress: the SQL-default Clerk/Convex provider and middleware scaffold is committed.
    Anonymous compatibility slices now route `episode.next`, bounded search, paginated
    history, and legacy-ID lookup to the public episode API only in explicit Convex
    mode; the server-rendered `/next` and `/episodes` pages plus the sitemap use the same
    adapter without reaching SQL. The history adapter preserves the current archive
    contract with 20-row native pages, a 1,000-episode ceiling, and stalled-cursor
    detection. A server-only adapter validates every result against a storage-neutral
    public episode DTO, and presentation components no longer require Prisma-shaped
    episode records. Aggregate-only probes against the local
    production-clone deployment validated search plus all 634 history rows across 32
    pages without emitting row values. Episode detail and metadata resolution now use
    Convex slug/legacy-ID lookup in Convex mode. A purpose-built backend results query
    preserves the public winning-gamble/correct-guess section without exposing broad
    game records; it independently caps every relationship class at 50, rejects missing
    parents, and omits emails, notes, losing wagers, and incorrect guesses. The SQL path
    maps its existing result graph into the same runtime-validated DTO. The backend full
    gate passes with 272 tests and 96.43% statement/90.11% branch coverage; an
    aggregate-only local probe returned a valid bounded result. The home page now reads
    its latest published episode from Convex in explicit Convex mode and uses a
    Clerk-authenticated, boolean-only backend query for the signed-in winner banner;
    anonymous requests do not send an authentication token. Its production-runtime
    smoke also caught and fixed an i18n matcher interaction by disabling locale
    injection on all Clerk middleware matchers. The local production server now marks
    the anonymous request signed out, applies the locale rewrite, and renders without a
    server error. The shared application shell now chooses a storage-neutral client
    identity context: SQL mode retains NextAuth, while Convex mode uses Clerk and does
    not import or call the legacy server-session module from the root layout. Clerk
    subjects are never exposed as canonical application user IDs; unfinished legacy
    client pages receive an explicitly null compatibility session until their own
    adapters migrate. The public game page now reads its next episode, public scoring
    configuration, and current-season performance directly from runtime-validated
    Convex adapters instead of SSR-fetching its own tRPC endpoint. The scoring boundary
    was corrected to anonymous access because those values are already public game-rule
    content. The production-clone probe validated the scoring contract and a bounded
    current-performance result with four user summaries and 156 points without emitting
    row values. Signed-in assignment voice-message writes remain explicitly read-only
    until their durable media workflow migrates. The
    shared Clerk shell now performs a one-shot, runtime-validated canonical account
    resolution after Convex authentication is ready. It reads the linked BBPC profile
    first and invokes the idempotent, API-versioned `linkOrCreateMe` mutation only for
    `IDENTITY_NOT_LINKED`; write-disabled, stale-client, disabled-account, and conflict
    states remain explicit and never substitute a Clerk subject for an application
    foreign key. The `/profile` route now chooses SQL or Convex before importing either
    implementation, so Convex mode cannot reach Prisma or NextAuth. Its Convex page
    supports gated display-name updates, owner-derived syllabus preview and current
    available points, plus a new owner-only 20-row native-paginated point history.
    Anonymous point-history reads fail authentication, cross-user events are excluded,
    invalid page sizes fail closed, and every browser response is runtime-validated.
    Profile-image writes now use the gate-checked UploadThing/Convex saga described in
    T11: adoption is canonical and prior/unadopted file cleanup is durable.
    The backend full gate now passes with 285 tests at 96.48% statement/90.18% branch
    coverage. An anonymous Convex-mode production runtime smoke returned HTTP 200 for
    `/profile` through Clerk middleware with no application/server error; signed-in
    linking E2E still requires real local Clerk keys. The protected `/syllabus` route
    now also selects its implementation before importing legacy auth or Prisma. The
    Convex client derives ownership exclusively from the linked actor and supports
    bounded list, add, remove, complete pending-order replacement, and notes updates
    through runtime-validated, API-versioned calls with optimistic rollback. Movie
    selection searches the migrated public catalog and can use the authenticated TMDB
    action plus catalog upsert when configured; if TMDB is unavailable, catalog results
    remain usable and the failure is explicit. Actual local TMDB smoke remains gated on
    the separately approved secret-copy phrase. The live-participation migration has
    started with Quotabunga: authenticated listeners can now load, create, edit, and
    withdraw their owner-derived submission without sending a user identifier. The
    client runtime-validates every response, sends the Pacific plain date needed for
    season resolution, and presents distinct closed, locked, scored, stale-client,
    write-disabled, conflict, and validation states. Rating predictions are now live as
    well. A new bounded anonymous catalog exposes only active hosts' IDs, names, and
    images, deduplicates multiple administrator roles, and fails closed above explicit
    role and membership caps. The primary client loads that catalog with the rating
    scale, active-season flag, scoring rules, and owner-derived saved guesses, then
    performs API-versioned optimistic saves with complete rollback. Local-clone
    aggregate smoke found three hosts and four ratings without emitting record values.
    Assignment wagering is now live through the existing risk-review interaction using
    storage-neutral controls. Its Convex adapter loads the bounded active wager catalog,
    owner-derived assignment entries, and owner-derived available balance, then refreshes
    canonical state after every API-versioned save or failed attempt. Locked and resolved
    wagers remain immutable. Assignment voice messages remain visibly read-only; the
    legacy SQL game path is unchanged. The public `/year` archive now selects its
    implementation before importing a controller and reads a bounded, privacy-minimized,
    runtime-validated Convex year-review feed without requiring authentication. In list
    view, a canonically resolved BBPC admin can manage owner-derived movie ranked lists
    through API-versioned upsert, remove, and complete-order replacement calls with
    canonical reloads and rollback on failure. The legacy SQL year path remains
    unchanged. Public assignment routes now resolve normalized slugs and transitional
    legacy UUIDs through a privacy-minimized Convex DTO, with missing relationships and
    unsupported assignment types failing closed. Convex mode selects that route before
    importing the Prisma resolver or legacy game panel and reuses the canonical-account,
    owner-derived prediction and wagering clients for single-assignment play. Durable
    assignment voice-message writes remain explicitly read-only. The protected `/call`
    route now chooses Clerk or NextAuth before importing either controller, and the
    obsolete `/games` listing—whose item links had no corresponding route—now redirects
    to the supported `/game` experience without reading SQL. The episode “Add Extra”
    route now resolves episodes through Convex before importing its controller, gates
    the form on canonical Clerk identity, searches both the bounded migrated
    movie/show catalogs and authenticated TMDB actions, preserves catalog fallback when
    TMDB is unavailable, and creates owner-derived movie/show extra reviews through
    runtime-validated API-versioned writes. Its episode-page affordance now uses a
    canonical `isHost` capability derived from the normalized Convex `Host` role;
    administrator status does not implicitly grant that capability, and Convex mode no
    longer calls the SQL-backed host check.
    TypeScript, 50 primary
    tests, changed-file ESLint, and both the SQL-default and local-clone Convex-mode
    659-page production builds pass.
    Full-project ESLint remains red on pre-existing unrelated JSX escaping errors.
    Because the generated package has no reachable registry release, the deployable
    consumer temporarily owns this narrow checked contract instead of depending on a
    sibling checkout. The private backend source remote now exists; package publication
    and pinned contract replacement remain part of the T12 gate. The current
    profile-image consumer slice is committed as `b276962`.
  - Production switched to Convex during `prod-cutover-20260802-01`; public route,
    linked-profile, Google sign-in, game, TMDB, and post-S4 Leave Message canaries pass.
    SQL and NextAuth remain only as dormant source branches pending T17 deletion.
- [x] **T13 (P1, human: ~7–10d / Codex: ~3–5d)** — Admin consumer — Move `bbpc-admin` behind Clerk and Convex compatibility adapters.
  - Surfaced by: Architecture/Code Quality — admin policy and behavior need explicit migration.
  - Files: `bbpc-admin/src/server`, auth/provider, app tests.
  - Verify: authorization/destructive/order/concurrency E2E and contract parity.
  - Progress: the SQL-default admin shell now pins the same Clerk and Convex client
    versions as the primary app and resolves canonical identity through the shared
    API-versioned profile/linking boundary. Administrator capability comes only from
    the linked Convex role, never from a Clerk subject or client metadata. Convex mode
    currently fail-closes every unported page before legacy server props can execute,
    returns 503 for legacy API routes, and exposes only the identity-gated landing page
    plus static about page; SQL behavior remains unchanged. The landing page is now a
    functional Convex administrator dashboard backed by an admin-only, privacy-minimized
    overview query. Its exact counts and recent episode, syllabus, and guess summaries
    are all protected by explicit hard read caps; broken relationships and cap overflow
    fail closed. The browser owns a narrow Zod contract, rejects drifted responses,
    provides an explicit retry without falling back to SQL, and leaves links to unported
    editors non-interactive. The backend full gate passes with 299 tests at 96.40%
    statement/90.08% branch coverage. Role administration is the first admitted
    write domain: `/role` selects its backend before loading NextAuth or the SQL SSR
    helper, and its direct Convex adapter runtime-validates bounded role summaries plus
    create, update, and safe delete results. The UI disables deletion while memberships
    exist, while the backend remains authoritative for referential conflicts and
    final-active-administrator protection. Convex navigation now hides every unported
    route instead of advertising redirect-only tools. The baseline 189-procedure
    authorization inventory remains current. Canonical user administration is also
    admitted at exact `/user`; `/user/[id]` was left closed at that checkpoint and is
    admitted below. The direct index adapter
    uses native 50-row pagination, runtime-validates hydrated roles and next-syllabus
    summaries, and versions every create, update, status, assign-role, and remove-role
    mutation. The Convex UI intentionally replaces legacy hard deletion with reversible
    active/disabled status, keeps duplicate-email and final-administrator protection
    authoritative in the backend, and never falls back to SQL on failure. The bounded
    rating-definition catalog is now admitted at `/rating` with versioned create/update/
    safe-delete calls and runtime-validated nullable presentation fields. Deletion
    remains backend-rejected while either a review or guess references the rating.
    The bounded season catalog is now admitted at exact `/season` while the mixed
    `/season/[id]` leaderboard and scoring tools remain closed. Native pagination,
    runtime-validated game-type relationships, Pacific-date status display, and
    versioned create/update calls replace the legacy SQL page. The UI only enables
    deletion when exact bounded counts show no points, guesses, gambling entries, or
    quote submissions; the backend repeats the authoritative referential check.
    Exact `/game` is now admitted as one complete Convex catalog rather than a hybrid:
    game types, point types, and gambling types load through three bounded,
    runtime-validated queries, and all nine create/update/safe-delete calls carry the
    client API version. Point values preserve the migrated SQL SMALLINT range, wager
    multipliers remain finite and non-negative, inactive wager types preserve history,
    and every destructive call is rejected authoritatively while references remain.
    The global syllabus is now admitted at exact `/syllabus` with native 50-row
    pagination, fully hydrated and runtime-validated user/movie/assignment
    relationships, explicit retry, and versioned entry removal that preserves movie
    and assignment records. Its backend now independently caps every admin page request
    at 100 rows and has an oversized-request regression test. Tags and votes are now
    admitted at exact `/tag`: the 100-item catalog and native 50-row vote pages are
    runtime-validated, catalog CRUD is versioned, and award controls distinguish
    unawarded rows from live points and migrated legacy-award tombstones. Only an
    unawarded vote with a canonical user can request current-season points, while vote
    deletion explicitly preserves live or historical award evidence. Exact `/episode`
    now exposes a deliberately narrow catalog boundary: native 20-row pages and
    versioned pending-episode creation are available, while relationship-heavy detail
    editing and deletion remain closed and unadvertised. The public episode API now
    authoritatively caps all page requests at 50 rows with oversized-request coverage.
    The legacy duplicate `/gambling` route now resolves to the same Convex game
    configuration implementation with its gambling tab selected, so the second URL no
    longer creates a parallel client contract or divergent behavior. Ranked-list
    template administration is now admitted at exact `/admin/ranked-types` with the
    bounded authenticated catalog and versioned create/update/safe-delete calls.
    Runtime validation fixes the target enum and 1–100 capacity, while the backend
    rejects incompatible target/capacity changes and deletion of referenced types.
    Exact `/movie` and `/show` now expose bounded 30-row canonical catalogs, explicit
    authenticated TMDB search, URL-idempotent versioned saves, and administrator-only
    relationship-safe deletion. Movie saves retain the TMDB ID. Both index routes
    link to their now-admitted read-only detail views in Convex mode. The anonymous backend
    list procedures now independently enforce a 50-row ceiling with oversized-request
    coverage. Ranked lists are now admitted at exact `/lists` plus one constrained
    `/lists/{id}` segment. Canonical identity owns list creation and owner reads;
    administrators receive a separate native 30-row system view and bounded ownership
    transfer selector. The detail adapter runtime-validates target-exclusive movie,
    show, and episode items, and versions title/status, target upsert, comment, move,
    item removal, list removal, and ownership writes. Target search stays inside the
    canonical Convex catalogs, avoiding any hidden SQL or TMDB dependency during list
    editing. The SQL implementations remain isolated behind the SQL build selector.
    Exact `/review` now uses native 30-row pages with indexed rating, unrated, and user
    filters; runtime validation enforces exactly one movie/show target and bounded
    relationship hydration. Rating changes are versioned. Destructive review removal
    first fetches exact assignment-link, extra-link, and guess counts, displays that
    cascade explicitly, and sends the same counts back as a compare-and-swap condition;
    the backend rejects deletion if the impact changed after confirmation. Exact
    `/quotabunga` is now admitted through its complete bounded administrator contract:
    episode and submission selectors enforce backend caps, responses are
    runtime-validated against canonical user/episode/season/point relationships, and
    create, correction, moderation, deterministic caller-seeded randomization, award,
    and delete writes are API-versioned. Placement selection remains unique across
    40/20/10 awards. Award replacement and owned-point deletion display their exact
    inspected impact and send point/placement snapshots back to the mutation; Convex
    rejects either write if another administrator changed award state after inspection,
    while shared or cross-owner points remain undeletable. The first 50 canonical users
    are available for on-behalf creation with an explicit incomplete-selector notice.
    Exact `/banger` is now admitted through a native title index and 30-row pagination.
    Its administrator-only contract validates HTTP(S) URLs, canonical optional episode
    and user relationships, normalized title/artist bounds, and API-versioned create,
    update, and delete writes. The delete confirmation sends the exact inspected title,
    artist, URL, episode, and user snapshot so a concurrently edited song is not
    removed. The editor exposes bounded relationship selectors, retains an existing
    linked record outside those first pages, and labels incomplete selectors instead of
    issuing unbounded reads. Exact one-segment `/movie/{id}` and `/show/{id}` detail
    routes are now admitted as administrator-only, read-only views. Each accepts one
    exact canonical identifier, enforces a 100-review backend ceiling, reuses the
    hardened bounded review hydrator, and fails closed on broken or oversized
    relationships. The browser contract additionally verifies that every review has
    exactly one target matching the requested media record. Linked episodes are shown
    without opening the still-closed episode workbench, and deeper movie/show paths
    remain outside the allowlist. Exact one-segment `/season/{id}` is now admitted
    through an administrator-only detail adapter. The backend supplies independent
    native 30-row point, guess, and wager pages plus an exact performance aggregate
    capped at 2,000 rows per activity kind. The aggregate includes zero-point
    participants, validates user and point-type relationships, and fails closed without
    disabling the paginated activity feeds. The browser verifies every activity row
    belongs to the requested season, exposes bounded-count notation, preserves
    API-versioned season editing, and left the user workbench unlinked at that
    checkpoint; the user and point workbenches are admitted below. Exact one-segment
    `/episode/{slug}` is now admitted as a canonical
    administrator workbench. It resolves the public slug to one exact episode before
    loading the authenticated detail, caps assignments and extras at 50, versions
    episode edits with the exact loaded snapshot, and rejects stale link removal.
    Audio metadata uses native 30-row pages and permits manual HTTPS URL creation;
    deletion requires an exact snapshot and atomically queues durable UploadThing
    cleanup when an external file key is present. Current and
    next-episode show notes are available, with versioned internal-note saves.
    Assignment and extra relationships remain read-only on the episode page; the
    assignment workbench is admitted below while extra editing remains closed. The
    legacy UploadThing endpoint retains fake
    authorization, so it stays disabled in Convex mode and is not part of this
    workbench. Exact one-segment `/assignment/{slug}` is now admitted through a
    canonical administrator workbench. A tailored backend read caps assignment reviews
    at 50 and aggregate guesses and wagers at 500 each, validates every user, rating,
    season, media, award, and gambling-type relationship, and fails closed on
    cross-target reviews. Slug, type, review-rating, guess-rating, guess-removal, wager
    status, and assignment-removal writes send the exact loaded state; review creation,
    review unlinking, and guess creation remain API-versioned. Awarded guess deletion is
    intentionally unavailable in this workbench, assignment-review unlinking remains
    blocked while guesses exist, and assignment deletion remains authoritative across
    audio, point, syllabus, review, and wager references. Assignment audio uses native
    30-row pages with exact metadata deletion and durable UploadThing cleanup for
    externally keyed files. User and season selectors disclose when their
    first bounded pages are incomplete, and the episode workbench now links canonical
    assignment slugs to this tool. Exact one-segment `/point/{id}` is now admitted
    through a bounded administrator workbench. Its tailored read validates and caps
    every assignment, guess, gambling, tag-vote, and quote relationship at 100 rows,
    hydrates canonical assignments for guess awards, and exposes exact deletion-impact
    counts. Movie-title, episode-title, and exact episode-number assignment search is
    capped at 30 results and fails closed on duplicate episode numbers. Point edits send
    the complete loaded user, season, reason, adjustment, point-type, and earned-time
    snapshot; unlinking sends the exact link identifier; deletion sends both that point
    snapshot and the exact five-category relationship impact. The backend rechecks all
    of those conditions before writing, preserves scoring evidence while clearing its
    point award, and rejects broken guess relationships or concurrent drift. The SQL
    point page remains isolated behind the SQL build selector, while Convex mode loads
    no tRPC, Prisma, or NextAuth code path. Exact one-segment `/user/{id}` is now
    admitted as a native administrator workbench. Its exact canonical user read and
    maximum-100 syllabus read fail closed on broken relationships, while points,
    guesses, wagers, and tag votes use independent native 30-row pages and the point
    total remains exact. The browser verifies every activity row belongs to the
    requested user and, for an explicit season filter, to that exact season. Profile,
    status, role removal, syllabus assignment/unlink/removal, and wager-point edits
    carry the complete loaded snapshot; wager status changes carry the exact prior
    status. Pending-syllabus reorder requires the complete duplicate-free pending set
    with every loaded order, then preserves assigned rows and writes a dense order.
    Point and wager creation remain API-versioned, and tag-vote awards preserve their
    existing evidence semantics. Point rows link to the already-hardened point
    workbench instead of duplicating destructive behavior. Season, role, game-type,
    and episode selectors stay bounded and disclose incomplete first pages. The SQL
    user page remains isolated behind the SQL build selector, while Convex mode loads
    no tRPC, Prisma, NextAuth, or UploadThing path. Eighty-four
    admin tests, the 189-procedure authorization inventory, strict
    TypeScript, warning-free changed-file lint, both SQL-default and local-Convex
    production builds, and the 299-test backend full gate pass at 96.40% statement and
    90.08% branch coverage. Individual admin
    domains will be admitted through the middleware allowlist only after their direct
    adapters pass. The redacted side-effect recovery surface is committed as
    `23481ec`.
  - The complete admitted administrator surface deployed during the production cutover.
    Dashboard, management, recording redirect, Google sign-in, and accepted legacy-503
    canaries pass without a production SQL credential. Dormant SQL/tRPC branches remain
    only for T17 source and dependency removal.
- [x] **T14 (P1, human: ~3–5d / Codex: ~1–2d)** — Pipeline consumer — Replace BBPC SQL access with typed Convex M2M calls.
  - Surfaced by: Architecture — least-privilege Python service boundary.
  - Files: `bbpc-pipeline/lib`, callers, pytest.
  - Verify: M2M denial matrix, retries/idempotency, typed errors, zero application-data `pyodbc`.
  - Offline implementation on 2026-07-24 adds a least-privilege
    `pipeline:publish` content surface: exact episode/context reads by date or ID,
    native 100-row movie/date pages, bounded poster reads, exact-snapshot SEO
    publication, and idempotent audio-metadata episode creation with server-side slug
    allocation. Duplicate dates, broken relationships, stale SEO, metadata drift,
    missing permissions, disabled writes, and malformed bounds fail closed.
  - `bbpc-pipeline` now uses one runtime-validated Functions API client with bearer
    authentication, typed transport/contract/domain errors, bounded retry for queries
    and the two target-state-idempotent mutations, and value-free stable operation IDs.
    Long-running jobs can use the pinned official Clerk Python SDK to mint cached
    15-minute JWTs scoped to the configured Convex receiver machine and refresh them
    one minute early; a mutually exclusive pre-minted JWT remains available for
    one-off local probes. Episode resolution, movie extraction/catalog fallback,
    thumbnails, SEO publishing, backfill, and evaluation utilities have no SQL
    fallback; `pyodbc` and all SQL environment variables are removed.
  - A read-only readiness probe now mints or accepts the short-lived JWT,
    validates `iss`, `sub`, the configured receiver machine in `aud`, and expiry,
    derives Convex's canonical `issuer|subject` token identifier, and prints no token,
    machine secret, unrelated claims, episode fields, or movie fields. Before live
    provisioning, an aggregate-only control read confirmed the local clone has
    one S1 system state for `dev-rehearsal-20260724-01`, application writes
    disabled, no first application write, and zero service principals.
  - Offline verification passes 134 pytest tests plus 15 subtests, entry-point
    compilation, and a zero-result scan for SQL/pyodbc dependencies. The backend full
    gate passes 310 tests, 56 migration-extractor tests, query/access audits, TypeScript,
    lint, 96.33% statement coverage, and 90.01% branch coverage.
  - Real Clerk M2M acceptance passed on 2026-07-25 using a dedicated pipeline source
    machine scoped to a separate Convex receiver. Convex retains the human
    `applicationID=convex` provider and validates pipeline JWTs through the receiver
    machine audience. The exact issuer/subject was pre-provisioned idempotently with
    only `pipeline:publish`; authenticated capability and aggregate-only content reads
    succeeded. An aggregate traversal returned 630 episode dates, and an exact context
    read found two related movies without emitting row values.
  - The live denial matrix rejects unauthenticated access, a pipeline token at the
    administrator boundary, a valid Clerk token for the wrong receiver (HTTP 401), an
    expired token (HTTP 401), and the active token while its principal is disabled.
    Disable/re-enable restored access and produced the expected two value-free audit
    transitions. An S1 application mutation failed with `WRITE_DISABLED`; the preserved
    run still has writes disabled and no first application write.
  - After S3, the production pipeline publish smoke and its idempotent replay passed
    with only `pipeline:publish`. Token acquisition, audience validation,
    capability/read access, provisioning replay, denial, expiry, revocation, and the
    positive write path are complete without exposing credentials or migrated values.
    The reviewed source remains commit `5dd3fe5` in `bbpc-pipeline`; its private Git
    bundle is retained with the cutover evidence because the repository has no remote.
- [x] **T15 (P1, human: ~5–8d / Codex: ~3–5d)** — Acceptance — Run whole-system tests and two production-scale rehearsals.
  - Surfaced by: Tests/Performance — recovery and latency are hard gates.
  - Files: cross-project E2E, migration manifests, runbooks.
  - Verify: two identical passes within the approved SLO, real backup restore, S2 rollback.
  - The 2026-07-24 offline acceptance matrix is green. `bbpc` passes all 50
    tests, strict TypeScript, lint with no errors, and both SQL-default and
    Convex-mode production builds with all 659 static pages generated.
    `bbpc-admin` passes all 81 tests, strict TypeScript, the 189-procedure
    authorization inventory, lint with no errors, and both build modes with all
    26 static pages generated. The Convex package boundary passes with six
    exported contract files and a consumer typecheck; its full backend gate
    remains green at 310 tests plus 56 migration-extractor tests. The pipeline
    remains green at 134 pytest tests plus 15 subtests with no application SQL
    or `pyodbc` dependency. All four Git worktrees are clean after the public
    lint-gate fix in `c4aa3f0`.
  - Convex-mode builds used a syntactically valid, non-live Clerk publishable-key
    fixture supplied only through the process environment. This proves static
    compilation and selector isolation but does not authenticate a user or
    service. Real pipeline capability/read and denial/expiry/revocation probes are now
    complete; its positive idempotent write remains intentionally blocked at S1. Real
    member/admin browser E2E is now complete. Both production-scale data rehearsals,
    private portable backups, disposable restores, and the second run's S2 rollback
    evidence are complete.
    Archive-source data remains backup-only and must not be promoted into the
    live Convex application model.
  - Real-key browser acceptance began on 2026-07-25. The public app loaded the preserved
    Convex latest/up-next episode data and the configured Clerk sign-in form. The admin
    login gate exposed a Convex-selector leak: a nested `SessionProvider` still fetched
    NextAuth state. Convex mode now renders only the Clerk/Convex provider stack, with
    the fix committed as `dbf3543`; 81 tests, strict TypeScript, the 189-procedure
    authorization inventory, and lint with no errors remain green. Authenticated
    member/admin acceptance awaits the smoke account sign-in and S1 pre-provisioning.
  - The same acceptance pass then exposed two public selector leaks: the Convex provider
    stack still nested `SessionProvider`, and the home-page next-episode component still
    mounted a tRPC query. During discovery, legacy NextAuth refreshed session-maintenance
    fields in the isolated development SQL clone; no production database or application
    content was touched. The process was stopped immediately. Convex mode now omits the
    NextAuth provider, reads both home-page episode cards directly from Convex, and
    returns a no-store 404 from the public and admin middleware for legacy `/api/auth`
    and `/api/trpc` routes. The public fix is committed as `0837bbc`; the admin
    defense-in-depth guard is `2d29a40`.
  - Both applications subsequently passed real-key production builds with
    `DATABASE_URL` replaced at the process boundary by an unreachable sentinel. The
    public build generated all 659 static pages and the admin build generated all 26
    pages without a SQL connection. A live public browser pass with the same sentinel
    rendered preserved Convex latest/up-next data, emitted no runtime errors, made no
    SQL/NextAuth/tRPC request, and returned 404 for direct legacy API probes. The apps
    are now left running locally with that sentinel for the Clerk callback. An
    aggregate-only Clerk lookup after the first reported sign-in found zero users, so
    no identity was provisioned and authenticated browser acceptance remains pending.
  - Convex mode no longer mounts a tRPC provider in either application. Public
    SQL-only hooks for voice-message episode lookup and host authorization now live in
    SQL-only child controllers, `/history` selects its backend before loading the SQL
    query and uses the paginated Convex episode adapter directly, and game
    participation now has a deterministic hydration boundary. Admin selects the raw
    Clerk/Convex app and dashboard controller without `withTRPC`; its SQL dashboard
    remains behind the SQL controller. A clean SQL-unreachable browser sweep covered
    public home, history, game, year, about, episode index, and episode detail plus the
    anonymous admin login gate with zero runtime or console errors. Both real-key
    production builds again passed with SQL unreachable (659 public and 26 admin
    pages), as did 50 public tests, 81 admin tests, strict TypeScript, changed-file
    lint, and the 189-procedure authorization matrix. These changes are committed as
    `95172ee` in `bbpc` and `f2d8d6b` in `bbpc-admin`.
  - The SQL-unreachable anonymous sweep also covers public profile, syllabus, call,
    invalid-assignment handling, and add-extra routes, plus admin home, roles, users,
    episodes, movies, seasons, Quotabunga, ranked-list types, and the unported recording
    redirect. All fourteen routes completed without a navigation failure, runtime
    overlay, or console error. This anonymous evidence was subsequently supplemented by
    the authenticated acceptance pass below.
  - Authenticated member/admin acceptance passed on 2026-07-26. The Clerk instance was
    missing its Convex JWT template, so authenticated token acquisition returned 404;
    a `convex` template with the required audience was configured, and a current
    session then produced the expected issuer, subject, audience, and 60-second lifetime
    without exposing the token. Aggregate-only identity resolution found one exact,
    conflict-free recent administrator match among three migrated administrators and
    pre-provisioned that smoke identity in S1. Ordinary email linking remains disabled.
    The authenticated public sweep covered home, profile, syllabus, game, and year; the
    administrator sweep covered the dashboard plus roles, users, episodes, movies,
    seasons, shows, ratings, reviews, game configuration, gambling, Quotabunga, Bangers,
    ranked lists, syllabus, and ranked-list types. Every route completed without an
    access failure or runtime overlay. The sweep exposed and fixed one signed-in public
    hydration mismatch and one invalid ranked-list card nesting; clean browser rechecks,
    50 public tests, 81 admin tests, strict TypeScript, changed-file lint, and
    SQL-unreachable production builds with 659 public and 26 admin pages all pass. The
    fixes are committed as `5a66fc2` in `bbpc` and `6b20b9d` in `bbpc-admin`.
    A value-free rehearsal inspector now proves the linked smoke-identity count,
    existing/active/admin-linked user counts, pre-provision audit count, ordinary-link
    audit count, S1 write gate, and absence of a first application write. The live
    aggregate result is one pre-provisioned active administrator identity with zero
    ordinary links; all eight domains remain reconciled and all 62 checkpoints remain
    complete. The backend gate passes at 311 tests plus 56 extractor tests with the
    90% branch-coverage threshold restored. The inspector is committed as `0b2e045`.
    A real Clerk-authenticated, correctly versioned member mutation also failed with
    `WRITE_DISABLED` in S1. Its deliberately invalid payload could not write even if
    the gate regressed, and the post-probe aggregate evidence still shows application
    writes disabled with no first application write.
  - The 2026-07-26 follow-up resolved the reported Clerk `Not Found` overlay. Read-only
    Clerk probes proved that the configured key pair sees the `convex` template and that
    the active session can mint the expected token; the public server now retries only
    Clerk API 404s during the short post-sign-up propagation window (`cffc5cc`). The JWT
    template was also corrected to include only the standard `name`, `picture`, `email`,
    and `email_verified` claims required by Convex account linking, while retaining
    audience `convex`, a 60-second lifetime, and five-second skew. A replacement token
    passed value-free audience and claim checks.
  - The ordinary S1 identity-link smoke call now reaches Convex with the real Clerk token
    and returns `WRITE_DISABLED` as designed. The newest Clerk identity still resolves
    to a migrated administrator rather than a non-administrator, so no second smoke
    identity was pre-provisioned. Aggregate evidence remains one linked active
    administrator, one pre-provision audit, zero ordinary-link audits, writes disabled,
    and no first application write.
  - Audited administrator impersonation is complete across the backend and both
    consumers. Authenticated browser acceptance proved the admin users table reaches
    `/user/[id]`, the Settings tab exposes the reason/duration controls, and S1 visibly
    rejects session creation without a runtime error or persisted write. The full
    backend gate passes 314 tests plus 56 extractor tests and package consumer
    typechecking; public passes 50 tests and admin passes 81 tests. SQL-unreachable
    production builds again generated 659 public and 26 admin pages.
  - An authenticated Clerk identity whose email was absent from the migrated user set
    exposed an account-recovery defect: optional home-page personalization propagated
    `IDENTITY_NOT_LINKED` before the sign-out UI could render. The home page now treats
    account-resolution failures and sign-out token races as absent optional
    personalization, and the shared shell presents a persistent recovery banner with
    retry and sign-out actions. Real-browser acceptance signed the invalid identity out
    through that banner with no runtime overlay. S1 evidence remained unchanged at one
    pre-provisioned administrator identity, zero ordinary links, writes disabled, and
    no first application write. The fix is committed as `e74cfe4`; 50 public tests,
    strict TypeScript, changed-file lint, and the 659-page SQL-unreachable build pass.
  - The real non-administrator S1 smoke identity is now accepted. Its active Clerk
    session had complete Convex claims and exactly one migrated, non-admin user match.
    Before provisioning, the browser presented the expected read-only unlinked-account
    warning and the ordinary linking path remained blocked. The run-scoped internal
    provisioning operation then created the second audited identity link. Aggregate
    evidence now shows two linked active users, one linked administrator, two
    pre-provision audits, zero ordinary-link audits, application writes disabled, and
    no first application write. A clean browser refresh rendered the member profile
    with sign-out available and no account warning or runtime overlay.
  - The second-rehearsal restore workflow's separately acknowledged S2 rollback
    exercise passed for `dev-rehearsal-20260727-02`. Exact restore hashes and the full
    reconciliation replay passed before the disposable target transitioned S1→S2→S0.
    Application writes remained disabled, the first application write remained absent,
    and the actor-scoped S0→S1, S1→S2, S2→S0 audit sequence matched before the target
    was deleted. Aggregate-only evidence is committed in `bbpc-convex` as `3bce5ef`.
  - The plan's strict “smoke identities in each rehearsal” interpretation was resolved
    by the approved third run `dev-rehearsal-20260727-03`. A fresh target repeated all
    eight domains, 62 checkpoints, 9,283 SQL-derived rows, and the 828-row recording
    catalog. It pre-provisioned one administrator, one ordinary member, and one
    publish-only pipeline principal in S1; all three authenticated reads passed, all
    three application-write probes returned `WRITE_DISABLED`, an unlinked identity
    returned `IDENTITY_NOT_LINKED`, and the audited pipeline
    active→disabled→active cycle passed without a first application write.
  - The aggregate local performance matrix is now recorded in
    `bbpc-convex/PERFORMANCE_ACCEPTANCE_RESULT_2026-07-27.md`. Against the existing
    production-derived SQL-clone baseline, all three anonymously comparable Convex
    workflows pass the 20% p95 gate: latest episode 1.219 ms versus 32.392 ms, the
    50-episode page 1.341 ms versus 92.139 ms, and current-season performance 0.529 ms
    versus 33.789 ms. Four-request concurrency also passed with zero observed errors.
    The clean second migration was 17.989% shorter than the investigation-bearing first
    run and completed migration plus exact restore validation in 554.881 seconds.
    Sixty development-browser navigations across five public routes and the anonymous
    admin gate all returned HTTP 200; those development-mode figures are diagnostic
    only and the deployed canary remains a T16 gate. The guarded benchmark tool and
    percentile/safety tests live under `bbpc-convex/local-tools/performance/`.
    The strict third run then completed the authenticated p50/p95/p99 matrix. All six
    workloads pass the 20% p95 gate: public p95s are 0.959/1.410/0.404 ms and
    administrator/member/pipeline p95s are 0.467/0.385/0.786 ms against SQL baselines
    of 30.492–92.139 ms. Its private snapshot contains 45 tables and 10,559 rows:
    10,111 canonical rows, two approved identity links, and 446 reduced audit events.
    Every table hash matched in the disposable restore, the replay reused all 9,283
    migration rows with zero inserts, all 828 recording rows remained intact, and the
    S1→S2→S0 rollback passed before the disposable target was deleted. Aggregate
    evidence is recorded in
    `bbpc-convex/MIGRATION_REHEARSAL_RESULT_2026-07-27-03.md`; T15 is complete.
    The final backend gate passes TypeScript, lint, query/access audits, 64 extractor
    tests, 11 recording-tool tests, eight staging-tool tests, 10
    performance/identity-tool tests, all 369 Convex
    tests, 90.22% branch coverage, and the package consumer typecheck.
    On 2026-07-30 Tony assigned himself as primary and backup for every operator role,
    approved the measured 30/15/45-minute deadlines, selected the same rehearsed
    administrator/member smoke identities, and accepted communication and retention
    ownership. The single-operator arrangement has no personnel redundancy and makes
    Tony's unavailability a no-go condition. On 2026-07-30 he scheduled the nearest
    Saturday window for 2026-08-01 at 12:00 PDT (`America/Los_Angeles`), approved the
    proposed start/rollback/completion messages, selected this Codex task as the
    operator log and existing in-app read-only messaging as the user channel, and set
    30-day portable-backup and 90-day immutable SQL-archive retention after successful
    S4. The completed input record is in `bbpc-convex/CUTOVER_GO_NO_GO.md`.
- [x] **T16 (P1, human: ~1–2d / Codex: ~1d)** — Production — Execute S0–S4 coordinated cutover.
  - Surfaced by: Architecture — all SQL writers switch together with an explicit point of no return.
  - Files: deployment configuration, signed go/no-go and operational artifacts.
  - Verify: S2 acceptance/backup/restore, audited S3 transition, post-cutover canary metrics.
  - The consumer deployment sequence is now explicit in
    `bbpc-convex/CONSUMER_CUTOVER_RUNBOOK.md`. S2 keeps every legacy Vercel variable
    so both auto-deployed consumers can roll back to SQL; S4 removes and then revokes
    legacy credentials only after the first post-S3 write has closed that rollback
    boundary. Exact retain/remove inventories cover both primary apps and the later
    recording handoff. Full Convex builds prove all 659 public and 28 admin pages with
    every listed legacy variable absent. Checkpoint: `d966f40`.
  - A value-free production-readiness inventory is recorded in
    `bbpc-convex/PRODUCTION_READINESS_AUDIT_2026-07-27.md`. The consumer candidates
    are independently buildable but remain unpublished: `bbpc` is 31 commits ahead of
    its current successful Vercel production commit, `bbpc-admin` is 37 ahead, and
    `bbpc-recording` is three ahead. `bbpc-pipeline` remains local/manual.
    `bbpc-convex` is published privately and its exact commit
    `920beecaa31763471d143dfe793dc20e9b5d08d2` passed staging CI, deployment,
    invariant, contract, and authenticated synthetic acceptance. Convex production
    remains inert with zero functions and zero environment-variable names.
  - On 2026-07-28 the owner authorized the next safe gate with the recommended
    defaults: create `tonyisup/bbpc-convex` as a private repository, keep
    `bbpc-pipeline` local, configure only Convex staging `merry-shepherd-928`, push
    only the backend, and run staging publication and acceptance. Production, Vercel,
    consumer repositories, and pipeline publication remain explicitly out of scope.
    The Vercel-connected default branches must not be pushed before their separately
    coordinated production deployment gate.
  - The staging workflow now enforces that boundary mechanically. A value-free
    preflight parses the deploy-key header and requires exactly
    `merry-shepherd-928`, explicitly rejects `determined-wombat-872`, requires the
    complete four-name backend environment contract, requires
    `BBPC_ENVIRONMENT=staging`, and matches `BBPC_API_VERSION` to the package version
    before any deploy command. Post-deploy contract generation follows the verified
    keyed target without a production flag. The workflow now also requires a
    value-free remote invariant gate: exact API version, explicit lifecycle state,
    writes disabled, no first application write in S2, anonymous recording-catalog
    reads, member/admin/pipeline authentication denials, and a dedicated
    always-non-writing mutation denied with `WRITE_DISABLED`. Thirty-five
    deployment-guard tests pass, and the live target/environment preflight passes
    without exposing secret material. The separate staging
    acceptance tooling adds eight tests and a deterministic four-row, production-free
    private identity fixture. Its initializer refuses a nonempty target, reconciles
    identity, preprovisions administrator/member/publish-only pipeline principals, and
    enters write-disabled S2. Four private JWT files then prove the authorized reads,
    unlinked default denial, and actor-specific member/administrator/pipeline
    `WRITE_DISABLED` probes whose handlers cannot write.
  - Staging-only publication completed on 2026-07-28. Private backend commit
    `920beecaa31763471d143dfe793dc20e9b5d08d2` passed independent CI run
    `30375886853` and staging deployment run `30375887288`, including exact-target,
    environment, full source/package, live invariant, and semantic public-contract
    gates. Synthetic run `staging-acceptance-20260727-01` confirmed a completely empty
    target, reconciled two human principals and one publish-only pipeline principal
    with zero production rows, and entered write-disabled S2. Authenticated staging
    acceptance passed three reads, one unlinked denial, and three blocked writes; the
    three temporary human sessions were revoked and all four token files removed.
    The workflow now explicitly expects S2 and fails on uninitialized state, enabled
    writes, any first application write, a different stage, or an API version mismatch.
  - Preflight/authorization-guard publication completed on 2026-07-30. Exact private
    backend commit `185b13b7fe4d96a2b9331e900fc09538bac8aa3a` passed independent
    CI run `30559709917` and staging deployment run `30559710487`. Target,
    environment, complete source/package, live write-disabled S2 invariants, and
    deployed semantic public-contract gates all passed. Local `master`,
    `origin/master`, and the remote branch matched the exact commit after publication.
    GitHub emitted only a non-blocking annotation that the pinned v4 checkout/setup
    actions declare Node.js 20 metadata while the runner forces them onto Node.js 24;
    no job or gate was degraded. Convex production, Vercel, SQL, and every consumer
    repository remained unchanged.
  - The owner then authorized a read-only production preflight. Convex production was
    independently reconfirmed at zero functions and zero environment-variable names.
    GitHub deployment metadata identifies successful current Production bindings for
    the public, admin, and recording repositories. The signed value-free evidence,
    Vercel name-only census, operator assignments, measured deadline decisions,
    complete maintenance/retention inputs, and exact next authorization wording are
    prepared in
    `bbpc-convex/PRODUCTION_PREFLIGHT_PACKET_2026-07-28.md`. The owner-approved
    temporary Vercel login confirmed exact scope `tonyisups-projects`, authoritative
    project IDs/slugs, 18 public and 22 admin Production variable names, every
    currently required S2 rollback name, and the absence of all four Convex/Clerk
    cutover names. No values were fetched or printed. Vercel logout succeeded and
    local checks found no remaining CLI credential.
  - Inert production publication completed on 2026-07-30 under the owner's exact,
    operation-scoped authorization. A single temporary production-scoped Convex deploy
    key installed only `BBPC_ENVIRONMENT`, `BBPC_API_VERSION`,
    `CLERK_JWT_ISSUER_DOMAIN`, and `CLERK_M2M_AUDIENCE`, then deployed exact clean
    backend commit `185b13b7fe4d96a2b9331e900fc09538bac8aa3a` to
    `determined-wombat-872`. The pre-deploy authorization guard matched the approved
    deployment, commit, and inert operation. The deployment/environment gate, exact
    four-name inventory, target-pinned write-disabled invariant gate, and deployed
    semantic public-contract comparison all passed. The temporary key was then revoked
    and its private local artifacts were removed. An independent keyless verification
    reconfirmed the exact four variable names, the required deployed function modules,
    `apiVersion=0.1.0`, `cutoverStage=uninitialized`, `initialized=false`,
    `applicationWritesEnabled=false`, no first application write, and empty sounder and
    template catalogs. This published schema and functions only: it did not initialize
    `systemState`, import data, freeze SQL, change Vercel, publish a consumer, or enter
    S1. Production consumers therefore remain on SQL until the separately authorized
    coordinated cutover window.
  - On 2026-07-30 the owner separately authorized the production S0→S1 transition
    during the scheduled 2026-08-01 12:00 PDT (`America/Los_Angeles`) maintenance
    window. The authorization is window-scoped and remains conditional on the complete
    S0 go/no-go preflight, exact-target and write-disabled checks, SQL-freeze readiness,
    required credentials, and Tony's availability. A one-time continuation is arranged
    for the scheduled window. A failed prerequisite or missed window is a no-go and
    leaves production on SQL at S0. This authorization does not permit an early
    transition, S1→S2, S2→S3, or any application/domain write.
  - The 2026-08-01 12:00 PDT window elapsed without an activated continuation or
    production mutation. At 16:53 PDT the fail-closed missed-window rule was applied.
    A fresh keyless production check reconfirmed the exact four-name environment
    contract, `apiVersion=0.1.0`, `cutoverStage=uninitialized`,
    `initialized=false`, `applicationWritesEnabled=false`, and no first application
    write. SQL remains the active system of record and T16 remains paused. A new
    maintenance date/time and fresh window-scoped S0→S1 authorization are required.
  - On 2026-08-02 at 07:58 PDT the owner supplied fresh window-scoped authorization
    for an 08:00 PDT S0→S1 attempt. The read-only preflight reconfirmed exact clean
    backend commit `185b13b7fe4d96a2b9331e900fc09538bac8aa3a`, the exact four-name
    Convex production contract, `cutoverStage=uninitialized`, writes disabled, no
    first application write, and empty public catalogs. GitHub and Vercel control-plane
    authentication passed; all three current GitHub Production deployment records
    remain successful; the 18-name public and 22-name admin Vercel Production censuses
    have zero drift; local human Clerk and pipeline M2M configuration passed value-free
    consistency checks; and a temporary isolated pipeline runtime successfully minted
    and validated a scoped Clerk M2M token without retaining or printing identity or
    credential values. No production mutation occurred. The attempt is paused before
    the SQL-freeze clock because the owner-operated production SQL writer freeze and
    frozen-source refresh into the local `dev` clone are not yet confirmed. Convex must
    remain uninitialized until those gates pass and the final source fingerprint can be
    recorded.
  - The owner later confirmed that production SQL had been frozen at 07:53:23 PDT and
    the refreshed `dev` clone was complete, but the guarded census could not begin
    until 08:30:47 PDT. The approved 30-minute S1 deadline had therefore already
    elapsed at 08:23:23 PDT. The census itself remained read-only and completed with 34
    tables and a new aggregate source fingerprint
    `a1d9f69484698277f3906c6b3a0d697aaaf96f052f829996654f30af8d1058d9`, which
    does not match the rehearsal-approved fingerprint and independently blocks the
    hard-coded extractors pending drift review. The attempt was aborted before any
    Convex initialization, import, or consumer change. A post-abort production query
    reconfirmed `cutoverStage=uninitialized`, writes disabled, and no first application
    write. Both consumers still target SQL; the owner must unfreeze SQL before service
    is considered restored.
  - The owner manually unfroze every production SQL writer at 08:32 PDT and confirmed
    service restoration. Independent public and administrator production probes both
    returned HTTP 200. Offline comparison of the refreshed clone found 54 additional
    canonical rows across ten already-mapped application tables. The regenerated
    mapping probes report no identity collision, duplicate relationship, ordering
    conflict, invalid target shape, or other mapping blocker, and the aggregate census
    validator passes with zero leaked environment values. The abort therefore exposed
    legitimate count drift rather than an unsafe relationship shape.
  - A local remediation now separates a code-reviewed stable schema fingerprint from
    the changing, count-bound frozen-snapshot fingerprint. The census emits stable
    schema fingerprint
    `8dd315bd8141fe7c011481c6c5d4840e10cd0e81be8dcfaf7eb325654d023d18`;
    each extractor requires one explicit lowercase snapshot fingerprint matching a
    less-than-15-minute-old read-only census; and staging, rehearsal, backup, and
    disposable restore require all eight domain manifests to share that exact snapshot,
    server, schema, and census timestamp. This removes the unsafe need to change code
    while SQL is frozen without weakening count, checksum, recent-census, or structural
    drift guards. Full backend checks pass: TypeScript, lint, query/access audits, 35
    deployment tests, 67 extractor tests, 11 recording tests, eight staging tests, 10
    performance tests, all 369 Convex tests, 90.22% branch coverage, and the package
    consumer typecheck. The separately approved fourth production-derived local run,
    `dev-rehearsal-20260802-04`, then bound all eight extracts to the exact approved
    snapshot fingerprint, reconciled 9,337 SQL-derived rows, imported only the 828-row
    approved public recording catalog, and passed administrator/member/pipeline S1
    acceptance with every application write blocked. Its private 45-table snapshot
    contains 10,615 rows; the disposable restore matched every table hash, replayed all
    62 checkpoints with zero inserts, preserved the recording catalog, passed S2→S0
    rollback, and deleted the disposable target. Aggregate evidence is recorded in
    `bbpc-convex/MIGRATION_REHEARSAL_RESULT_2026-08-02-04.md`. The remediation and
    evidence were then published to private `bbpc-convex` `origin/master` as
    `59bda341fd8840e732252447f280976fe08a2942`; both CI and the staging deployment
    passed. A separately authorized authenticated Management API preflight confirmed
    that the accidentally created project `bbpc-convex-e59b7` was exact project ID
    `2702398` with zero cloud deployments. That empty record was deleted and now
    returns 404, while production `determined-wombat-872` remains present under project
    ID `2644545`. Production initialization and publication remain separately gated.
  - Before publication, the backend passed a focused security census over
    all 90 commits, 1,343 Git objects, 866 text blobs, all three workflows, the
    tracked dependency graph, and the production dependency audit. No high-confidence
    secret patterns, private environment/artifact history, large blobs, or production
    dependency advisories were found. The one independently verified medium finding
    (mutable GitHub Action `v4` tags) is remediated with full-SHA pins, CODEOWNERS,
    and a regression test. The detailed AI-assisted report remains local and ignored.
  - Run `prod-cutover-20260802-01` completed S0→S4 on 2026-08-02. The approved
    production backup is
    `tonyisup-bbpc-convex-determined-wombat-872-1785705631260` with SHA-256
    `6d88468b313e6fb14f97e5019c94959deb40d2b86264a14726bfe646e66be826`;
    its disposable restore matched. Public and admin write-disabled acceptance passed,
    Tony approved S2→S3, the first application write landed at 14:29:13 PDT, and S4 was
    recorded at 14:39:40 PDT. SQL has remained permanently frozen since that write.
  - Final public, admin, and recording deployments removed production SQL/NextAuth
    variables and passed their route, identity, and authenticated recording canaries.
    The production side-effect queue was verified empty on 2026-08-03. Temporary
    Convex production keys were revoked after use, the temporary Vercel login was
    removed, and no local Vercel `auth.json` remains.
- [x] **T17 (P2, human: ~10–15d / Codex: ~5–8d)** — Frontends — Move screens to direct Convex clients and retire tRPC/Prisma.
  - Surfaced by: Architecture — compatibility adapters are temporary.
  - Files: `bbpc/src`, `bbpc-admin/src`, backend compatibility functions.
  - Verify: zero callers by telemetry/contracts, direct-client E2E, dependency/secret removal.
  - Progress: the public home, episode index/detail, sitemap, and shared slug
    controllers no longer statically load Prisma or NextAuth. Their existing direct
    Convex reads remain the first-selected branch, while legacy database/auth modules
    are now loaded only inside the SQL branch needed before coordinated cutover. A
    source contract prevents those static imports from returning. All 52 public tests,
    strict TypeScript, lint without errors, and an isolated Convex-mode production
    build with SQL pointed at an unreachable sentinel pass; all 659 static pages were
    generated. Final SQL/tRPC branch and dependency deletion remains gated on the
    coordinated backend-selector cutover rather than being auto-deployed early.
  - The legacy `/api/episode/next` endpoint now selects the bounded, runtime-validated
    `episodes/public:nextScheduled` Convex query before any SQL initialization. Its
    pre-cutover SQL implementation is dynamically loaded only in SQL mode; Convex
    responses intentionally omit unpublished review detail unavailable from the public
    contract. GET/POST compile in the SQL-unreachable 659-page production build, and a
    source contract prevents the static tRPC context import from returning.
  - Legacy `/api/auth`, `/api/trpc`, and `/api/restricted` now independently return a
    no-store 404 in Convex mode before dynamically loading NextAuth, tRPC, or their
    SQL-backed server modules. This duplicates the middleware boundary deliberately,
    keeps SQL mode unchanged before cutover, and lets the final dependency-removal
    patch delete isolated branches instead of untangling eagerly loaded route modules.
    A static audit now finds no eager legacy-stack import in any public API route.
  - The admin API boundary is isolated the same way. NextAuth options now live in one
    explicitly SQL-only server module; the auth, tRPC, restricted, Pusher signaling,
    and legacy UploadThing routes fail closed in Convex mode before dynamically loading
    any NextAuth, Prisma, tRPC, Pusher, or legacy upload module. Existing SQL SSR
    controllers dynamically import the same options only after selecting SQL. A static
    audit finds zero eager legacy-stack imports across admin API routes. All 85 admin
    tests, strict TypeScript, the 189-procedure authorization matrix, lint without
    errors, and the Convex-mode production build with SQL unreachable pass; the build
    generated all 28 pages.
  - Legacy environment validation is now selector-aware while remaining strict in SQL
    mode. In `bbpc`, `DATABASE_URL` and the Google OAuth credentials may be absent only
    in Convex mode; all 52 tests, strict TypeScript, lint without errors, and the
    659-page production build pass with those values and `NEXTAUTH_SECRET` blank. In
    `bbpc-admin`, the SQL database, TMDB, NextAuth secret, email, Google OAuth,
    chapterizer webhook, Pusher, and Azure credentials may likewise be absent only in
    Convex mode. The legacy recording studio is now behind a backend-first wrapper:
    Convex mode redirects it to the existing unavailable-route UX before loading its
    client, NextAuth, Prisma, or tRPC implementation. All 86 admin tests, strict
    TypeScript, the 189-procedure authorization matrix, lint without errors, and a
    28-page production build pass with those legacy secrets omitted.
  - The shared provider shells no longer evaluate `next-auth/react` in Convex mode.
    Public and admin SQL session/auth providers now live in lazy SQL-only modules,
    while their shared auth contexts contain only the Clerk/Convex implementation and
    backend-neutral state contract. The public build again generates all 659 pages
    with `DATABASE_URL`, Google OAuth, NextAuth secret, and `NEXTAUTH_URL` absent; the
    admin build generates all 28 pages with every SQL, NextAuth, email, OAuth, Pusher,
    Azure, TMDB, and webhook variable absent. `NEXTAUTH_URL` must be removed rather
    than defined as an empty string because the retired NextAuth package rejects an
    explicit empty URL while safely defaulting an omitted one. This reduces the admin
    shared client bundle by about 10 kB and leaves SQL-mode server rendering intact.
    The environment checkpoints are `80b211c` and `bcb6cf0`; the provider checkpoints
    are `4c0eab4` in `bbpc` and `220a473` in `bbpc-admin`.
  - The Convex admin home no longer statically imports the legacy tRPC dashboard.
    Its SQL statistics, guesses graph, episode/assignment cards, and member-tools
    behavior now live in a selector-gated SQL-only component; the live home route
    imports only the Clerk/Convex auth state and direct Convex dashboard. A source
    contract prevents tRPC, NextAuth, or Prisma from returning to that route. All 86
    admin tests, strict TypeScript, the 189-procedure authorization matrix, lint
    without errors, and the 28-page legacy-variable-free Convex production build pass.
    The home route loses about 7 kB of route JavaScript. Checkpoint: `ef66ed3`.
  - The admin custom app shell now follows the same boundary: Convex mode does not
    import `trpc.withTRPC`, `SessionProvider`, or the SQL auth adapter. Those providers
    live together in a dynamically selected SQL-only custom app, while a neutral
    layout/theme frame is shared by both backends. Both Convex mode with every legacy
    variable omitted and SQL mode with the development clone configuration generate
    all 28 pages. The full test/type/lint/authorization gates remain green, and the
    Convex shared first-load bundle drops by about 25 kB. Checkpoint: `1cfca68`.
  - The inaccessible legacy Azure storage explorer is also behind the selector now.
    Convex middleware continues to redirect the route as unavailable, and the page
    itself no longer imports tRPC or Azure code if that outer boundary is bypassed.
    Its Convex route bundle drops from about 49.4 kB to 235 B. All 87 admin tests,
    strict TypeScript, the authorization matrix, lint without errors, and the
    28-page legacy-variable-free Convex build pass. Checkpoint: `3691fca`.
  - The unavailable UploadThing and peer-audio development pages now load only in
    SQL mode. Their Convex route shells contain no upload, Pusher, WebRTC, or audio
    implementation; middleware still redirects them before rendering. Their production
    route bundles fall from roughly 22.1/43 kB to 229/233 B. All 88 admin tests, strict
    TypeScript, the authorization matrix, lint without errors, and the 28-page
    legacy-variable-free Convex build pass. Checkpoint: `447add9`.
  - Final source retirement completed on 2026-08-03. Public commit `66c4157` and
    admin commit `37e6f81` remove the backend selector, Prisma schemas and clients,
    tRPC/NextAuth routes and providers, SQL-only screens, legacy scripts, and their
    package dependencies. Both apps now require Clerk and Convex directly, and new
    source contracts prevent the retired runtime from returning. Public strict
    TypeScript, all 42 tests, and its live-Convex production build pass (659 generated
    pages); admin strict TypeScript, all 88 tests, and its 58-page production build
    pass. Repository scans also find no application SQL runtime in `bbpc-pipeline` or
    `bbpc-recording`. The commits were published on non-production
    `migration/convex-closure` branches as public PR #77 and admin PR #62. Their first Vercel previews
    correctly failed closed because Preview scope lacked the staging Convex URL (and,
    for admin, the development Clerk variables). Preview-only configuration was added
    under an explicit gate and the replacement public deployment
    `dpl_B9KoRr5m9sdHPytoGn58UoNLDTkB` and admin deployment
    `dpl_CwuESxEYefiLzriWQbj5AKXVgh1o` both reached Ready, returned HTTP 200, and passed
    their GitHub Vercel checks. The temporary CLI session was revoked and no local
    Vercel credential remains.
  - The separately approved production rollout completed admin-first on 2026-08-03.
    Admin PR #62 merged as `670f0ba8378eeb8ad6d602de5ad0d07e0ac9daa2` and its
    production deployment reached Ready; the signed-out canary returned HTTP 200,
    rendered the Clerk login boundary, reported no console errors, and loaded in
    959 ms. Public PR #77 then merged as
    `bd4ac218c3fe0aab72a566a56a63565f9e2f7170`; its production deployment reached
    Ready, the home and episode routes returned HTTP 200, live Convex episode and game
    data rendered, real client navigation succeeded, a fresh browser load reported no
    console errors, and DOM readiness completed in 410 ms. Two episode RSC prefetch
    requests can emit 404s; the immediately previous immutable production deployment
    reproduces the same behavior while both full routes return 200, so this is recorded
    as a pre-existing Next.js/Vercel prefetch issue rather than a cleanup regression.
    Production environment configuration was unchanged, no SQL access was restored,
    and the user's unrelated public service-worker edit remained untouched.
- [x] **T18 (P2, human: ~7–10d / Codex: ~3–5d)** — Recording — Consolidate `bbpc-recording` into the shared deployment.
  - Surfaced by: Architecture — recording follows core stability.
  - Files: `bbpc-recording`, `bbpc-convex/convex/recording`.
  - Verify: transformed-data reconciliation, capability security, existing/expanded Vitest and E2E.
  - Progress: the shared backend checkpoint now owns the complete namespaced recording
    schema and contract for sessions, invite capabilities, participants, RTC
    presence/signals, events, manifests, session favorites, templates, sounders, and
    upload metadata. Session creation derives a linked Host/Administrator from Clerk;
    guest invites remain capability-only and cannot escalate to account privileges.
    Invite/access tokens are stored only as SHA-256 digests and never returned, all
    capability mutations use the global S3/S4 API-versioned write gate, catalog and
    destructive operations are administrator-only, and every payload, collection, and
    cleanup is bounded. The portable-backup classification includes all eleven tables;
    the reconciled public catalogs may now be populated while session/history tables
    remain a fail-closed blocker pending source disposition. The generated
    multi-repository contract and publishable package pass, as do the full backend
    type/lint/access/query/extractor gates and 363 tests at 90.07% global branch
    coverage.
    Expanded tests cover capability secrecy, owner/guest isolation, event spoofing,
    malformed/corrupt relationships, idempotency, RTC capacity/signaling, media and
    manifest limits, catalog replacement, and cleanup authorization. A discovered
    template-upsert defect was fixed so clearing optional intro/outro sounders now has
    true replacement semantics. The shared backend is checkpointed in `0270e0b` and
    the catalog reconciliation extension in `1525447`.
  - Consumer integration is checkpointed in `bbpc-recording` as `b9a0181`. It pins Clerk
    `6.39.6` and Convex `1.42.3`, uses the shared `recording/*` function references,
    requires a linked Host/Administrator Clerk identity for creation, retains
    capability-only guest joins, and stores the owner invite capability only in the
    HTTP-only owner grant. All capability mutations now send API version `0.1.0`;
    session responses no longer expose invite or participant tokens. The Next 16
    Clerk proxy/provider, signed-in creation shell, safe S1 failure UI, administrator
    catalog/retention console, and Pages/App Router shared HTTP adapters are complete.
    The legacy `SESSION_ADMIN_SECRET` scripts are removed. The consumer repository
    no longer contains a deployable Convex function tree or `convex-test`; its six
    retired standalone-server tests are superseded by the shared backend suite.
    Nine live-consumer test files (36 tests), strict TypeScript, lint, the production
    build, a real signed-in S1 browser gate, and anonymous catalog routes pass.
  - The admin-to-consumer handoff is code-complete. In Convex mode `/record` now
    redirects to the optional, validated HTTP(S)
    `NEXT_PUBLIC_BBPC_RECORDING_URL`; administrators see the same external destination
    in the sidebar. If the URL is absent or blank, the existing unavailable flow
    remains fail-closed, while SQL mode retains its legacy recording studio unchanged.
    A legacy-variable-free 28-page admin build with a non-live handoff URL passes, and
    executing the built server-side route returns the expected temporary external
    redirect. The admin checkpoint is `b2e57dc`; consumer deployment instructions are
    checkpointed as `bad0f90`. Only the real deployed consumer URL remains owner input.
  - Read-only source inventory found 825 sounders, three templates, 26 sessions,
    65 participants, 100 events, 17 upload rows, and no live RTC rows. The original
    500-sounder bound was corrected to 1,000, and template references now validate
    their actual bounded Azure blob-path shape. A run-scoped S1 catalog importer
    reads only the standalone deployment's public queries, hashes the normalized
    payload, imports atomically through the migration gate, and reconciles counts
    plus digest. The first local import wrote 825 sounders and three templates; the
    immediate rerun was idempotent and matched the same digest. A mode-`0600`,
    value-free reconciliation manifest now binds those catalog counts and digest to
    the rehearsal run. Backend coverage remains above the 90% branch threshold with
    364 API tests, 64 SQL/extractor tests, ten recording local-tool tests,
    package-consumer validation, and the generated contract.
  - Backup-only archival was selected for the standalone recording history. The
    guarded implementation is checkpointed in `bbpc-convex` as `26367a5`: its dry
    run pins the exact legacy cloud source without reading rows, while execution
    exports all eleven source tables to the private run directory, rejects unexpected
    tables, records aggregate counts/hashes, and explicitly forbids shared import.
    Recovery validation restores and re-exports only through an isolated disposable
    local backend, requires exact per-table hash agreement, and deletes the restore.
    Plaintext legacy invite/access capabilities remain private archive material and
    are never copied to the shared backend. With the exact owner approval recorded in
    the runbook, the private archive captured all 1,062 rows across the standalone
    schema's 11 tables and its disposable restore matched every table hash before
    deletion. The shared `portable-v1` scrub then completed, and the private portable
    backup bound 43 canonical tables and 10,111 canonical rows—9,283 migrated rows
    plus 828 reconciled public catalog rows—together with two auth identities and 446
    audit events. Its 45-table/10,559-row disposable restore matched every table hash,
    reran full reconciliation with zero inserts, preserved every catalog row, and was
    deleted. Every recording session/history table remains empty in the shared
    backend. The standalone archive remains private and backup-only.
  - The recording consumer environment handoff completed on 2026-07-27. Its ignored
    local environment now targets the shared local Convex client and HTTP-action
    endpoints and uses the same Clerk development application as the core app.
    Lint, all 36 live-consumer tests, strict TypeScript, and the Next 16 production
    build pass after retiring the standalone function tree and its six backend-only
    tests. A signed-in browser smoke has zero console errors, returns all 825 sounders
    and three templates from shared Convex, and presents the expected safe maintenance
    message when session creation reaches the default-deny post-backup write gate.
    Positive session creation remains gated on the later initialized S3/S4 cutover
    target; this portable backup source will not be opened for application writes.
  - Production recording handoff completed after S4 at commit
    `41424de9b9632792c9c8607d21f01b1b0006a038`. The Vercel project owns
    `https://record.badboyspodcast.com`, admin redirects there, and an authenticated
    create/end session canary passed against the shared production deployment. Legacy
    recording history remains private backup-only and was not imported.
- [ ] **T19 (P2, human: ~2–3d / Codex: ~1d)** — Closure — Archive SQL evidence and remove temporary sensitive artifacts.
  - Surfaced by: Operational failure review — rollback evidence and sensitive retention need explicit closure.
  - Files: runbooks, archive manifests, environment/dependency configuration.
  - Verify: credential/import scans, retention sign-off, recovery documentation exercise.
  - Progress: all temporary production Convex keys and the temporary Vercel credential
    are gone; the obsolete local pipeline machine-secret backup assignment was removed
    on 2026-08-03. Active staging, Clerk, pipeline, Azure, UploadThing, TMDB, and Google
    OAuth credentials remain because they have live consumers. Retired Google, Discord,
    SMTP, Pusher, chapterizer-webhook, and Google API credentials still need owner-level
    dependency review before source-system revocation.
  - Tony owns deletion of the production cutover's portable backups and raw local
    migration artifacts by `2026-09-01 14:39:40 PDT`. The immutable SQL archive remains
    non-runnable application evidence through `2026-10-31 14:39:40 PDT`; its final
    disposition is due after that timestamp. T19 stays open until both retention gates,
    the credential review, and the recovery-document exercise are signed off.

## Deferred TODOs

Both accepted follow-ups are documented in `TODOS.md`:

- P3/L — consolidate the repositories into a monorepo after stability
- P4/M — evaluate media-storage consolidation from measured cost and operational data

They are not dependencies of this plan.

## Measured Inputs Still Required

These were phase outputs, not unresolved architecture decisions. They were captured for
the completed cutover and are retained here as the original planning checklist:

- cloned database size, SQL Server version, largest tables, row widths, row counts
- production-only artifacts, duplicate candidates, and orphan/constraint violations
- target deployment class and cost based on measured data/traffic
- per-table batch budgets and concurrency cap
- absolute operation latency/scan/response budgets
- maximum S1/S2 read-only window and per-state deadlines

## Engineering Review Completion Summary

- Step 0 Scope Challenge — full program accepted as gated releases.
- Architecture Review — 6 issues found, all resolved.
- Code Quality Review — 5 issues found, all resolved.
- Test Review — coverage diagram produced, 6 gaps identified and planned.
- Performance Review — 3 issues found, all resolved.
- NOT in scope — written.
- What already exists — written.
- `TODOS.md` updates — 2 proposed, 2 accepted.
- Failure modes — 18 analyzed, 0 critical silent gaps.
- Parallelization — 7 lanes; census/security and later consumer/follow-on lanes parallel,
  shared backend/schema/cutover work sequential at dependency gates.
- Outside voice — ran; 3 blockers and 1 minor finding, all approved and resolved.
- Lake Score — 19/19 substantive recommendations selected the complete option.

## Retrospective Evidence

Recent `bbpc` history includes `fd13308 fix: make ranked-list updates atomic`. This
migration touches the same ordering path, so ranked-list and syllabus concurrent reorder
tests are mandatory regression coverage rather than optional new-feature tests. The
recent UI-review commits do not expand this program into a redesign; compatibility and
direct-client work must preserve their observable interaction contracts.

## References

- Convex local deployments: https://docs.convex.dev/cli/local-deployments
- Convex import: https://docs.convex.dev/database/import-export/import
- Convex backup and restore: https://docs.convex.dev/database/backup-restore
- Convex Python client: https://docs.convex.dev/quickstart/python
- Convex authentication: https://docs.convex.dev/auth/overview
- Convex Clerk integration: https://docs.convex.dev/auth/clerk
- Convex internal functions: https://docs.convex.dev/functions/internal-functions
- Convex mutations and transactions: https://docs.convex.dev/functions/mutation-functions
- Convex indexes: https://docs.convex.dev/database/reading-data/indexes/
- Convex pagination: https://docs.convex.dev/database/pagination
- Convex best practices: https://docs.convex.dev/understanding/best-practices
- Convex limits: https://docs.convex.dev/production/state/limits
- Convex multiple repositories: https://docs.convex.dev/production/multiple-repos

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | Not run; the nested office-hours design review established scope. |
| Codex Review | outside plan review | Independent second opinion | 1 | CLEAR | 4 findings, 4/4 approved and resolved; final verification PASS. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 20 issues, 0 critical gaps, 0 unresolved decisions. |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | Not applicable to this backend migration plan. |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Not run. |

**CODEX:** The outside review found an S2 identity-link deadlock, an unsafe promotion
boundary, contradictory parallel gates, and an ambiguous point of no return; all four
were approved, corrected, and independently rechecked.

**VERDICT:** ENG + OUTSIDE VOICE CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
