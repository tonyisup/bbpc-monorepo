# Local SQL extraction

These tools create production-derived migration staging files on the approved encrypted
development machine. The output directory, `.local-migration/`, is ignored by Git and
must never be copied to GitHub, cloud staging, CI artifacts, screenshots, tickets, or
chat.

The identity extractor deliberately selects only `User`, `Role`, and `UserRole`. It
never selects Auth.js accounts, sessions, verification tokens, provider tokens, or
legacy impersonation state. The catalog extractor selects only `Movie`, `Show`, and
`Tag`; it preserves distinct rows even when movie or show titles normalize to the same
value. The episode extractor selects only `Episode`, `Link`, `Banger`, and
`AudioEpisodeMessage`; it preserves calendar dates separately from UTC audio-message
timestamps and never downloads media bytes. The assignment and review extractors
preserve the checkpoint dependency boundary. The game extractor reads all nine game
tables in one serializable transaction so points and every relationship are from one
source snapshot; dangling historical `TagVote.pointId` UUIDs remain source evidence
for the explicit tombstone mapping. The ranking extractor similarly captures its three
ordered-list tables in one source snapshot. The archive extractor preserves every
linked and unlinked post, including empty content or title strings, without exposing a
product-facing archive query.

Before an approved rehearsal:

1. Regenerate the guarded database census against database `dev`.
2. Confirm the source fingerprint still matches the mapping draft.
3. Choose a cutover run ID that will also initialize the local Convex deployment.
4. Run:

   ```sh
   npm run migration:extract:identity -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only

   npm run migration:extract:catalog -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only

   npm run migration:extract:episodes -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only

   npm run migration:extract:assignments -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only

   npm run migration:extract:reviews -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only

   npm run migration:extract:games -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only

   npm run migration:extract:rankings -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only

   npm run migration:extract:archive -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only
   ```

The extractor requires a census less than 15 minutes old, verifies that the configured
SQL server matches the census fingerprint, opens the connection with read-only intent
and UTC date handling, verifies `DB_NAME()` again inside a serializable read-only
transaction, and refuses count drift or output overwrite. It writes private JSONL files
plus a checksummed manifest with filesystem mode `0600`. Domain outputs are immutable
siblings under `.local-migration/<run-id>/<domain>`.

Do not run a production-derived extraction until the mapping approval gate is signed.
Synthetic extractor tests are safe at any time:

```sh
npm run migration:test:extractor
```

## Local raw staging

After the approval gate and extraction, stage one verified domain at a time:

```sh
npm run migration:stage:local -- \
  --run-id <cutover-run-id> \
  --domain <identity|catalog|episodes|assignments|reviews|games|rankings|archive> \
  --ack-production-derived-local-only \
  --ack-replace-local-raw-staging
```

The staging tool re-verifies the domain manifest, exact table allowlist, file and
source-row checksums, row counts, run IDs, unique legacy IDs, permitted fields, and
private filesystem modes before invoking Convex. The destination is hard-coded to the
`local` deployment. Each verified JSONL file replaces only its corresponding
`migrationRaw*` table, making a partially completed staging attempt safely repeatable.
The replacement acknowledgement is required because stale raw rows from a prior local
run are deliberately removed.

Never change this command to `--prod`, a cloud deployment name, or `--append`.
Production-derived raw rows must not enter cloud staging, CI, or the eventual production
deployment.
