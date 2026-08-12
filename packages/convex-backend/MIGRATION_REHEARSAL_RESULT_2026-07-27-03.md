# Strict Identity-Bearing Local Rehearsal Result — 2026-07-27

Status: **passed through authenticated acceptance, private backup, exact restore,
zero-insert replay, and S2 rollback**

This record contains aggregate evidence only. Production-derived row values, identity
claims, and local credentials remain in the ignored, private local migration directory.

## Run identity and safety

- Run ID: `dev-rehearsal-20260727-03`
- SQL source: guarded read-only clone named exactly `dev`
- Source schema fingerprint:
  `5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a`
- Convex API version: `0.1.0`
- SQL mutations: zero
- Cloud migration targets: zero
- Application writes accepted: zero

The second rehearsal backend was stopped cleanly and preserved under its private run
directory before a new empty local target was initialized. The third target started in
S0, migrated in write-disabled S1, and ended as a scrubbed portable dataset with no
deployment-local `systemState`. Every private directory is mode `0700`; every extract,
identity, benchmark, backup, and restore artifact is mode `0600`.

## Canonical reconciliation

| Domain | Reconciled rows |
| --- | ---: |
| identity | 40 |
| catalog | 1,507 |
| episodes | 688 |
| assignments | 709 |
| reviews | 1,958 |
| games | 3,925 |
| rankings | 23 |
| archive (backup-only) | 433 |
| SQL-derived total | **9,283** |
| recording sounders | 825 |
| recording templates | 3 |
| canonical total | **10,111** |

All eight SQL domains and all 62 transform/reconciliation checkpoints completed without
a mismatch, missing parent, normalization collision, or rejected transform. The core
migration took 477.367 seconds, or 19.446 SQL rows per second. The recording catalog
import reused only the checksum-bound public subset from the validated backup-only
archive; no recording session/history row entered the shared target.

## Strict authenticated acceptance

The approved identity-bearing S1 gate pre-provisioned exactly:

- one active administrator;
- one active ordinary member; and
- one active pipeline service principal with only `pipeline:publish`.

Administrator, member, and pipeline reads passed. Correctly versioned writes for all
three principals returned `WRITE_DISABLED`, ordinary account linking remained disabled,
and no first application write was recorded. A distinct unlinked identity returned
`IDENTITY_NOT_LINKED`. Disabling the pipeline principal returned `FORBIDDEN`; the audited
active→disabled→active cycle contained exactly two valid transitions and restored read
access.

The localhost benchmark used three warm-ups, 25 sequential samples, and eight rounds at
concurrency one and four. All six SQL-baseline workflows passed the maximum 20% p95
regression gate:

| Workflow | SQL p95 | Convex p50 | Convex p95 | Convex p99 |
| --- | ---: | ---: | ---: | ---: |
| Latest episode graph | 32.392 ms | 0.343 ms | 0.959 ms | 1.527 ms |
| 50-episode archive page | 92.139 ms | 0.847 ms | 1.410 ms | 1.905 ms |
| Current-season performance | 33.789 ms | 0.342 ms | 0.404 ms | 0.541 ms |
| Administrator dashboard | 33.322 ms | 0.363 ms | 0.467 ms | 0.623 ms |
| Member ranked lists | 30.492 ms | 0.276 ms | 0.385 ms | 0.466 ms |
| Pipeline episode bundle | 39.658 ms | 0.263 ms | 0.786 ms | 0.843 ms |

These are local acceptance measurements, not deployed production SLOs. T16 still
requires Vercel and Convex canary metrics before S3.

## Private portable backup

- Snapshot file size: 983,578 bytes
- Snapshot SHA-256:
  `eea6d32cbd4471b4681fc659020995435cdacd2c58bb1c395723ae49fdf8518a`
- Portable schema tables: 45
- Canonical rows: 10,111
- Approved auth identities: 2
- Value-reduced audit events: 446
- Snapshot rows: 10,559
- Scrubbed raw/control schema entries: 38, all empty
- Recording session/history rows: 0

The one-way `portable-v1` scrub removed all 9,283 raw rows, 71 migration/control
documents, the deployment-local system record, and 2,192 dangling tag-award UUIDs.
The allowlist, expected counts, recording digest, table hashes, file modes, and
backup checksum all passed.

## Disposable restore and S2 rollback

The validator created an isolated backend on ports 3310/3311, restored the private
snapshot with preserved IDs, and matched every one of the 45 table hashes. It staged
the same immutable extracts and reran the complete migration DAG:

- domains reconciled: 8 of 8;
- checkpoints complete: 62 of 62;
- processed rows: 18,566;
- inserted canonical rows: 0;
- reused canonical rows: 18,566; and
- recording catalog rows preserved: 828.

The restored target then transitioned S1→S2 and executed the explicit S2→S0 abort.
Application writes remained disabled, no first application write existed, and the
initialization plus S0→S1, S1→S2, S2→S0 audit sequence matched. The validation took
105.513 seconds after backup creation. The disposable backend and its
production-derived data directory were deleted; only the aggregate restore manifest
remains.

## Automated gates

The post-rehearsal package gate passed:

- TypeScript and ESLint;
- bounded-query and access-classification audits;
- 64 extractor/tooling tests;
- 11 recording migration-tool tests;
- 10 performance and identity-tool tests;
- 364 Convex tests across 48 files;
- 90.07% branch coverage; and
- the six-file package contract plus consumer typecheck.

## Outcome

The strict third production-scale rehearsal resolves the T15 identity-portability and
authenticated-performance gaps. Three production-scale migrations, three private
backups/restores, two S2 rollback exercises, the required identity-bearing repetition,
and all six local performance comparisons pass.

This completes T15 technical acceptance. It does not authorize a production S0→S1
transition, Vercel selector changes, SQL freeze/unfreeze, S3, or legacy credential
retirement.
