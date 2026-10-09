/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const STAGING_ISSUER = "https://m.staging.example.test";
// Production issuers that sort on either side of the staging issuer.
const EARLIER_ISSUER = "https://a.production.example.test";
const LATER_ISSUER = "https://z.production.example.test";
const gate = {
  cutoverRunId: "auth-reset-test",
  clientApiVersion: BBPC_API_VERSION,
  batchId: "restore-test",
};
const reset = internal.identity.maintenance.resetStagingAuth;

beforeEach(() => {
  vi.stubEnv("BBPC_ENVIRONMENT", "staging");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://merry-shepherd-928.convex.cloud");
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", STAGING_ISSUER);
});
afterEach(() => vi.unstubAllEnvs());

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

function link(issuer: string, subject: string, userId: Id<"users">) {
  return {
    tokenIdentifier: `${issuer}|${subject}`,
    issuer,
    subject,
    userId,
    linkedAt: 1,
    lastSeenAt: 1,
  };
}

function principal(issuer: string, subject: string) {
  return {
    tokenIdentifier: `${issuer}|${subject}`,
    issuer,
    subject,
    name: subject,
    status: "active" as const,
    permissions: ["pipeline:publish"],
    createdAt: 1,
    updatedAt: 1,
  };
}

/** A deployment as a production restore leaves it, plus one staging link. */
async function setup() {
  const t = createTestBackend();
  const seeded = await t.run(async (ctx) => {
    await ctx.db.insert("systemState", {
      singletonKey: "global",
      cutoverStage: "S4",
      applicationWriteMode: "enabled",
      cutoverRunId: gate.cutoverRunId,
      apiVersion: BBPC_API_VERSION,
      initializedAt: 1,
      updatedAt: 1,
      updatedBy: "test",
      firstApplicationWriteAt: 1,
    });
    const user = (email: string) =>
      ctx.db.insert("users", {
        email,
        normalizedEmail: email,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    const adminId = await user("admin@example.test");
    const memberId = await user("member@example.test");
    const testerId = await user("tester@example.test");
    const roleId = await ctx.db.insert("roles", {
      name: "Admin",
      normalizedName: "admin",
      description: "Administrators",
      admin: true,
      permissions: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userRoles", { userId: adminId, roleId });
    await ctx.db.insert("authIdentities", link(EARLIER_ISSUER, "a", adminId));
    await ctx.db.insert("authIdentities", link(LATER_ISSUER, "m", memberId));
    const stagingLinkId = await ctx.db.insert(
      "authIdentities",
      link(STAGING_ISSUER, "tester", testerId),
    );
    await ctx.db.insert("servicePrincipals", principal(EARLIER_ISSUER, "p1"));
    await ctx.db.insert("servicePrincipals", principal(LATER_ISSUER, "p2"));
    const stagingPrincipalId = await ctx.db.insert(
      "servicePrincipals",
      principal(STAGING_ISSUER, "staging-pipeline"),
    );
    await ctx.db.insert("impersonationSessions", {
      actorUserId: adminId,
      targetUserId: memberId,
      reason: "Carried over from production",
      startedAt: 1,
      endsAt: Number.MAX_SAFE_INTEGER,
    });
    return { adminId, stagingLinkId, stagingPrincipalId };
  });
  return { t, ...seeded };
}

async function rows(t: TestBackend) {
  return await t.run(async (ctx) => ({
    authIdentities: await ctx.db.query("authIdentities").collect(),
    servicePrincipals: await ctx.db.query("servicePrincipals").collect(),
    sessions: await ctx.db.query("impersonationSessions").collect(),
    users: await ctx.db.query("users").collect(),
    userRoles: await ctx.db.query("userRoles").collect(),
    audits: await ctx.db.query("auditEvents").collect(),
  }));
}

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

const adminSignIn = {
  tokenIdentifier: `${STAGING_ISSUER}|staging-admin`,
  issuer: STAGING_ISSUER,
  subject: "staging-admin",
  email: "admin@example.test",
  emailVerified: true,
  name: "Staging Admin",
};

test("removes what another issuer issued and keeps members, roles and staging links", async () => {
  const { t, stagingLinkId, stagingPrincipalId } = await setup();

  expect(await t.mutation(reset, gate)).toEqual({
    authIdentitiesDeleted: 2,
    servicePrincipalsDeleted: 2,
    impersonationSessionsDeleted: 1,
    done: true,
  });

  const after = await rows(t);
  expect(after.authIdentities.map((row) => row._id)).toEqual([stagingLinkId]);
  expect(after.servicePrincipals.map((row) => row._id)).toEqual([
    stagingPrincipalId,
  ]);
  expect(after.sessions).toEqual([]);
  expect(after.users).toHaveLength(3);
  expect(after.userRoles).toHaveLength(1);
  expect(after.audits).toMatchObject([
    {
      action: "identity.stagingAuthReset",
      actorType: "internal",
      cutoverRunId: gate.cutoverRunId,
      metadata: {
        batchId: gate.batchId,
        authIdentitiesDeleted: 2,
        servicePrincipalsDeleted: 2,
        impersonationSessionsDeleted: 1,
      },
    },
  ]);
});

test("a repeat run changes nothing and writes no second audit event", async () => {
  const { t } = await setup();
  await t.mutation(reset, gate);

  expect(await t.mutation(reset, gate)).toEqual({
    authIdentitiesDeleted: 0,
    servicePrincipalsDeleted: 0,
    impersonationSessionsDeleted: 0,
    done: true,
  });
  expect((await rows(t)).audits).toHaveLength(1);
});

test("a staging sign-in links to the restored account and keeps its role only after the reset", async () => {
  const { t, adminId } = await setup();
  const signIn = () =>
    t.withIdentity(adminSignIn).mutation(api.identity.linking.linkOrCreateMe, {
      clientApiVersion: BBPC_API_VERSION,
    });

  await expectDomainError(signIn(), "IDENTITY_CONFLICT");
  await t.mutation(reset, gate);

  expect(await signIn()).toMatchObject({
    id: adminId,
    isAdmin: true,
    linkMode: "existingUser",
  });
});

test("the deployment's issuer matches with or without a trailing slash", async () => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", ` ${STAGING_ISSUER}/ `);
  const { t, stagingLinkId } = await setup();

  await t.mutation(reset, gate);

  expect((await rows(t)).authIdentities.map((row) => row._id)).toEqual([
    stagingLinkId,
  ]);
});

test("a full batch reports more work and the next run finishes it", async () => {
  const { t, adminId, stagingLinkId } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 499; index += 1) {
      await ctx.db.insert(
        "authIdentities",
        link(EARLIER_ISSUER, `bulk-${String(index)}`, adminId),
      );
    }
  });

  // 500 earlier-issuer links fill the batch before anything else is read.
  expect(await t.mutation(reset, gate)).toEqual({
    authIdentitiesDeleted: 500,
    servicePrincipalsDeleted: 0,
    impersonationSessionsDeleted: 0,
    done: false,
  });
  expect(await t.mutation(reset, gate)).toEqual({
    authIdentitiesDeleted: 1,
    servicePrincipalsDeleted: 2,
    impersonationSessionsDeleted: 1,
    done: true,
  });
  const after = await rows(t);
  expect(after.authIdentities.map((row) => row._id)).toEqual([stagingLinkId]);
  expect(after.audits).toHaveLength(2);
});

