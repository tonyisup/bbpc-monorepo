# Production-Derived Local Rehearsal Result — 2026-07-24

Status: **passed through reconciliation; portable scrub not executed**

This record contains aggregate evidence only. Production-derived row values remain in
the ignored, private local extraction directory and local Convex deployment.

## Run identity

- Run ID: `dev-rehearsal-20260724-01`
- SQL source: guarded read-only clone named exactly `dev`
- Source schema fingerprint:
  `5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a`
- Convex API version: `0.1.0`
- Mapping approval commit: `30a5449`
- Production-scale resume fixes: `3f16962`
- Aggregate evidence query: `95636b6`
- Final stage: S1, application writes disabled

SQL was never mutated. Production-derived rows were never sent to cloud staging,
production, CI, Git, tickets, screenshots, or chat.

## Reconciliation counts

| Domain | Canonical rows independently reconciled |
|---|---:|
| identity | 40 |
| catalog | 1,507 |
| episodes | 688 |
| assignments | 709 |
| reviews | 1,958 |
| games | 3,925 |
| rankings | 23 |
| archive (backup-only) | 433 |
| **Total** | **9,283** |

The aggregate evidence query reported:

- all 8 domains `reconciled`;
- 62 of 62 transform/reconciliation checkpoints complete;
- 0 running checkpoints;
- 18,566 rows processed: 9,283 canonical inserts plus 9,283 independent
  reconciliation matches; and
- zero count, scalar, relationship, normalized-key, or approved anomaly mismatches.

No transformation reject or collision was produced. Retired Auth.js account, session,
verification-token, provider-token, and legacy impersonation state was not extracted.

## Timing evidence

The migration run spanned 537.049 seconds, including two defect investigations and
checkpoint-safe restarts. Domain wall-clock intervals were:

| Domain | Elapsed |
|---|---:|
| identity | 7.423 s |
| catalog | 61.039 s |
| episodes | 31.202 s |
| assignments | 123.198 s |
| reviews | 77.218 s |
| games | 181.007 s |
| rankings | 7.388 s |
| archive | 18.325 s |

Assignment elapsed time includes its deliberate pause across the review/game dependency
barrier. These are correctness-run measurements, not production SLOs; the next clean
rehearsal will provide steady-state timing evidence.

## Defects found and retained regression coverage

1. Convex rejected a newline-only JSONL file for a zero-row table. Zero-row replacement
   now uses a private temporary empty JSON array; nonempty tables continue to import
   their verified immutable JSONL.
2. The episode prerequisite accepted only `transformed` identity state, even though
   `reconciled` is stronger. The shared prerequisite now accepts both and has an
   explicit regression test.
3. Resume review found that replacing raw staging after checkpoints begin would change
   raw Convex document IDs and invalidate stored cursors. Resume now replaces all raw
   staging only before any domain/checkpoint progress exists; afterward it preserves
   raw IDs and skips completed operations from persisted progress.

The full post-fix gate passed: typecheck, lint, query/access audits, 56 local
extractor/staging/planner tests, 112 Convex tests, package contract, and 90.08% branch
coverage.

## Post-rehearsal public episode read smoke

The first consumer-facing episode read slice was deployed only to the preserved local
backend and exercised against the migrated dataset. An aggregate-only traversal
completed all 13 pagination requests and hydrated exactly 634 episodes, 308 assignments,
390 extra reviews, and 14 episode links. Those totals match the independently verified
source manifests, and no missing parent or relationship-fanout guard fired.

The smoke check found that all 633 completed episodes store status `published`, while
the legacy Prisma call requested `Published`. SQL's case-insensitive comparison hid that
difference; Convex index equality does not. `latestPublished` now checks both preserved
legacy spellings, with regression coverage. Aggregate smoke checks then confirmed a
latest episode, a next episode, and a normalized slug round-trip without emitting row
values.

The public catalog read slice then traversed 15 movie pages and one show page, returning
exactly 1,494 movies and 6 shows. Private title and year round-trips matched their
original canonical IDs for both catalog types; only totals and match booleans were
emitted. Private episode-title, assigned-movie-title, and normalized legacy-ID
round-trips also matched their original canonical episode IDs. The expanded gate passes
134 Convex tests with 90.23% branch coverage.

## Preserved gate

Raw staging, checkpoints, migration records, and S1 control state remain intact. The
one-way `portable-v1` scrub has not run. The guarded portable snapshot and disposable
restore tooling is ready; executing the scrub, backup, and restored-data acceptance
remains the next separately approved gate.
