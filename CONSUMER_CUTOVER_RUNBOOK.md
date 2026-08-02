# BBPC Consumer Cutover Runbook

Status: **production cutover complete; post-S4 credential disposition in progress**

This runbook coordinates the Vercel deployments for `bbpc` and `bbpc-admin`
with the S0–S4 backend state machine. Both applications deploy automatically
from CI; environment changes and any SQL operation remain owner-operated.

## Non-negotiable ordering

1. Do not change either production consumer to Convex before the second
   production-scale rehearsal, disposable restore, and S2 rollback validation
   pass for the approved run.
2. `NEXT_PUBLIC_BBPC_BACKEND` is a build-time selector. Every selector or
   public-URL change requires a new Vercel deployment.
3. Keep every legacy SQL/NextAuth/integration variable during S2. S2 rollback
   depends on both consumers being able to redeploy with `sql` selected.
4. Do not remove or revoke legacy credentials until S3 has been approved and
   the first successful post-S3 application/domain write has made SQL rollback
   permanently unavailable.
5. Deploy the consolidated recording consumer and enable the admin recording
   handoff only after the core consumers are stable in S4.

## Before S2

- Record the exact `bbpc`, `bbpc-admin`, and `bbpc-convex` commit IDs in the
  signed go/no-go record.
- Confirm both Vercel projects still have
  `NEXT_PUBLIC_BBPC_BACKEND=sql`.
- Confirm both projects already have the production Clerk publishable/secret
  keys and the shared production `NEXT_PUBLIC_CONVEX_URL`.
- Leave `NEXT_PUBLIC_BBPC_RECORDING_URL` absent.
- Preserve all existing legacy variables. Do not rotate or delete them.
- Confirm the frozen SQL rollback procedure remains owner-operable.

Never copy secret values into this runbook, Git, tickets, screenshots, or chat.

## Enter S2

During the coordinated maintenance window:

1. Transition the shared backend to the approved write-disabled S2 run.
2. Set `NEXT_PUBLIC_BBPC_BACKEND=convex` in both Vercel projects.
3. Redeploy both applications from the recorded commits.
4. Verify the deployed commit IDs before accepting traffic.
5. Run the signed-in member, administrator, public-read, legacy-API denial,
   identity-link, and zero-write smoke matrix.
6. Confirm Convex still reports writes disabled and no first application write.

If any S2 acceptance check fails, set both selectors back to `sql`, redeploy
both recorded commits, execute the audited S2→S0 rollback, and only then reopen
the SQL-backed consumers. Do not remove any legacy variable during this stage.

## Enter S3 and S4

S3 requires the separately signed production approval naming the cutover run,
portable backup, deployed commits, and acceptance evidence. After the first
successful application/domain write:

- never point either application back at SQL;
- never unfreeze SQL;
- recover by restoring Convex or patching forward; and
- retain SQL only as the immutable archive defined by the migration plan.

After S4 canary acceptance, remove the retired variables below and redeploy.
An absent variable is the intended state. In particular, do not replace
`NEXTAUTH_URL` with an empty string; the retired NextAuth client rejects an
explicit empty URL.

### `bbpc` variables retained in S4

- `NEXT_PUBLIC_BBPC_BACKEND=convex`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CONVEX_URL`
- `UPLOADTHING_TOKEN` for the migrated profile-image upload flow
- `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST`, if analytics remain

### `bbpc` variables removed in S4

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXTAUTH_URL_INTERNAL`, if present
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`, if present
- `EMAIL_SERVER_USER`
- `EMAIL_SERVER_PASSWORD`
- `EMAIL_SERVER_HOST`
- `EMAIL_SERVER_PORT`
- `EMAIL_FROM`
- `PHONE_NUMBER`
- `TMDB_API_KEY`
- `GOOGLE_API_KEY`
- `MAX_RECORDING_TIME`

The Convex production build has been verified with all variables in this
removal list absent while generating all 659 pages.

### `bbpc-admin` variables retained in S4

- `NEXT_PUBLIC_BBPC_BACKEND=convex`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_BBPC_RECORDING_URL` only after the recording consumer is live