test("refuses any deployment that is not the staging target", async () => {
  const { t } = await setup();
  const before = await rows(t);

  vi.stubEnv("BBPC_ENVIRONMENT", "production");
  await expectDomainError(t.mutation(reset, gate), "FORBIDDEN");
  vi.stubEnv("BBPC_ENVIRONMENT", "staging");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://determined-wombat-872.convex.cloud");
  await expectDomainError(t.mutation(reset, gate), "FORBIDDEN");

  expect(await rows(t)).toEqual(before);
});

test("refuses a missing issuer, an unusable batch ID and a mismatched gate", async () => {
  const { t } = await setup();
  const before = await rows(t);

  await expectDomainError(
    t.mutation(reset, { ...gate, batchId: "not a batch id" }),
    "VALIDATION_FAILED",
  );
  await expect(
    t.mutation(reset, { ...gate, cutoverRunId: "another-run" }),
  ).rejects.toThrow("Scheduled write cutover run mismatch");
  await expectDomainError(
    t.mutation(reset, { ...gate, clientApiVersion: "stale" }),
    "STALE_CLIENT",
  );
  // A blank value, or one without the scheme a stored issuer carries, would
  // make every row look foreign.
  for (const issuer of ["/", "m.staging.example.test", `${STAGING_ISSUER}/path`]) {
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
    await expectDomainError(t.mutation(reset, gate), "FORBIDDEN");
  }

  expect(await rows(t)).toEqual(before);
});
