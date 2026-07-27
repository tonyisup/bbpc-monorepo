# Local Production-Derived Migration Rehearsal

Status: **local rehearsal, private backups, and disposable restores validated
2026-07-27**

This runbook exercises the full offline data milestone on an approved encrypted
development machine. It never writes SQL, never targets cloud staging or production,
and stops before production cutover.

Production Vercel selector changes, S2 rollback preservation, S4 credential
retirement, and the recording consumer handoff are documented separately in
`CONSUMER_CUTOVER_RUNBOOK.md`.

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

The separately approved portable scrub, backup, checksum, disposable restore, and
acceptance rerun completed for `dev-rehearsal-20260724-01` on 2026-07-27.
`portable-v1` deletes local control state last and is intentionally not part of the
ordinary rehearsal command.

The exact owner approval required before either private backup workflow executes is:

> Approve one-way local portable scrub, private backup creation, and disposable local restore validation for run dev-rehearsal-20260724-01.

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
unexpected table or path, checks all 43 expected canonical tables plus the separately
bound `authIdentities` and `auditEvents` tables, and writes a private checksummed
manifest beside the snapshot. The 38 scrubbed raw/control schema entries must contain
zero documents. The expected counts bind the separately reconciled
825-sounder/three-template public recording catalogs while keeping every recording
session/history table at zero. It never includes file storage and never targets a
cloud deployment.

For `dev-rehearsal-20260724-01`, the scrub completed with exact bounded deletion
counts. The private snapshot contains 45 portable tables and 10,559 rows: 10,111
canonical rows, two linked auth identities, and 446 value-reduced audit events.

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
ports. It makes a private restore-only copy of the checksum-bound snapshot, excludes
Convex's internal `_tables` metadata so the current function bundle remains
authoritative, imports all portable application tables with preserved IDs, exports
them again, and requires exact per-table count/hash agreement with the untouched
source ZIP. Because `--replace-all` clears the disposable function registry, the
validator force-redeploys the current source bundle before running functions. It then
initializes default-deny S1, stages the same immutable extracts, reruns all 86
transform/reconciliation steps, and requires all 9,283 canonical rows to be reused
with zero inserts. On success it writes an aggregate-only restore manifest, stops the
second backend, and deletes only its disposable local data directory.

The 2026-07-27 validation matched every one of the 45 table hashes, preserved all 828
recording catalog rows, reconciled all eight domains and 62 checkpoints with zero
inserts, and deleted the disposable deployment.

For an approved rehearsal that also needs S2 rollback evidence, add the separately
guarded rollback flags:

```sh
npm run migration:restore:local -- \
  --run-id <cutover-run-id> \
  --batch-size 100 \
  --validate-s2-rollback \
  --ack-production-derived-local-only \
  --ack-private-restore-validation \
  --ack-delete-disposable-restore \
  --ack-s2-rollback-validation
```

After the restored reconciliation evidence passes, this option moves only the
disposable target from S1 to S2 and then executes the state machine's explicit S2→S0
abort. It requires application writes to remain disabled throughout, proves that no
first application write occurred, and validates the actor-scoped audit sequence
S0→S1, S1→S2, S2→S0 before deleting the target. The aggregate-only restore manifest
records the result. It never transitions to S3 and never opens application writes.

Current Convex CLI exports may include a top-level `README.md`, the internal `_tables`
metadata table, and per-table `generated_schema.jsonl` files. Imports preserve document
IDs and creation times:
<https://docs.convex.dev/database/backup-restore> and
<https://docs.convex.dev/database/import-export/import>.

## Standalone recording backup-only archive

Before changing `bbpc-recording/.env.local` away from the old standalone deployment,
pin the read-only archive target without reading source rows:

```sh
npm run migration:recording-archive -- \
  --run-id <cutover-run-id> \
  --dry-run
```

Record the value-free `sourceFingerprint` from that output. Only after the exact owner
approval above, create the private backup-only snapshot:

```sh
npm run migration:recording-archive -- \
  --run-id <cutover-run-id> \
  --source-fingerprint <sha256-from-dry-run> \
  --ack-private-recording-source \
  --ack-backup-only-no-shared-import
```

The target must be an exact `.convex.cloud` deployment whose configured deployment
name matches its URL. The exporter captures the standalone schema's eleven tables,
checks the strict table allowlist and public catalog counts, and records only aggregate
counts and hashes. The ZIP contains private recording rows and plaintext legacy invite
and participant capabilities. It is an archive only: never import it into shared
Convex, and never copy it into Git, cloud sync, CI, screenshots, tickets, or chat.

Validate recovery only in an isolated disposable local backend:

```sh
npm run migration:recording-archive:restore -- \
  --run-id <cutover-run-id> \
  --ack-private-recording-restore \
  --ack-delete-disposable-recording-restore
```

The restore uses separate local ports, imports and re-exports the private snapshot,
requires every canonical table count/hash to match, stops the disposable backend, and
deletes its data directory before writing value-free restore evidence.

For `dev-rehearsal-20260724-01`, the archive captured all 1,062 rows in the exact
11-table standalone schema. The disposable restore matched every table hash and was
deleted. The archive remains backup-only because it contains plaintext legacy
capabilities.

After that recovery gate completed, `bbpc-recording/.env.local` was moved to the
shared local Convex client and HTTP-action endpoints and configured with the same
Clerk development application as the core app. The recording repository's retired
standalone Convex function tree and `convex-test` dependency were then removed, so the
old cloud backend cannot be deployed from the consumer repository. Its six
standalone-server tests are superseded by the shared backend suite. The recording
consumer passes lint, all 36 live-consumer tests, strict TypeScript, and a production
build. A signed-in browser smoke loaded without console errors, read all 825 sounders
and three templates from shared Convex, and rendered the safe maintenance message when
session creation hit the default-deny post-backup write gate. A successful
session-creation smoke remains intentionally gated on an initialized S3/S4 target;
the backup source is never opened for application writes.
