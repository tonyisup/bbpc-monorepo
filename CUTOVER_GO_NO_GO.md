# BBPC Convex Cutover Go/No-Go Record

Status: **draft; production authority not granted**

This is the operator record for the coordinated S0–S4 production cutover. A checked
technical item means evidence exists; it does not grant production authority. Every
approval field must name a person and timestamp before S1, and S3 requires its own
explicit approval.

## Candidate release

- Cutover run ID: `TBD`
- Convex backend commit: `TBD`
- `bbpc` commit: `TBD`
- `bbpc-admin` commit: `TBD`
- `bbpc-pipeline` commit: `TBD`
- `bbpc-recording` commit: `TBD`
- Convex production deployment: `TBD`
- Public Vercel deployment: `TBD`
- Admin Vercel deployment: `TBD`
- Recording deployment URL: `TBD`

The exact production artifacts remain intentionally `TBD` until publication and
deployment. The read-only pre-publication inventory, including local candidate
commits, current deployed commits, cloud configuration gaps, and the safe release
order, is recorded in `PRODUCTION_READINESS_AUDIT_2026-07-27.md`. Local candidate
hashes must be replaced here with the final pushed/deployed hashes before S1.

## Responsible operators

| Responsibility | Primary | Backup | Confirmed at |
| --- | --- | --- | --- |
| Cutover lead / final go-no-go | TBD | TBD | TBD |
| SQL freeze and rollback | TBD | TBD | TBD |
| Convex migration, backup, and restore | TBD | TBD | TBD |
| Vercel public/admin deployment | TBD | TBD | TBD |
| Clerk identity and JWT template | TBD | TBD | TBD |
| Pipeline and recording smoke | TBD | TBD | TBD |
| Maintenance communication | TBD | TBD | TBD |

One person may hold multiple roles, but every row must be explicitly acknowledged.

## Measured deadlines

The slowest clean local migration plus exact disposable restore validation completed in
9 minutes 43 seconds. The proposed production deadlines apply a greater-than-three-times
operator/network buffer:

| Boundary | Hard deadline | Required action if missed |
| --- | ---: | --- |
| Enter S1 through restored, reconciled, write-disabled Convex target | 30 minutes | Abort to S0; keep/reopen SQL only after selectors and backend state are verified |
| Enter S2 through all read/auth/service smokes | 15 additional minutes | Execute S2→S0, repoint every consumer to SQL, then unfreeze SQL |
| Maximum SQL read-only window before S3 decision | 45 minutes total | Abort before any S3 transition or application write |
| S3 authorization decision | Explicit, separate approval | Remain in write-disabled S2 |

These deadlines remain `TBD-approved` until the owner signs them below. Production
metrics may shorten them; they may not be extended during an active cutover without a
new go/no-go.

## S0 preflight

- [ ] Final SQL source fingerprint matches the approved run manifest.
- [ ] Every SQL writer and direct integration is inventoried and has a tested freeze.
- [ ] Convex, Clerk, Vercel, pipeline, recording, and rollback credentials pass
      value-free probes.
- [ ] Exact commits and deploy artifacts are recorded above.
- [ ] The backend staging commit passed its automated post-deploy invariant gate
      and the separate authenticated synthetic acceptance matrix.
      The synthetic matrix must use a fresh empty target, exactly two synthetic human
      users plus one publish-only pipeline principal, four distinct private JWT files
      including an unlinked identity, and the three non-writing actor-specific
      `WRITE_DISABLED` probes. A nonempty staging target is a stop condition, not
      permission to reset it.
- [ ] Two approved Clerk smoke identities exist: one administrator and one ordinary
      member.
- [ ] Ordinary identity linking remains disabled.
- [ ] Legacy SQL/NextAuth variables remain available to both Vercel projects for S2
      rollback.
- [ ] Maintenance communication is scheduled and acknowledged.
- [x] T15 identity-rehearsal policy is resolved in writing.
- [x] The authenticated admin/member/pipeline performance harness passes on the
      approved identity-bearing target.

Validated strict local rehearsal evidence, not valid for production restore:

- Run ID: `dev-rehearsal-20260727-03`
- Source fingerprint:
  `5b15b1933b626c3f084dcb0c795033032cf8a9a1f228933a7e74ddd5a9080a2a`
- Canonical rows: 10,111
- Identity matrix: one administrator, one ordinary member, one publish-only pipeline
  principal
