# Frozen-Snapshot Local Rehearsal Result — 2026-08-02

Status: **passed through authenticated acceptance, private backup, exact restore,
zero-insert replay, and S2 rollback**

This record contains aggregate evidence only. Production-derived row values,
identity claims, local credentials, and portable artifacts remain in the ignored
private migration directory.

## Run identity and safety

- Run ID: `dev-rehearsal-20260802-04`
- SQL source: guarded read-only clone named exactly `dev`
- Stable source-schema fingerprint:
  `8dd315bd8141fe7c011481c6c5d4840e10cd0e81be8dcfaf7eb325654d023d18`
- Count-bound frozen-snapshot fingerprint:
  `a1d9f69484698277f3906c6b3a0d697aaaf96f052f829996654f30af8d1058d9`
- Source-server fingerprint:
  `a9a65b60ff8b7b70cd4b46ef15db74a4df361af1dd8b462b2ffd2f0e585f1c75`
- Source census generated: `2026-08-02T15:48:01.667Z`
- Convex API version: `0.1.0`
- SQL mutations: zero
- Convex application data written to cloud: zero
- Application writes accepted: zero

All eight extractors required the exact approved snapshot fingerprint and one shared,
less-than-15-minute-old census. Their manifests agreed on the schema, snapshot,
server, census timestamp, and run ID. Every private directory is mode `0700`; every
private file is mode `0600`.

The rehearsal executed from backend HEAD
`185b13b7fe4d96a2b9331e900fc09538bac8aa3a` plus the reviewed working-tree
schema/snapshot-fingerprint remediation. That remediation was not published before
this local validation.

## Canonical reconciliation

| Domain | Reconciled rows |
| --- | ---: |
| identity | 40 |
| catalog | 1,514 |
| episodes | 689 |
| assignments | 715 |
| reviews | 1,964 |
| games | 3,959 |
| rankings | 23 |
| archive (backup-only) | 433 |
| SQL-derived total | **9,337** |
| recording sounders | 825 |
| recording templates | 3 |
| canonical total | **10,165** |

All eight SQL domains and all 62 transform/reconciliation checkpoints completed
without a mismatch, missing parent, collision, rejected transform, or retry. The core
migration took 403.625 seconds. It processed 18,674 transform/reconciliation rows:
9,337 inserts and 9,337 independent matches.

The recording importer read only the checksum-bound public sounder/template subset
from the previously validated backup-only archive. It reproduced the original digest,
imported 828 rows, and exposed no recording session, invite, participant, RTC, event,
manifest, favorite, or upload row to the shared path.

## Authenticated S1 acceptance

The approved administrator, ordinary member, and publish-only pipeline principals
all completed their authenticated read probes. Correctly versioned application-write
probes for all three returned `WRITE_DISABLED`; an unlinked identity returned
`IDENTITY_NOT_LINKED`; and disabling the pipeline principal returned `FORBIDDEN`.
The audited pipeline active→disabled→active cycle completed with two transitions and
restored read access. Application writes remained disabled and no first application
write was recorded.

## Private portable backup

- Portable schema tables: 45
- Canonical rows: 10,165
- Approved auth identities: 2
- Value-reduced audit events: 448
- Snapshot rows: 10,615
- Snapshot file size: 988,003 bytes
- Snapshot SHA-256:
  `068e23975b1698e6cd57528e88c4a7e637195ded2604c07e6001d451f2ff46ec`

The one-way portable scrub removed all 9,337 raw rows, 71 migration/control
documents, the deployment-local system record, and 2,192 dangling tag-award UUIDs.
All 38 scrubbed raw/control schema entries were empty in the inspected snapshot, and
all shared recording session/history tables remained empty.

## Disposable exact restore and rollback

The isolated restore matched all 45 table hashes before replay. The full eight-domain,
62-checkpoint replay processed 18,674 rows with zero inserts and 18,674 reuses,
preserved all 828 recording catalog rows, and reconciled every domain. The disposable
target then transitioned S1→S2→S0. Application writes remained disabled, no first
application write appeared, and the actor-scoped transition sequence was valid. The
disposable backend and its production-derived data directory were deleted.

## Operational note

While creating the fresh local runtime, the interactive Convex CLI also created the
empty project record `bbpc-convex-e59b7`. The run was stopped before its first function
deployment, and no application data was imported to a cloud deployment. The rehearsal
continued against its local deployment only. After separate owner authorization, an
authenticated Management API preflight confirmed exact project ID `2702398`, team ID
`47848`, and zero cloud deployments. The empty project was deleted successfully; the
subsequent project lookup returned 404. A separate lookup reconfirmed that production
deployment `determined-wombat-872` still exists under project ID `2644545`.

## Result

The stable-schema/count-bound-snapshot remediation is validated at the refreshed
production scale. The private backup and restore evidence are complete. The remediation
and this evidence were published to private `origin/master` as commit
`59bda341fd8840e732252447f280976fe08a2942`; its CI and staging deployment both passed.
Production Convex remains uninitialized. Production publication and a new cutover
window remain separately gated.
