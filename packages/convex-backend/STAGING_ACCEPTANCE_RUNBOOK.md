# Staging Acceptance Runbook

This runbook applies only to Convex staging deployment `merry-shepherd-928`.
It does not authorize Convex production, Vercel changes, consumer-repository pushes,
SQL changes, or publication of `bbpc-pipeline`.

## Safety contract

- Use only the deployment-scoped staging key and require the exact expected target.
- Explicitly reject production deployment `determined-wombat-872`.
- Keep every fixture, identity claim, and token in ignored private storage with
  directories mode `0700` and files mode `0600`.
- Never upload production-derived rows. The synthetic fixture has exactly four raw
  identity rows: two users, one administrator role, and one membership.
- Never reset a nonempty deployment automatically. Stop and obtain a separate,
  target-specific authorization.
- Keep application writes disabled throughout acceptance.

## 1. Publication gate

The `master` workflow checks the deployment-key target and required environment names,
deploys the reviewed backend to staging, runs the explicit lifecycle-state invariant
gate, and confirms that the generated public contract matches the committed artifact.

Required staging environment names:

- `BBPC_API_VERSION`
- `BBPC_ENVIRONMENT`
- `CLERK_JWT_ISSUER_DOMAIN`
- `CLERK_M2M_AUDIENCE`

Before initialization the committed expectation is `uninitialized`; after acceptance
it is `S2`. The invariant gate must report the expected API version and lifecycle
state, writes disabled, no first application write in S2, two anonymous catalog reads,
three authentication denials, and one non-writing `WRITE_DISABLED` probe.

## 2. Prepare the synthetic fixture

Create three private identity-claim JSON files for the staging administrator, staging
member, and pipeline M2M principal. Claims are identifiers only; they must not contain
JWTs or credentials.

Run `npm run staging:fixture:prepare` with:

- a unique staging run ID;
- the three private identity-claim files; and
- a new private output directory.

The command must report three tables, four rows, two human principals, one pipeline
principal, zero production rows, and zero credentials or tokens. Verify the fixture
with `npm run staging:initialize:synthetic -- --dry-run` before any remote mutation.

## 3. Initialize fresh staging

Set the scoped staging deployment key and exact expected/forbidden deployment names in
the operator environment. Then run `npm run staging:initialize:synthetic` with the run
ID, fixture directory, `--ack-synthetic-staging-only`, and
`--ack-initialize-empty-staging`.

Fresh mode first queries all backend tables and refuses if any are nonempty. On an
empty target it:

1. replaces only the three raw identity tables;
2. initializes S0 and enters S1;
3. transforms and reconciles the synthetic identity domain;
4. preprovisions one administrator, one ordinary member, and one active pipeline
   principal with exactly `pipeline:publish`;
5. verifies identity and pipeline audit evidence;
6. enters S2 with application writes disabled; and
7. verifies the final S2 evidence.

`--resume` is permitted only for the same run ID, API version, and S0/S1/S2 state.
It does not adopt an unrelated run or reset data.

## 4. Run authenticated acceptance

Acquire four distinct short-lived compact JWTs:

- linked staging administrator;
- linked staging member;
- linked pipeline M2M principal; and
- deliberately unlinked Clerk user.

Write each token to a separate private `0600` file and set:

- `BBPC_STAGING_ADMIN_TOKEN_FILE`
- `BBPC_STAGING_MEMBER_TOKEN_FILE`
- `BBPC_STAGING_PIPELINE_TOKEN_FILE`
- `BBPC_STAGING_UNLINKED_TOKEN_FILE`

Run `npm run deploy:staging:verify-authenticated`. The gate must prove:

- initialized write-disabled S2 readiness on the exact API version;
- administrator, member, and publish-only pipeline reads;
- `IDENTITY_NOT_LINKED` for the unlinked user; and
- `WRITE_DISABLED` for member, administrator, and pipeline mutations.

The three mutation handlers intentionally fail without writing even if the global write
gate is accidentally enabled. The verifier reports aggregates only and retains no
tokens. Remove the short-lived token files after recording the result.

## 5. Record and stop

Record the backend commit, workflow run, deployed target, aggregate acceptance result,
and any stop condition. Do not proceed to production configuration, consumer pushes,
Vercel selector changes, SQL freeze, or S3 without their separate authorizations.

## 6. Activate writable PR previews after separate authorization

This is a post-acceptance operation, not part of the write-disabled acceptance above.
After receiving explicit authorization for staging S3 and Vercel Preview changes:

1. Export a complete S2 backup, including file storage, into ignored private storage.
   Record its stable name and SHA-256 checksum.
2. Re-run the exact staging target and environment checks. Refuse any target other than
   `merry-shepherd-928`, and continue to forbid `determined-wombat-872`.
3. Transition the existing cutover run from S2 to S3 with the recorded backup name and
   checksum. Do not initialize a new run or alter production.
4. Scope `NEXT_PUBLIC_CONVEX_URL=https://merry-shepherd-928.convex.cloud` to Preview in
   each of `bbpc`, `bbpc-admin`, and `bbpc-recording`. Keep every Production selector
   on its existing value, then redeploy the affected previews so the build-time public
   selector is refreshed.
5. Run the staging invariant verifier with `BBPC_EXPECTED_STAGING_STATE=S3`. The
   non-writing mutation probe must reach its handler and return `VALIDATION_FAILED`,
   proving the global write gate is open without committing a test write.
