# Production-Derived Local Rehearsal Result — 2026-07-27

Status: **passed through private backup, exact disposable restore, and S2 rollback**

This record contains aggregate evidence only. Production-derived row values remain in
the ignored, private local migration directory and the project-local Convex backend.

## Run identity and safety

- Run ID: `dev-rehearsal-20260727-02`
- SQL source: guarded read-only clone named exactly `dev`
- Source schema fingerprint:
  `5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a`
- Convex API version: `0.1.0`
- SQL mutations: zero
- Cloud migration targets: zero
- Final shared-local stage: S1, application writes disabled

The prior local backend state was stopped cleanly and preserved under the private first
run directory before the second empty target was initialized. No first-run data was
deleted. The new run directory and every production-derived descendant passed the
private mode gate: directories `0700`, files `0600`.

## Canonical reconciliation

| Domain | Reconciled rows |
|---|---:|
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

All eight SQL domains reconciled. All 62 transform/reconciliation checkpoints completed
with 18,566 processed rows: 9,283 inserts and 9,283 independent matches. The clean run
took 440.441 seconds. No mismatch, missing-parent, normalization collision, or transform
rejection was reported.

Because the standalone recording consumer had already moved to shared Convex, the
second rehearsal reconstructed only the two approved public catalog queries from the
previously validated private archive. The importer read no session/history table,
reproduced the retired query ordering, and required the original SHA-256 catalog digest
before the guarded S1 write. Reconciliation matched 825 sounders and three templates.

## Private portable backup

- Portable schema tables: 45
- Canonical rows: 10,111
- Value-reduced audit events: 441
- Auth identities: 0
- Snapshot rows: 10,552
- Scrubbed raw/control schema entries: 38, all empty
- Recording session/history rows: 0

The one-way `portable-v1` scrub completed in bounded batches, including archival removal
of 2,192 dangling tag-award UUIDs while retaining their non-rewardable canonical marker.
The snapshot allowlist, expected counts, per-table hashes, and aggregate manifest all
passed.

## Disposable restore and S2 rollback

The validator created an isolated backend on separate local ports, restored the private
snapshot with preserved document IDs, and matched all 45 table hashes. It then staged
the same immutable extracts and reran every migration/reconciliation checkpoint:

- domains reconciled: 8 of 8;
- checkpoints complete: 62 of 62;
- processed rows: 18,566;
- inserted canonical rows: 0;
- reused canonical rows: 18,566; and
- recording catalog rows preserved: 828.

After reconciliation, the disposable target transitioned S1→S2 and executed the
explicit S2→S0 abort. Application writes remained disabled, no first application write
was present, and the actor-scoped audit sequence contained one initialization plus the
three expected transitions. The disposable backend and its production-derived local
data directory were deleted; only the aggregate restore manifest remains.

## Outcome

The second production-scale local rehearsal, portable backup, exact restore,
idempotency rerun, and S2 rollback gate all pass. This authorizes planning the
coordinated consumer cutover; it does not authorize S3, production deployment changes,
SQL freeze/unfreeze, or legacy credential retirement.
