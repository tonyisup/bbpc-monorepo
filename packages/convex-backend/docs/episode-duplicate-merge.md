# Duplicate episode merge rehearsal

Status: implemented for local testing; **not deployed or run against production**.
Deployment and production execution require separate approval and the existing
production target/environment/authorization runbook. Do not use `convex dev`,
`--push`, or deployment commands as part of testing this tool.

## Policy

- One matching-title, published, non-zero pair per atomic transaction.
- Keep the transcript-bearing row, its date, title, legacy ID and populated fields.
  Fill empty content fields from the donor. Never overwrite conflicting content.
- Dates must be present and within seven days; the year-discrepancy exception is
  deliberately blocked. Passing this guard is not proof of the recording date.
- Preserve transcript metadata/passages without changing IDs or text; validate
  metadata, sequence, visibility and content fingerprint before merging.
- Repoint archive posts, assignments, extra reviews and episode links without
  changing child IDs. Other relationship types cause a stop for separate review.
- Delete the donor, clear both keeper slug fields, then invoke the existing slug
  allocator. This all commits together: no intermediate slugless row is visible.
  The base slug must be available; do not silently retain a collision suffix.
- **No redirects or aliases.** The old suffixed slug, donor ID and donor legacy ID
  may no longer resolve. The unsuffixed URL resolves to the retained episode.
- No audio downloads, storage writes, new archive-link backfill or renumbering.

## Run synthetic tests (no network, no production credentials)

From the monorepo root:

```sh
pnpm --filter @tonyisup/bbpc-convex-api exec vitest run convex/episodeMergeApi.test.ts
pnpm --filter @tonyisup/bbpc-convex-api run typecheck
pnpm --filter @tonyisup/bbpc-convex-api run lint
pnpm --filter @tonyisup/bbpc-convex-api run lint:queries
pnpm --filter @tonyisup/bbpc-convex-api run lint:access
```

Fixtures are synthetic and run in `convex-test` with the real authentication,
write gate, schema, slug allocator and dashboard/transcript triggers. Tests cover
preservation, stale snapshots, collisions, unsafe pairs, missing acknowledgements,
replay rejection and rollback after a late trigger failure.

## Future approved execution procedure

1. Verify the explicit deployment target using existing checks; obtain separate
   deployment/execution approval. Do not infer production authority from rehearsal.
2. Take and validate the standard full database backup. The per-pair preview below
   is an audit/inspection snapshot, **not a complete database backup or automatic
   undo**: it does not include assignment descendants or all derived state. A
   deleted Convex ID cannot be recreated through a normal insert.
3. As an authenticated administrator, call
   `episodes/admin:previewDuplicateMerge({keeperId, donorId})`. Save its complete
   `snapshotJson` and `fingerprint` privately, never in version control. Review the
   field copies, relationship rows, retained date and regenerated slug.
4. Only after approval, call `episodes/admin:mergeDuplicateEpisode` with the same
   IDs, `expectedFingerprint`, current `clientApiVersion`, a `backupReceipt`
   identifying the verified private backup, and confirmation
   `MERGE_WITHOUT_REDIRECTS_AND_REBUILD_SLUG`. The receipt is an operator
   acknowledgement; the endpoint cannot verify an external backup exists.
5. The mutation re-reads the full pair, relevant relationships and transcript and
   rejects changed data. Do not auto-refresh and retry rejected previews; inspect
   changes first. A repeated successful merge request rejects because the donor
   is gone; inspect the keeper/audit event after an uncertain network response.
6. Verify public/admin lookup by the new slug, preserved child IDs and transcript,
   donor absence, and dashboard counts. Start with one pair. Stop on any failure;
   no batch orchestrator silently advances past a failed pair.

## Admin UI

Open an episode detail page and select **Merge duplicate**. Copy the other
episode's ID from the episode list, then choose which episode to retain. The
retained episode must have the only transcript. **Preview merge** checks the
pair and shows the retained/deleted records, copied fields, relationship counts,
retained transcript passage count, and regenerated slug.

Download the private preview before proceeding. Its JSON contains the complete
`snapshotJson` and `fingerprint`; it is still only an inspection snapshot, not a
full database backup. Enter the receipt for a separately verified full backup
and acknowledge the deletion and lack of redirects to enable the merge.
After success, **View retained episode** opens its new slug. A rejected or
uncertain mutation clears the preview and acknowledgements; inspect the episode
before explicitly requesting another preview. The UI does not automatically
refresh and retry a merge.

Existing deployment and production execution safeguards are unchanged.
Production-derived review lists and downloaded previews must remain private and
outside version control.
