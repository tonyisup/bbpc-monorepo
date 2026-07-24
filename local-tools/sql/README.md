# Local SQL extraction

These tools create production-derived migration staging files on the approved encrypted
development machine. The output directory, `.local-migration/`, is ignored by Git and
must never be copied to GitHub, cloud staging, CI artifacts, screenshots, tickets, or
chat.

The identity extractor deliberately selects only `User`, `Role`, and `UserRole`.
It never selects Auth.js accounts, sessions, verification tokens, provider tokens, or
legacy impersonation state.

Before an approved rehearsal:

1. Regenerate the guarded database census against database `dev`.
2. Confirm the source fingerprint still matches the mapping draft.
3. Choose a cutover run ID that will also initialize the local Convex deployment.
4. Run:

   ```sh
   npm run migration:extract:identity -- \
     --run-id <cutover-run-id> \
     --ack-production-derived-local-only
   ```

The extractor requires a census less than 15 minutes old, verifies that the configured
SQL server matches the census fingerprint, opens the connection with read-only intent
and UTC date handling, verifies `DB_NAME()` again inside a serializable read-only
transaction, and refuses count drift or output overwrite. It writes private JSONL files
plus a checksummed manifest with filesystem mode `0600`.

Do not run a production-derived extraction until the mapping approval gate is signed.
Synthetic extractor tests are safe at any time:

```sh
npm run migration:test:extractor
```
