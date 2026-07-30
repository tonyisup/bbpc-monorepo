# BBPC Convex Production Preflight Packet — 2026-07-28

Status: **read-only cloud preflight and owner-input packet complete; production
authority not granted**

This packet records value-free production metadata and the owner/operator inputs that
must be complete before any production mutation. It contains no credential values,
Clerk claims, migrated rows, private artifact paths, or SQL connection details.

## Authorized scope

The owner approved only:

- read-only Vercel project-binding and production environment-name inspection;
- read-only confirmation that Convex production remains inert; and
- preparation of the unsigned operator/deadline packet.

This approval does not authorize a production environment change, function deploy,
Convex initialization, backup import, SQL freeze, Vercel selector change, consumer
branch push, or S0–S4 transition.

## Verified release state

| Component | Prepared candidate | Current production evidence |
| --- | --- | --- |
| `bbpc-convex` | Staging-accepted `920beecaa31763471d143dfe793dc20e9b5d08d2`; local and private `origin/master` matched at inspection | Convex production `determined-wombat-872`: zero functions and zero environment-variable names |
| `bbpc` | `4c0eab43293699e19ca81f06579f650f88b94418`; 31 commits ahead, zero behind; owner-owned `public/sw.js` excluded | Successful Vercel Production deployment `5578597384` at `1dfd9991a794b2cf75e17c3ad765e9cd525f3ebd` |
| `bbpc-admin` | `b2e57dc3648d44248ddb2f9aa32755599eb2bdbc`; 37 commits ahead, zero behind | Successful Vercel Production deployment `5581489662` at `93e22442b40190def3edb91cbde851fe9fb6470f` |
| `bbpc-pipeline` | `5dd3fe527cd452fbd7f6dd244387f0e25e8cab5e`; local/manual, intentionally unpublished | No production deployment |
| `bbpc-recording` | `bad0f90a5df3cb205bfdf15f7a61577e8bf5eaa2`; three commits ahead, zero behind | Successful Vercel Production deployment `5433847082` at `35b9f46005d85b9d047330040e1564d94c8991e9` |

Current pre-migration Vercel deployment hosts:

- public: `bbpc-c4ib92v89-tonyisups-projects.vercel.app`
- admin: `bbpc-admin-9c48m8kad-tonyisups-projects.vercel.app`
- recording: `bbpc-recording-qi4rmtimx-tonyisups-projects.vercel.app`

Authoritative Vercel scope and project bindings:

| Component | Scope | Project slug | Project ID | Canonical Production URL |
| --- | --- | --- | --- | --- |
| `bbpc` | `tonyisups-projects` | `bbpc` | `prj_YnQ9BPyOxZn8LkTIjA8MIxBId1Gd` | `https://bbpc.vercel.app` |
| `bbpc-admin` | `tonyisups-projects` | `bbpc-admin` | `prj_7Z74M5wCPzhXSIOKPMkPLzIMvTox` | `https://bbpc-admin.vercel.app` |
| `bbpc-recording` | `tonyisups-projects` | `bbpc-recording` | `prj_FdSKfhpNUAH48GpgRWipCjTTBZLr` | `https://bbpc-recording.vercel.app` |

GitHub deployment metadata proves the repository-to-Production-deployment bindings and
successful current states. The checkouts contain no local `.vercel/project.json`
bindings. The version-pinned Vercel census independently confirmed the authoritative
scope, project IDs/slugs, canonical Production URLs, and both primary projects'
Production environment-variable names.

### Safe post-login execution protocol

The login itself is not read-only local state: Vercel documents that it creates an
`auth.json` credential under the macOS `com.vercel.cli` application-support
directory. It therefore requires a separate explicit owner approval even though every
subsequent cloud request is read-only.

The owner approved the exact temporary-credential protocol on 2026-07-28. The
following sequence was executed with observed CLI version `58.1.0`:

1. authenticate interactively with `npx --yes vercel@58.1.0 login`;
2. identify the owner/team scope with `whoami` and `teams list`;
3. run `project ls --json --scope <exact-scope>` and retain only matching project
   IDs/slugs plus repository/deployment-binding metadata;
4. for each exact primary project ID, run
   `env ls production --project <exact-project-id> --scope <exact-scope> --no-color`;
5. record only sorted variable names, target/scope, presence/absence results, and
   aggregate counts; and
6. run `logout` immediately after the census and verify locally that `auth.json` was
   removed. Do not call `whoami` after logout because an unauthenticated CLI may start
   another device-login flow.

Do not run `link`, `pull`, `env pull`, `env run`, `build`, `deploy`, `promote`,
`redeploy`, `rollback`, or any `env add`, `env update`, or `env rm` command. In
particular, Vercel documents that `env pull` writes values locally and `env run`
fetches values into a child process; neither is part of this census.

Official command references:

- <https://vercel.com/docs/cli/project>
- <https://vercel.com/docs/cli/env>
- <https://vercel.com/docs/cli/global-options>
- <https://vercel.com/docs/project-configuration/global-configuration>

