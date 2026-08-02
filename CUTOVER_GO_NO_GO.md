# BBPC Convex Cutover Go/No-Go Record

Status: **S4 complete; SQL permanently frozen; post-cutover disposition tracked**

This is the operator record for the coordinated S0–S4 production cutover. A checked
technical item means evidence exists; it does not grant production authority. Every
approval field must name a person and timestamp before S1, and S3 requires its own
explicit approval.

## Candidate release

- Cutover run ID: `prod-cutover-20260802-01`
- Convex backend production commit: `185b13b7fe4d96a2b9331e900fc09538bac8aa3a`
- `bbpc` final production commit: `a0ae420f6629d33abadd1cea5649ad0ced465550`
- `bbpc-admin` final production commit: `fce80a77a975ecd813bddec39d4b4ef10274d8af`
- `bbpc-pipeline` current source commit: `5dd3fe527cd452fbd7f6dd244387f0e25e8cab5e`
- `bbpc-recording` production commit: `41424de9b9632792c9c8607d21f01b1b0006a038`
- Convex production deployment: `determined-wombat-872`
- Public Vercel deployment: `dpl_2Q4itmoXBJ8heBC7u86QcrMqgj3W`
- Admin Vercel deployment: `dpl_8V7ptBxZm82pqGvFXh5pJWjJSjdg`
- Recording Vercel deployment: `dpl_52pryWRMZoUoYSRhchdKiJsSSmuF`
- Recording production URL: `https://record.badboyspodcast.com`

The pipeline hash records the source reviewed during closure; this record does
not claim a new pipeline deployment. The read-only pre-publication inventory is recorded in
`PRODUCTION_READINESS_AUDIT_2026-07-27.md`; the current cloud evidence, final
staging-accepted backend commit, signed operator/deadline form, and name-only Vercel
census contract are recorded in `PRODUCTION_PREFLIGHT_PACKET_2026-07-28.md`.

## Responsible operators

| Responsibility | Primary | Backup | Confirmed at |
| --- | --- | --- | --- |
| Cutover lead / final go-no-go | Tony | Tony | 2026-07-30 08:40 PDT |
| SQL freeze and rollback | Tony | Tony | 2026-07-30 08:40 PDT |
| Convex migration, backup, and restore | Tony | Tony | 2026-07-30 08:40 PDT |
| Vercel public/admin deployment | Tony | Tony | 2026-07-30 08:40 PDT |
| Clerk identity and JWT template | Tony | Tony | 2026-07-30 08:40 PDT |
| Pipeline and recording smoke | Tony | Tony | 2026-07-30 08:40 PDT |
| Maintenance communication | Tony | Tony | 2026-07-30 08:40 PDT |

One person may hold multiple roles, but every row must be explicitly acknowledged.
The owner explicitly assigned Tony as both primary and backup. This provides no
personnel redundancy: if Tony is unavailable, loses required control-plane access, or
cannot complete a check, the cutover is no-go.

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

Tony approved these deadlines at `2026-07-30 08:40 PDT`. Production metrics may
shorten them; they may not be extended during an active cutover without a new
go/no-go.

## Maintenance communication and retention

- Scheduled start superseded by owner: `2026-08-02 09:51 PDT (America/Los_Angeles)`
- Operator log: `this Codex task`
- User-facing channel: `existing in-app read-only messaging`
- External broadcast: `none required`
- Start, abort/rollback, and completion messages:
  `owner approved 2026-07-30`
- Portable-backup owner/deadline:
  `Tony; delete 30 days after successful S4`
- Immutable SQL-archive owner/deadline:
  `Tony; retain 90 days after successful S4`

The owner explicitly moved the window to 2026-08-02 and separately authorized
the window-scoped S0→S1 and later S2→S3 transitions in this task.

## S0 preflight

- [x] Convex production was reconfirmed inert with zero functions and zero
      environment-variable names.
- [x] The current successful public, admin, and recording GitHub Production
      deployments are identified.
- [x] The owner-completed Vercel login establishes authoritative project IDs/slugs and
      a value-free Production environment-name census for both primary apps.
- [x] Final SQL source fingerprint matches the approved run manifest.
- [x] Every SQL writer and direct integration is inventoried and has a tested freeze.
- [x] Convex, Clerk, Vercel, pipeline, recording, and rollback credentials pass
      value-free probes.
- [x] Exact commits and deploy artifacts are recorded above.
- [x] The backend staging commit passed its automated post-deploy invariant gate
      and the separate authenticated synthetic acceptance matrix.
      The synthetic matrix must use a fresh empty target, exactly two synthetic human
      users plus one publish-only pipeline principal, four distinct private JWT files
      including an unlinked identity, and the three non-writing actor-specific
      `WRITE_DISABLED` probes. A nonempty staging target is a stop condition, not
      permission to reset it.
