# BBPC Convex Production Readiness Audit — 2026-07-27

Status: **local release candidates identified; production remains unchanged and
not authorized**

This is a value-free, read-only inventory for T16. It records commit IDs,
deployment metadata, configuration-name presence, and release prerequisites.
It contains no credentials, Clerk claims, migrated row values, private artifact
paths, or SQL connection details.

## Release-candidate workspace

| Repository | Local candidate | Publication state | Current production state |
| --- | --- | --- | --- |
| `bbpc-convex` | Current local `master`; record the exact final SHA immediately before an authorized push | No Git remote; `tonyisup/bbpc-convex` does not yet exist | Convex production `determined-wombat-872` has zero functions and zero environment variables |
| `bbpc` | `4c0eab43293699e19ca81f06579f650f88b94418` on `master` | 31 commits ahead of `origin/master`; the only working-tree change is the owner-owned `public/sw.js`, which is excluded from the candidate | Latest successful Vercel production deployment uses `1dfd9991a794b2cf75e17c3ad765e9cd525f3ebd` |
| `bbpc-admin` | `b2e57dc3648d44248ddb2f9aa32755599eb2bdbc` on `master` | Clean; 37 commits ahead of `origin/master` | Latest successful Vercel production deployment uses `93e22442b40190def3edb91cbde851fe9fb6470f` |
| `bbpc-pipeline` | `5dd3fe527cd452fbd7f6dd244387f0e25e8cab5e` on `main` | Clean; no Git remote; `tonyisup/bbpc-pipeline` does not yet exist | No automatic deployment was discovered; the documented execution model is local/manual |
| `bbpc-recording` | `bad0f90a5df3cb205bfdf15f7a61577e8bf5eaa2` on `main` | Clean; three commits ahead of `origin/main` | Latest successful Vercel production deployment uses `35b9f46005d85b9d047330040e1564d94c8991e9` |

The three currently deployed Vercel artifacts report `success`:

- public:
  `https://bbpc-c4ib92v89-tonyisups-projects.vercel.app`
- admin:
  `https://bbpc-admin-9c48m8kad-tonyisups-projects.vercel.app`
- recording:
  `https://bbpc-recording-qi4rmtimx-tonyisups-projects.vercel.app`

These URLs identify the current pre-migration deployments. They are not T16
candidate deployment URLs and do not prove that the migration commits are
published. A direct anonymous probe returned HTTP 200 for public, HTTP 200 for
admin, and the recording app's expected HTTP 302 redirect.

## Build and contract portability

- `bbpc`, `bbpc-admin`, `bbpc-recording`, and `bbpc-pipeline` do not require a
  sibling `bbpc-convex` checkout to build or run.
- The TypeScript consumers currently keep narrow Convex function references and
  runtime contracts in their own repositories.
- `@tonyisup/bbpc-convex-api` is configured as a restricted GitHub Package but is
  not a T16 publication dependency. Package publication can remain deferred
  until a consumer actually pins it.
- The backend's GitHub workflow deploys `master` only to Convex staging. There
  is no production deployment workflow.
- The primary apps and recording app have no repository-local deployment
  workflow. Existing GitHub deployment records establish that Vercel is
  connected externally and production-deploys their default branches.

Therefore no primary, admin, or recording branch may be pushed as a harmless
publication step: each push is a production deployment change.

## Convex cloud inventory

### Production

- Deployment: `determined-wombat-872`
- Functions: `0`
- Environment variables: `0`
- Result: production cannot serve any consumer and remains safely inert.

### Staging

- Deployment: `merry-shepherd-928`
- Functions: `16`
- Present environment variable names:
  `BBPC_API_VERSION`, `BBPC_ENVIRONMENT`, and
  `CLERK_JWT_ISSUER_DOMAIN`
- Missing required variable:
  `CLERK_M2M_AUDIENCE`
- Optional provider variables not present:
  `TMDB_API_KEY` and `UPLOADTHING_TOKEN`

The staging function set is an early identity/pipeline/cutover slice, not the
current release candidate. It must be configured and replaced by the current
backward-compatible backend before staging acceptance. Its value-free readiness
query reports API version `0.1.0`, uninitialized state, and application writes
disabled.

The candidate staging workflow now fails before deployment unless the configured
key targets exactly `merry-shepherd-928`, does not target
`determined-wombat-872`, contains the complete required environment-name
contract, reports `BBPC_ENVIRONMENT=staging`, and reports the package API
version. The live read-only preflight accepted the staging target and rejected
the current environment on the known missing `CLERK_M2M_AUDIENCE`, without
printing the key or any environment value.

After an authorized deployment, the same workflow now performs a value-free
remote invariant gate before contract verification. It requires API version
`0.1.0`, an uninitialized write-disabled backend, two successful anonymous
catalog reads, authentication denials across member/administrator/pipeline
reads, and a `WRITE_DISABLED` denial from a valid recording mutation probe.
The probe's handler always fails without writing, sends no deploy key to the
application endpoint, and prints only
aggregate counts. The later synthetic Clerk and pipeline identity matrix
remains a distinct acceptance gate after controlled staging initialization.

