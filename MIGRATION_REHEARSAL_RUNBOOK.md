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
or stage outside S0/S1. It re-verifies the same immutable manifests. If no migration
progress exists, it safely replaces all raw staging to recover from a staging
interruption. Once any domain/checkpoint progress exists, it preserves raw staging so
stored checkpoint cursors remain valid, skips completed work, and continues bounded
batches.

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

## Portable scrub and private backup gate

Inspect the prepared one-way plan without changing Convex:

```sh
npm run migration:backup:local -- \
  --run-id <cutover-run-id> \
  --dry-run \
  --ack-production-derived-local-only
```

After explicit owner approval, execute:

```sh
npm run migration:backup:local -- \
  --run-id <cutover-run-id> \
  --batch-size 100 \
  --ack-production-derived-local-only \
  --ack-one-way-portable-scrub \
  --ack-private-portable-backup
```

The command re-verifies all manifests and aggregate rehearsal evidence. It supports
resuming an interrupted scrub, deletes every raw/control/migration table in bounded
batches, verifies the completion audit and absence of temporary state, then exports
only the schema-tested portable allowlist. It inspects every ZIP entry, rejects an
unexpected table or path, checks all 31 canonical counts, and writes a private
checksummed manifest beside the snapshot. It never includes file storage and never
targets a cloud deployment.

The backup ZIP contains production-derived row values. Keep its directory mode `0700`
and files `0600`; do not put it in Git, cloud sync, CI, screenshots, tickets, or chat.

## Disposable restore and reconciliation rerun

After the portable backup succeeds:

```sh
npm run migration:restore:local -- \
  --run-id <cutover-run-id> \
  --batch-size 100 \
  --ack-production-derived-local-only \
  --ack-private-restore-validation \
  --ack-delete-disposable-restore
```

The restore validator creates a second project-local Convex backend on separate local
ports, imports the untouched ZIP with preserved IDs, exports it again, and requires
exact per-table count/hash agreement. It then initializes default-deny S1, stages the
same immutable extracts, reruns all 86 transform/reconciliation steps, and requires all
9,283 canonical rows to be reused with zero inserts. On success it writes an
aggregate-only restore manifest, stops the second backend, and deletes only its
disposable local data directory.

Convex documents the ZIP layout as `<table>/documents.jsonl` plus
`generated_schema.jsonl`, and imports preserve document IDs and creation times:
<https://docs.convex.dev/database/backup-restore> and
<https://docs.convex.dev/database/import-export/import>.