Required authorization wording:

> Approve interactive Vercel device login, temporary local `auth.json` credential
> creation, read-only project/environment-name census, and immediate Vercel logout
> with local credential removal. Do not fetch environment values or change Vercel.

Result: approved and completed. Vercel reported a successful logout, and explicit
local checks found no remaining `auth.json` in either supported credential location.

## Required Vercel name-only census

The census must use Vercel's Production target and record names/scopes only. It must
never fetch, print, or copy values.

Both core projects must be checked for:

- `NEXT_PUBLIC_BBPC_BACKEND`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_CONVEX_URL`

For S2 rollback, the following legacy names must remain present where currently used.
Absence is not authorized until S4:

### Public rollback names

- `DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXTAUTH_URL_INTERNAL`, if currently present
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `EMAIL_SERVER_USER`
- `EMAIL_SERVER_PASSWORD`
- `EMAIL_SERVER_HOST`
- `EMAIL_SERVER_PORT`
- `EMAIL_FROM`
- `PHONE_NUMBER`
- `TMDB_API_KEY`
- `GOOGLE_API_KEY`
- `MAX_RECORDING_TIME`

### Admin rollback names

- `DATABASE_URL`
- `TMDB_API_KEY`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXTAUTH_URL_INTERNAL`, if currently present
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
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

`NEXT_PUBLIC_BBPC_BACKEND` is build-time configuration. The actual production selector
was confirmed absent from both primary Production projects; no value was changed.

### Census result

| Project | Production names | Cutover contract | S2 rollback contract |
| --- | ---: | --- | --- |
| `bbpc` | 18 | All four Convex/Clerk names absent | All 15 currently required names present; optional `NEXTAUTH_URL_INTERNAL` and optional/defaulted `MAX_RECORDING_TIME` absent |
| `bbpc-admin` | 22 | All four Convex/Clerk names absent | All 20 currently required names present; optional `NEXTAUTH_URL_INTERNAL` absent |

Observed `bbpc` Production names, sorted:

- `DATABASE_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `EMAIL_FROM`
- `EMAIL_SERVER_HOST`
- `EMAIL_SERVER_PASSWORD`
- `EMAIL_SERVER_PORT`
- `EMAIL_SERVER_USER`
- `GOOGLE_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXT_PUBLIC_POSTHOG_HOST`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `PHONE_NUMBER`
- `TMDB_API_KEY`
- `UPLOADTHING_TOKEN`

Observed `bbpc-admin` Production names, sorted:

- `AUDIO_CHAPTERIZER_WEBHOOK_URL`
- `AUDIO_UPOLOADER_URL`
- `AZURE_STORAGE_ACCOUNT_CONNECTION_STRING`
- `DATABASE_URL`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `EMAIL_FROM`
- `EMAIL_SERVER_HOST`
- `EMAIL_SERVER_PASSWORD`
- `EMAIL_SERVER_PORT`
- `EMAIL_SERVER_USER`
- `GOOGLE_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXT_PUBLIC_PUSHER_CLUSTER`
- `NEXT_PUBLIC_PUSHER_KEY`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `PUSHER_APP_ID`
- `PUSHER_SECRET`
- `TMDB_API_KEY`
- `UPLOADTHING_TOKEN`

Source reconciliation found no current `bbpc-admin` reference to the deployed
`AUDIO_UPOLOADER_URL` or `GOOGLE_API_KEY` names. They are added to the S4 removal
inventory, not changed during preflight. Public `UPLOADTHING_TOKEN` and both PostHog
names remain explicitly retained in S4. Public `MAX_RECORDING_TIME` is optional and
currently falls back to 300 seconds, so its Production absence is not a rollback
failure.

## Convex production preflight

- Expected production deployment: `determined-wombat-872`
- Public function count: `0`
- Environment-variable name count: `0`
- Consumer readiness: intentionally unavailable
- Initialization/state transition: not authorized

Production therefore remains unable to accept consumer traffic or application writes.
The next production mutation, if separately approved, is an inert backend deployment:
configure only the reviewed production environment contract and deploy the
backward-compatible function bundle without initializing `systemState`.

The local authorization guard for that future boundary is
`npm run deploy:production:authorization:check`. It is intentionally incapable of
deploying, importing, initializing, changing environment variables, or writing files.
Before a separately authorized command can run, the guard requires:

- the exact production target `determined-wombat-872`, with
  `merry-shepherd-928` explicitly forbidden;
- a production-kind deploy key whose secret material is never printed;
- `BBPC_EXPECTED_ENVIRONMENT=production`;
- the exact operation
  `BBPC_PRODUCTION_OPERATION=environment-contract-and-inert-backend-deploy`;
- the exact approval marker
  `BBPC_PRODUCTION_APPROVAL=approve-production-environment-contract-and-inert-backend-deploy`;
- `BBPC_PRODUCTION_APPROVED_COMMIT` equal to the lowercase 40-character reviewed
  commit and the checked-out `HEAD`; and
- a completely clean worktree, including no untracked files.

This guard has been tested offline only. Passing it is necessary but is not itself
owner authorization and does not execute the approved operation.

## Proposed measured deadlines

The slowest clean migration plus exact disposable restore took 9 minutes 43 seconds.
The proposed limits preserve a greater-than-three-times operator/network buffer:

| Boundary | Hard limit | Mandatory response |
| --- | ---: | --- |
| Enter S1 through restored, reconciled, write-disabled Convex | 30 minutes | Abort to S0; keep or restore SQL-only routing after verification |
| Enter S2 through public/member/admin/pipeline smokes | 15 additional minutes | Execute S2→S0, redeploy both consumers with SQL selected, then unfreeze SQL |
| Maximum SQL read-only window before the S3 decision | 45 minutes total | Abort before S3 or any application write |
| S2→S3 | Separate named approval | Remain write-disabled in S2 |

Owner decision:

- [x] Approve the 30/15/45-minute limits without extension during a cutover.
- Approved by: `Tony`
- Approved at: `2026-07-30 08:40 PDT`

## Responsible operators

Every row requires a named primary and backup. One person may fill multiple roles, but
blank or implicit assignments are not accepted.

| Responsibility | Primary | Backup | Confirmed at |
| --- | --- | --- | --- |
| Cutover lead / final go-no-go | Tony | Tony | 2026-07-30 08:40 PDT |
| SQL freeze and rollback | Tony | Tony | 2026-07-30 08:40 PDT |
| Convex production configuration and inert deploy | Tony | Tony | 2026-07-30 08:40 PDT |
| Migration, portable backup, exact restore | Tony | Tony | 2026-07-30 08:40 PDT |
| Vercel public/admin selector and deployments | Tony | Tony | 2026-07-30 08:40 PDT |
| Clerk human identities and JWT template | Tony | Tony | 2026-07-30 08:40 PDT |
| Pipeline M2M and recording smoke | Tony | Tony | 2026-07-30 08:40 PDT |
| Maintenance communication | Tony | Tony | 2026-07-30 08:40 PDT |

The owner explicitly assigned Tony as both primary and backup. This records the
decision but provides no personnel redundancy. If Tony is unavailable, loses required
control-plane access, or cannot independently complete a go/no-go check, the cutover is
no-go; the backup column does not authorize continuing without him.

## Maintenance and identity inputs

- Maintenance date/time/timezone:
  `2026-08-01 12:00 PDT (America/Los_Angeles)`
- Maintenance communication owner: `Tony`
- Audience/channel: `this Codex task for the operator log; existing in-app read-only
  messaging for users; no separate external broadcast`
- Start message: `approved 2026-07-30`; “BBPC is undergoing scheduled maintenance and
  is temporarily read-only. An update will follow when maintenance is complete.”
- Abort/rollback message: `approved 2026-07-30`; “Maintenance is complete. BBPC
  remains on the existing database; no migrated application writes were accepted.”
- Completion message: `approved 2026-07-30`; “Maintenance is complete and BBPC service
  is restored.”
- Production administrator smoke identity: `selected privately; reuse the rehearsed
  administrator identity`
- Production ordinary-member smoke identity: `selected privately; reuse the rehearsed
  ordinary-member identity`
- Backup retention owner and deadline: `Tony; delete 30 days after successful S4`
- SQL archive retention owner and deadline:
  `Tony; retain immutable for 90 days after successful S4`

Identity addresses and credentials must remain private and must not be added to this
packet.

## Remaining preflight gates

- [x] Backend staging CI, deployment, contract, safe-S2, and authenticated acceptance
      passed.
- [x] Convex production has zero functions and zero environment-variable names.
- [x] Current public, admin, and recording GitHub Production deployments are identified
      and successful.
- [x] Owner completed the temporary Vercel device login; project IDs/slugs and Production
      environment-variable names are inventoried without values.
- [x] Both core Vercel projects are confirmed to preserve the currently required
      SQL/NextAuth rollback names.
- [x] The four-name Production Convex/Clerk contract is reviewed and confirmed absent;
      installation remains separately unauthorized.
- [x] Primary and backup operators are named; the owner-approved single-operator
      constraint above applies.
- [x] 30/15/45-minute limits are approved.
- [x] Maintenance window, communication owner, and communication channels are recorded.
- [x] Two production Clerk smoke identities are selected privately.
- [x] Portable-backup and SQL-archive retention deadlines are recorded.
- [ ] A separate, exact inert-production-deployment authorization is recorded.

## Next authorization boundary

Completing this read-only packet does not authorize production changes. After all
preflight inputs are signed, the smallest next mutation authorization is:

> Approve production environment-contract installation and inert backend deployment
> to `determined-wombat-872` from the exact reviewed commit. Do not initialize
> `systemState`, import data, change Vercel, push consumers, freeze SQL, or enter S1.