### `bbpc-admin` variables removed in S4

- `DATABASE_URL`
- `TMDB_API_KEY`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXTAUTH_URL_INTERNAL`, if present
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`, if present
- `EMAIL_SERVER_USER`
- `EMAIL_SERVER_PASSWORD`
- `EMAIL_SERVER_HOST`
- `EMAIL_SERVER_PORT`
- `EMAIL_FROM`
- `AUDIO_CHAPTERIZER_WEBHOOK_URL`
- `PUSHER_APP_ID`
- `PUSHER_SECRET`
- `NEXT_PUBLIC_PUSHER_KEY`
- `NEXT_PUBLIC_PUSHER_CLUSTER`
- `AZURE_STORAGE_ACCOUNT_CONNECTION_STRING`
- `UPLOADTHING_TOKEN`
- `AUDIO_UPOLOADER_URL` (deployed legacy misspelling; no current source reference)
- `GOOGLE_API_KEY` (deployed but no current admin source reference)

The Convex production build has been verified with all variables in this
removal list absent while generating all 28 pages.

Removing a credential from Vercel is not revocation. Source-system disposition
must be based on the credential's remaining consumers rather than the name of the
Vercel variable that was removed:

- Retain the Azure storage credential because `bbpc-recording` still uses it.
- Retain `UPLOADTHING_TOKEN` because the public profile-image flow still uses it.
- Retain the SQL credential only for the immutable archive during its approved
  90-day retention period; it must never be restored to an application consumer.
- Retain `TMDB_API_KEY` until the Convex catalog integration and its production
  environment are verified independently.
- Review the retired OAuth, Discord, email, Pusher, chapterizer-webhook, and
  Google API credentials with their source-system owners. Rotate or revoke only
  after proving that no other project consumes them.

The value-free disposition record belongs in the cutover evidence. Never copy a
secret value into that record.

## Recording consumer handoff

Deploy `bbpc-recording` from its recorded shared-backend consumer commit with:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `AZURE_STORAGE_ACCOUNT_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER_NAME_SOUNDERS`
- `AZURE_STORAGE_CONTAINER_NAME_RECORDINGS`
- `NEXT_PUBLIC_RTC_AUDIO_ENABLED`
- the selected `STUN_URLS`, `TURN_URLS`, `TURN_STATIC_AUTH_SECRET`, and
  `TURN_TTL_SECONDS`

Do not configure the retired standalone Convex deployment or
`SESSION_ADMIN_SECRET`.

After the recording production canary passes, set the validated HTTP(S) root
URL as `NEXT_PUBLIC_BBPC_RECORDING_URL` in `bbpc-admin` and redeploy admin. The
built `/record` route has been verified to return a temporary redirect to that
URL. If the variable is absent, `/record` remains fail-closed.

## Final consumer acceptance

- Public home, episodes, sitemap, profile, syllabus, games, extras, and history
  use Convex successfully.
- Admin dashboard and every Convex-ready management screen load without a
  request to `/api/trpc` or `/api/auth`.
- Direct legacy API probes remain no-store 404/503 responses.
- Signed-in member and administrator identities resolve to their canonical
  Convex users.
- Writes are version-gated, owner-derived, and audited.
- No production SQL connection or NextAuth session request appears in
  application telemetry.
- The admin recording link reaches the consolidated consumer, and a linked
  Host/Administrator can create a session only after S3/S4 writes are enabled.

## Production completion record

Run `prod-cutover-20260802-01` reached S4 on 2026-08-02. The final public and
admin deployments build without `DATABASE_URL`, the retired Vercel variables are
absent, `record.badboyspodcast.com` is attached to the consolidated recording
consumer, and the authenticated create/end recording canary passed. SQL remains
permanently frozen after the first successful Convex application write.

Production closure evidence is stored privately under
`.local-migration/prod-cutover-20260802-01/`. Non-production Vercel targets still
need a separate Convex development/staging selector and Clerk development keys;
production credentials must not be copied into Preview or Development to make
those builds pass.