- [x] Two approved Clerk smoke identities are selected privately: reuse the rehearsed
      administrator and ordinary-member identities.
- [x] Ordinary identity linking remains disabled.
- [x] All currently required legacy SQL/NextAuth variables remain available to both
      Vercel projects for S2 rollback; only documented optional/defaulted names are
      absent.
- [x] Maintenance communication is scheduled and acknowledged.
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

- [x] SQL writers were frozen at `2026-08-02 11:46:33 PDT` and remain permanently frozen.
- [x] Final extract uses read-only intent and the approved database name/fingerprint.
- [x] Eight migration domains and all 62 checkpoints reconcile without mismatch.
- [x] Recording public catalogs reconcile; recording session/history remains
      backup-only and absent from the shared canonical snapshot.
- [x] Administrator and member smoke identities are pre-provisioned while ordinary
      linking remains blocked.
- [x] Global application writes remained disabled and no first application write existed through S2.
- [x] Portable scrub allowlist passes and all forbidden raw/control tables are empty.
- [x] Backup filename, SHA-256, table count, and row count are recorded in private evidence.
- [x] Exact restore into an isolated disposable target matches every table hash.

Backup evidence:

- Backup artifact: `tonyisup-bbpc-convex-determined-wombat-872-1785705631260`
- SHA-256: `6d88468b313e6fb14f97e5019c94959deb40d2b86264a14726bfe646e66be826`
- Tables / rows: `83 / 10,622`
- Created at: `2026-08-02T21:20:31.260Z`
- Restore command:
  `npx convex import --replace-all --prod "<approved-portable-snapshot.zip>"`
- Disposable restore result: `all table hashes matched; target deleted`

The actual command must use the exact reviewed Convex CLI version and deployment
selected in preflight. The quoted placeholder must be replaced with the approved local
artifact path; credentials and deployment secrets must not be pasted into this record.

## S2 consumer acceptance

- [x] Backend transitions S1→S2 and remains write-disabled.
- [x] `bbpc` production selector points to Convex and public reads pass.
- [x] Administrator and member Clerk smokes resolve their pre-provisioned accounts.
- [x] An unlinked ordinary Clerk identity is denied without creating a link.
- [x] `bbpc-admin` production selector points to Convex and administrator reads pass.
- [x] Pipeline M2M capability and read probes pass; write probe remains blocked.
- [x] Recording public catalogs pass; session creation remains blocked.
- [x] Legacy `/api/auth` and `/api/trpc` endpoints remain denied in Convex mode.
- [x] Deployed p50/p95/p99, error rate, response bytes, and platform scan metrics pass.
- [x] Backup is downloaded/checksummed and restored into a disposable target again.
- [x] S2→S0 rollback remains immediately operable.

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

- [x] Every S2 item passed inside the owner-approved extended window.
- [x] Final backup and disposable restore passed.
- [x] No unresolved security, reconciliation, restore, or performance waiver exists.
- [x] Owner explicitly authorizes the named S2 run to transition to S3.
- [x] First successful application/domain write is recorded at `2026-08-02 14:29:13 PDT`.

After the first successful S3 application/domain write, SQL rollback is closed. Recovery
is Convex restore or forward fix; SQL must not be reopened as an application writer.

## S4 closure

- [x] Post-S3 canary window passes.
- [ ] Side-effect queues are empty or within approved bounds.
- [x] Vercel legacy SQL/NextAuth variables are removed.
- [ ] Source-system credential disposition is complete. Azure and UploadThing remain
      active consumers; SQL is archive-only; TMDB and retired integration credentials
      require owner-level dependency review before any revocation.
- [x] Private backup and immutable SQL-archive retention deadlines are recorded.
- [x] Final documentation and incident contacts are published.

## Approvals

- T15 identity-rehearsal decision: `strict identity-bearing third rehearsal completed;
  owner approved 2026-07-27`
- 30/15/45-minute deadlines approved by / at:
  `Tony / 2026-07-30 08:40 PDT`
- S0→S1 production approval by / at:
  `Tony / 2026-08-02, window-scoped approval recorded in this task`
- S2 acceptance signed by / at:
  `Tony / 2026-08-02, explicit S1→S2 approval recorded in this task`
- S2→S3 explicit approval by / at:
  `Tony / 2026-08-02 14:28:59 PDT`
- S4 closure signed by / at:
  `Tony / 2026-08-02; backend transitioned at 14:39:40 PDT`
