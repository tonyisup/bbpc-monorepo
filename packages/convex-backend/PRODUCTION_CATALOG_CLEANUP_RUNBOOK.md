# Production catalog cleanup

Use this procedure only for an explicitly approved production manifest. It does
not deploy applications or import staging data. Preserve the existing staging
guards and the earlier inert-deployment authorization boundary.

## Prepare and deploy

1. Read production movies and their complete assignment, review, syllabus and
   ranking references. Verify provider identities and save the reviewed manifest
   privately, outside version control. Include full original documents and
   `catalogSnapshotFingerprint` values; choose a survivor explicitly for each
   merge. Independent films sharing a placeholder URL are never merge candidates.
2. Record approval for the manifest's SHA-256 and exact intended operations.
   Generate each operation's digest with `catalogOperationFingerprint` from
   `convex/lib/catalogSnapshot.ts`. Include `kind`, `batchId` and every operation
   argument in that digest. Do not include the request's outer version/run fields.
3. Run backend `check` and `package:check`, review the diff, and commit the tested
   code. Deploy that exact clean commit through the approved production procedure.
   Keep the production environment and target checks. Verify production remains
   S4, API-compatible and write-enabled before enabling cleanup.

## Enable and execute

The internal `catalog/operations:applyProductionCatalogOperation` endpoint is
disabled by default. It requires `BBPC_ENVIRONMENT=production`, the explicit
`determined-wombat-872` target, S4, enabled application writes, the current API
version and the current cutover run. The staging endpoints still reject production.

1. Verify the endpoint is deployed while its approval configuration is absent.
2. Take a private production export for rollback. Re-read the affected rows and
   references and verify all approved snapshots still match. Abort on drift;
   obtain a revised manifest approval if the intended changes must change.
3. Set these temporary variables on **production only**, retaining their values
   in private operator records:
   - `BBPC_CATALOG_APPROVED_MANIFEST_SHA256`: approved manifest SHA-256.
   - `BBPC_CATALOG_APPROVED_OPERATIONS`: JSON array of 1–100 approved operation
     digests. Never broaden this list to accept unreviewed changes.
4. Call the internal endpoint once per approved operation with `manifestSha256`,
   `operation`, `clientApiVersion` and `cutoverRunId`.
   - `merge`: `batchId`, `tmdbId`, `movieIds`, `survivorId`, `newUrl`,
     `expectedFingerprint`. The snapshot includes all group movies and references.
   - `repair`: `batchId`, `id`, `newTmdbId`, `newUrl`, `expectedFingerprint`.
   - `delete`: `batchId`, `id`, `expectedFingerprint`. Only reviewed placeholder
     records with no references can be deleted.
5. Save the pending operation before each call and its result immediately after.
   Stale snapshots and replays abort. After a lost response, inspect the actual
   rows and audit before resuming; never regenerate approval automatically.
6. Remove **both** temporary approval variables in a `finally` cleanup on success
   or failure, and verify the endpoint is disabled again.

## Verify and release

Compare every affected row with the expected manifest result. Confirm all history
IDs and fields are retained except the reviewed `movieId` redirects, every deleted
movie has zero references, provider identities are unique, and audit records match
the operation log. Preserve unrelated live writes. Reconcile dashboard membership
with its actual pre-cleanup state; a restored database may have an incomplete
backfill, so do not assume every source row was already counted.

Verify readiness and the public API contract. Complete the required GitHub review,
then merge the application PR and verify the production deployments and both link
preferences. Keep the private export and manifest for the owner's rollback window.
After users save `movieLinkPreference`, do not blindly redeploy an older schema
that omits the field. Prefer a compatible forward fix; never switch S4 back to SQL.