- Workload gate: six of six p95 comparisons passed
- Private backup: 983,578 bytes, 45 tables, 10,559 rows
- Backup SHA-256:
  `eea6d32cbd4471b4681fc659020995435cdacd2c58bb1c395723ae49fdf8518a`
- Restore: all table hashes matched, 9,283 migration rows reused, zero inserted
- Rollback: S1→S2→S0 passed with writes disabled and no first application write

## S1 migration and backup

- [ ] SQL writers are frozen and the freeze time is recorded.
- [ ] Final extract uses read-only intent and the approved database name/fingerprint.
- [ ] Eight migration domains and all 62 checkpoints reconcile without mismatch.
- [ ] Recording public catalogs reconcile; recording session/history remains
      backup-only and absent from the shared canonical snapshot.
- [ ] Administrator and member smoke identities are pre-provisioned while ordinary
      linking remains blocked.
- [ ] Global application writes remain disabled and no first application write exists.
- [ ] Portable scrub allowlist passes and all forbidden raw/control tables are empty.
- [ ] Backup filename, byte size, SHA-256, table count, and row count are recorded.
- [ ] Exact restore into an isolated disposable target matches every table hash.

Backup evidence:

- Backup artifact: `TBD`
- SHA-256: `TBD`
- Tables / rows: `TBD`
- Created at: `TBD`
- Restore command:
  `npx convex import --replace-all --prod "<approved-portable-snapshot.zip>"`
- Disposable restore result: `TBD`

The actual command must use the exact reviewed Convex CLI version and deployment
selected in preflight. The quoted placeholder must be replaced with the approved local
artifact path; credentials and deployment secrets must not be pasted into this record.

## S2 consumer acceptance

- [ ] Backend transitions S1→S2 and remains write-disabled.
- [ ] `bbpc` production selector points to Convex and public reads pass.
- [ ] Administrator and member Clerk smokes resolve their pre-provisioned accounts.
- [ ] An unlinked ordinary Clerk identity is denied without creating a link.
- [ ] `bbpc-admin` production selector points to Convex and administrator reads pass.
- [ ] Pipeline M2M capability and read probes pass; write probe remains blocked.
- [ ] Recording public catalogs pass; session creation remains blocked.
- [ ] Legacy `/api/auth` and `/api/trpc` endpoints remain denied in Convex mode.
- [ ] Deployed p50/p95/p99, error rate, response bytes, and platform scan metrics pass.
- [ ] Backup is downloaded/checksummed and restored into a disposable target again.
- [ ] S2→S0 rollback remains immediately operable.

## S2 rollback

If any S2 item fails:

1. Set both Vercel backend selectors to `sql`.
2. Redeploy the exact recorded rollback commits.
3. Execute the audited Convex S2→S0 transition.
4. Verify every consumer is reading frozen SQL.
5. Unfreeze SQL writers.
6. Record the failed check and retain all value-free evidence.

Do not unfreeze SQL while any consumer still targets Convex. Do not restore the
development-clone rehearsal backup into production.

## S3 point of no return

- [ ] Every S2 item passed inside the deadline.
- [ ] Final backup and disposable restore passed.
- [ ] No unresolved security, reconciliation, restore, or performance waiver exists.
- [ ] Owner explicitly authorizes the named S2 run to transition to S3.
- [ ] First successful application/domain write and timestamp are recorded.

After the first successful S3 application/domain write, SQL rollback is closed. Recovery
is Convex restore or forward fix; SQL must not be reopened as an application writer.

## S4 closure

- [ ] Post-S3 canary window passes.
- [ ] Side-effect queues are empty or within approved bounds.
- [ ] Vercel legacy SQL/NextAuth variables are removed.
- [ ] SQL and retired integration credentials are revoked only after evidence capture.
- [ ] Private clone/extract/archive retention deadline is recorded.
- [ ] Final documentation and incident contacts are published.

## Approvals

- T15 identity-rehearsal decision: `strict identity-bearing third rehearsal completed;
  owner approved 2026-07-27`
- 30/15/45-minute deadlines approved by / at: `TBD`
- S0→S1 production approval by / at: `TBD`
- S2 acceptance signed by / at: `TBD`
- S2→S3 explicit approval by / at: `TBD`
- S4 closure signed by / at: `TBD`