## Local configuration evidence

Presence/equality checks, without printing values, establish that:

- the public, admin, and recording checkouts have complete and mutually
  consistent human Clerk credentials;
- all four consumers have a Convex URL and currently agree on the same local
  target;
- both primary local checkouts select Convex;
- the pipeline has both its Clerk machine credential and M2M audience; and
- every local environment file containing credentials is mode `0600`.

This proves only the local rehearsal configuration. Vercel production
environment settings and Convex production Clerk/provider settings are still
unverified.

## Pre-publication security census

A focused, read-only infrastructure and history audit covered all 90 commits,
1,343 Git objects, 866 text blobs, all three workflows, the tracked lockfile,
and the production dependency graph:

- the high-confidence history scan found no credential, token, private-key,
  credentialed-URL, or JWT patterns;
- no environment files, private migration artifacts, or large/binary blobs are
  tracked anywhere in history;
- `npm audit --omit=dev` reported zero advisories;
- none of the three direct production dependencies declares an install script;
  and
- `gitleaks`, `trufflehog`, and `detect-secrets` were unavailable, so the
  aggregate result records those tools as skipped rather than claiming they ran.

The one independently verified medium finding was that the workflows used
mutable `v4` action tags. All six references are now pinned to verified full
commit SHAs, a test rejects future mutable remote-action references, and
`CODEOWNERS` covers workflows and deployment checkers. The detailed AI-assisted
report remains local under the ignored `.gstack/` directory.

## Publication prerequisite

`bbpc-convex` has no remote even though its staging and package workflows refer
to `tonyisup/bbpc-convex`. Before relying on those workflows:

1. create `tonyisup/bbpc-convex` as a private repository;
2. add its remote without changing the local candidate;
3. configure the GitHub `staging` environment and
   `CONVEX_STAGING_DEPLOY_KEY` secret;
4. set the missing required staging environment variable;
5. run the target/environment preflight, then push `master`, wait for the
   complete CI, deployment, invariant, and contract gates, and record the
   deployed commit; and
6. rerun the public, admin, member, pipeline, default-deny, and write-disabled
   staging smoke matrix.

`bbpc-pipeline` can remain a versioned local operator tool for T16. If it is to
be published, its history needs a separate privacy decision first: three
runtime logs are tracked in local history. Aggregate scanning found no token,
email, signed-URL, or secret-assignment patterns, but one log contains local
absolute paths and all runtime logs should be absent from a newly published
repository.

## Safe release order

No step below grants authority for a later step.

1. **Staging publication:** publish and deploy only `bbpc-convex` to staging;
   leave Convex production and every Vercel project unchanged.
2. **Staging acceptance:** prove the full function/configuration contract,
   default-deny behavior, Clerk admin/member identities, pipeline M2M identity,
   and write-disabled probes.
3. **Production preflight:** record the final pushed commits, Vercel project
   bindings and selectors, operator assignments, 30/15/45-minute deadlines,
   maintenance window, frozen-SQL rollback procedure, and two production Clerk
   smoke identities.
4. **Inert backend deployment:** after separate production authorization, set
   the required Convex production environment variables and deploy the
   backward-compatible backend. Keep consumers on SQL and keep writes default
   denied.
5. **S1 snapshot:** freeze every SQL writer; refresh or verify the `dev` clone
   against the frozen production source; run the final guarded extraction,
   reconciliation, one-way scrub, private backup, and disposable exact restore.
6. **Production restore:** after exact artifact approval, import the portable
   snapshot with replacement semantics, redeploy the reviewed function bundle,
   initialize write-disabled S1, and verify reconciliation and backup evidence.
7. **S2 consumers:** transition to S2, set both Vercel selectors to Convex,
   redeploy the exact recorded public/admin commits, and execute the complete
   acceptance and rollback matrix. Preserve every SQL/NextAuth variable.
8. **S3:** remain in S2 until a separate approval names the run, snapshot hash,
   deployed commits, and acceptance record. The first successful application
   write permanently closes SQL rollback.
9. **S4:** pass the deployed canary, retire legacy credentials, then deploy
   recording and enable the admin recording handoff.

## Owner-only inputs still required

The remaining inputs cannot be inferred safely from local state:

1. repository visibility for `bbpc-convex`, and whether
   `bbpc-pipeline` should stay local or be privacy-scrubbed and published;
2. authorization to change cloud staging configuration, create the backend
   repository, configure its GitHub secret, push it, and deploy staging;
3. confirmation or inspectable access for the public/admin Vercel production
   variable names and backend selectors;
4. named operators/backups, approved 30/15/45-minute deadlines, maintenance
   window, and communication owner; and
5. later, a separate production S0→S1 authorization. S2→S3 remains a second,
   independent approval after acceptance.

Until those inputs are recorded, the correct state is: production SQL serving
traffic, Convex production inert, local rehearsals retained privately, and no
production branch pushes.
