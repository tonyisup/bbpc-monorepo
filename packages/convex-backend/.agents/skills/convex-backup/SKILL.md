---
name: convex-backup
description: "Set up Convex backups and run a restore DRILL that proves recovery — snapshot, restore into a throwaway preview, assert the data came back — plus a schedule matched to your RPO and a gated recovery runbook."
---

<!-- GENERATED from convex-agents content/capabilities/convex-backup.json — do not edit by hand. -->

# Back up — and prove the restore works

Every backup story has two halves and most people only do the first: taking the backup, and proving you can get it back. This capability does both — it sets up regular snapshot exports and then runs a RESTORE DRILL that actually recovers the data into a disposable preview and asserts it's intact. The drill reuses migrate-rehearse's exact primitives (snapshot export → preview deploy → snapshot import) pointed at recovery instead of a forward change, so the safety net is tested, not assumed.

## Workflow

1. GUARD: deploy-guard — classify + announce the deployment being backed up (reading/exporting is safe; the drill's restore target is a throwaway preview, never prod).
2. TAKE the snapshot with the repository-pinned CLI and an explicit source: `pnpm --filter @tonyisup/bbpc-convex-api exec convex export --deployment <source-deployment> --path backup-<date>.zip` (or use `--prod` after a fresh prod confirmation; add `--include-file-storage` if needed). This is the backup artifact; treat it as sensitive real data.
3. SCHEDULE it (the ongoing half): recommend a cadence matched to the RPO — e.g. a daily pinned-CLI export with an explicit deployment selector via CI/cron to durable storage the user controls, with a retention window.
4. RESTORE DRILL (the half almost nobody does — this is the point):
   (a) PRECONDITION: use an approved isolated restore target and a valid Preview Deploy Key as `CONVEX_DEPLOY_KEY` for `--preview-create`. Preview deployments are available on Free, Starter, and Professional plans (with plan-dependent retention). If a preview key is unavailable, stop; never load a real production snapshot into a personal/shared development deployment. A sanitized backup may be used only in an approved isolated staging target.
   (b) create a throwaway preview from the matching CURRENT code: `pnpm --filter @tonyisup/bbpc-convex-api exec convex deploy --preview-create restore-drill-<date>`.
   (c) restore the snapshot into it: `pnpm --filter @tonyisup/bbpc-convex-api exec convex import backup-<date>.zip --deployment restore-drill-<date> --replace`.
   (d) ASSERT recovery: read the restored data back (MCP `tables` for row counts, `data`/`runOneoffQuery` for spot-checks) and confirm the critical tables came back with the expected row counts and a sample of real records — a restore that 'succeeds' but lands 0 rows is a FAILED drill. Compare against the source's counts where available.
5. REPORT the drill result plainly and record a complete recovery runbook. Separately prove: deploy the exact matching Convex code; restore auth configuration and deployment environment variables from an approved secure source without printing their values; import data with `pnpm --filter @tonyisup/bbpc-convex-api exec convex import backup.zip --replace --prod` only through deploy-guard and the repository production checks; then verify auth, critical functions, row counts, files, and smoke tests before accepting traffic. State the post-snapshot-write-loss caveat.
6. HYGIENE: delete local snapshot copies when done (real data); the drill preview auto-expires. Never commit a backup file.

## Rules

- A backup you have never restored is a hope, not a backup — always run (or offer to run) the restore DRILL, don't just take the export.
- The drill restores only into an approved isolated preview/staging target, never prod or a personal/shared dev deployment; use sanitized data if isolation is unavailable.
- Assert recovery, don't assume it: a restore that lands 0 rows is a FAILED drill — check critical-table row counts + a real-record sample against the source.
- A FAILED drill is the most valuable output — surface it loudly; that's the whole reason to drill before a real disaster.
- Schedule matched to RPO (how much data loss is tolerable); keep a user-owned portable copy alongside Convex's platform backups, with a retention window.
- Snapshots are sensitive real data: delete local copies when done, never commit them; the restore-to-prod runbook is deploy-guard-gated with the post-snapshot-write-loss caveat stated.
- Shares migrate-rehearse's snapshot+preview mechanics but aims them at RECOVERY, not a forward change — a forward schema change is migrate-rehearse.
