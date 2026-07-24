# Local Production-Derived Migration Rehearsal

Status: **mapping gate approved 2026-07-24; local rehearsal authorized**

This runbook exercises the full offline data milestone on an approved encrypted
development machine. It never writes SQL, never targets cloud staging or production,
and deliberately stops before the one-way portable scrub.

## Preconditions

1. Confirm the approval record in `MIGRATION_MAPPING_DRAFT.md`.
2. Regenerate the guarded census against the SQL database named exactly `dev`.
3. Create all eight immutable extracts with one safe run ID, following
   `local-tools/sql/README.md`.
4. Start a new, empty local Convex deployment with the current backend code.
5. Keep `.local-migration/` on the approved machine and out of Git, cloud sync,
   screenshots, tickets, and chat.

The rehearsal command verifies all eight manifests and all 31 raw-table checksums
before changing Convex state. The Convex target is hard-coded to `local`.

## Inspect the plan

This reads and verifies the local manifests but does not change Convex:

```sh
npm run migration:rehearse:local -- \
  --run-id <cutover-run-id> \
  --dry-run \
  --ack-production-derived-local-only
```

The plan contains 86 start, batch, finish, and reconciliation steps. Tests resolve
every planned function against its real Convex export and assert the table-checkpoint
ordering that breaks the assignment/review/game dependency cycle.

## Start a fresh rehearsal

```sh
npm run migration:rehearse:local -- \
  --run-id <cutover-run-id> \
  --batch-size 50 \
  --ack-production-derived-local-only \
  --ack-initialize-empty-local-deployment \
  --ack-replace-local-raw-staging
```

The command:

1. proves every application, control, migration, and raw table is empty;
2. initializes the local backend in S0 and transitions it to write-disabled S1;
3. imports every verified raw domain with replacement semantics;
4. starts each domain with counts derived from the verified manifests;
5. runs bounded transform batches in dependency order;
6. independently reconciles every mapped scalar and relationship; and
7. exits only after all eight domains are reconciled.

Raw staging, checkpoints, migration evidence, and `systemState` remain intact for
inspection. The command does not run `foundation-v1` or `portable-v1` scrub.

## Resume after interruption

Initialization happens before staging so every staging or transformation interruption
has a resumable S0/S1 control record. Resume with:

```sh
npm run migration:rehearse:local -- \
  --run-id <cutover-run-id> \
  --resume \
  --batch-size 50 \
  --ack-production-derived-local-only \
  --ack-resume-local-rehearsal \
  --ack-replace-local-raw-staging
```

Resume mode refuses a different run ID, API version, source fingerprint, failed domain,
or stage outside S0/S1. It re-verifies and safely replaces raw staging from the same
immutable manifests, reads domain/checkpoint progress, skips completed work, and
continues bounded batches.

Do not delete, edit, or regenerate an extract under the same run ID. If source data or
the census changes, use a fresh run ID and empty local deployment.

## Rehearsal exit gate

Record only aggregate evidence:

- exact source and canonical counts per table;
- zero reconciliation mismatches and missing parents;
- elapsed batch/reconciliation timings;
- backend and extractor commit IDs;
- manifest and source-schema fingerprints; and
- any retry/failure injection results.

Never copy raw row values into the run record.

The next gate is a separately approved portable scrub, backup, checksum, disposable
restore, and acceptance rerun. `portable-v1` deletes local control state last and is
intentionally not part of this command.
