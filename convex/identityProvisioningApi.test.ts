/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "identity-provisioning-test";
const USER_LEGACY_ID =
  "11111111-1111-4111-8111-111111111111";
const USER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|smoke-user",
  issuer: "https://issuer.example.test",
  subject: "smoke-user",
};
const SERVICE_IDENTITY = {
  tokenIdentifier:
    "https://issuer.example.test|pipeline-machine",
  issuer: "https://issuer.example.test",
  subject: "pipeline-machine",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

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

async function initialize(
  t: TestBackend,
  enterS1: boolean,
): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "identity-provisioning-test",
  });
  if (enterS1) {
    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S0",
      nextStage: "S1",
      actor: "identity-provisioning-test",
    });
  }
}

async function seedMigratedUser(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      legacyId: USER_LEGACY_ID,
      name: "Smoke User",
      email: "smoke@example.test",
      normalizedEmail: "smoke@example.test",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

describe("S1 identity pre-provisioning", () => {
  test("is available only through the migration write gate", async () => {
    const t = createTestBackend();
    await seedMigratedUser(t);
    await initialize(t, false);

    await expectDomainError(
      t.mutation(
        internal.identity.provisioning.preprovisionSmokeUser,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: "identity.preprovision.member",
          userLegacyId: USER_LEGACY_ID,
          ...USER_IDENTITY,
          verifiedEmail: "smoke@example.test",
        },
      ),
      "WRITE_DISABLED",
    );

    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: CUTOVER_RUN_ID,
      expectedStage: "S0",
      nextStage: "S1",
      actor: "identity-provisioning-test",
    });
    await expectDomainError(
      t.mutation(
        internal.identity.provisioning.preprovisionSmokeUser,
        {
          cutoverRunId: "wrong-run",
          operationId: "identity.preprovision.member",
          userLegacyId: USER_LEGACY_ID,
          ...USER_IDENTITY,
          verifiedEmail: "smoke@example.test",
        },
      ),
      "CONFLICT",
    );
  });

  test("links an exact migrated user idempotently and writes value-free audit evidence", async () => {
    const t = createTestBackend();
    await seedMigratedUser(t);
    await initialize(t, true);
    const args = {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: "identity.preprovision.member",
      userLegacyId: USER_LEGACY_ID,
      ...USER_IDENTITY,
      verifiedEmail: "smoke@example.test",
    };

    const first = await t.mutation(
      internal.identity.provisioning.preprovisionSmokeUser,
      args,
    );
    const second = await t.mutation(
      internal.identity.provisioning.preprovisionSmokeUser,
      args,
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({
      ...first,
      created: false,
    });

    await expect(
      t.withIdentity(USER_IDENTITY).query(
        api.identity.profile.me,
        {},
      ),
    ).resolves.toMatchObject({
      id: first.userId,
      email: "smoke@example.test",
    });

    const audits = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditEvents")
        .withIndex("by_createdAt")
        .take(20);
    });
    expect(
      audits.filter(
        (event) =>
          event.action ===
          "identity.smokeUser.preprovisioned",
      ),
    ).toHaveLength(1);
    const auditJson = JSON.stringify(audits);
    expect(auditJson).not.toContain("smoke@example.test");
    expect(auditJson).not.toContain(USER_IDENTITY.subject);
  });

  test("rejects an email mismatch or a BBPC user claimed by another identity", async () => {
    const mismatch = createTestBackend();
    await seedMigratedUser(mismatch);
    await initialize(mismatch, true);
    await expectDomainError(
      mismatch.mutation(
        internal.identity.provisioning.preprovisionSmokeUser,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: "identity.preprovision.member",
          userLegacyId: USER_LEGACY_ID,
          ...USER_IDENTITY,
          verifiedEmail: "wrong@example.test",
        },
      ),
      "IDENTITY_CONFLICT",
    );

    const claimed = createTestBackend();
    await seedMigratedUser(claimed);
    const userId = await claimed.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_legacyId", (index) =>
          index.eq("legacyId", USER_LEGACY_ID),
        )
        .unique();
      if (user === null) {
        throw new Error("Synthetic user is unavailable");
      }
      await ctx.db.insert("authIdentities", {
        tokenIdentifier:
          "https://issuer.example.test|other-user",
        issuer: "https://issuer.example.test",
        subject: "other-user",
        userId: user._id,
        linkedAt: 1,
        lastSeenAt: 1,
      });
      return user._id;
    });
    await initialize(claimed, true);
    await expectDomainError(
      claimed.mutation(
        internal.identity.provisioning.preprovisionSmokeUser,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: "identity.preprovision.member",
          userLegacyId: USER_LEGACY_ID,
          ...USER_IDENTITY,
          verifiedEmail: "smoke@example.test",
        },
      ),
      "IDENTITY_CONFLICT",
    );
    expect(userId).toBeDefined();
  });

  test("pre-provisions an idempotent least-privilege pipeline principal", async () => {
    const t = createTestBackend();
    await initialize(t, true);
    const args = {
      cutoverRunId: CUTOVER_RUN_ID,
      operationId: "identity.preprovision.pipeline",
      ...SERVICE_IDENTITY,
      name: "BBPC Pipeline",
      permissions: [
        "pipeline:publish",
        "pipeline:heartbeat",
      ],
    };

    const first = await t.mutation(
      internal.identity.provisioning
        .preprovisionPipelineService,
      args,
    );
    const second = await t.mutation(
      internal.identity.provisioning
        .preprovisionPipelineService,
      args,
    );
    expect(first.created).toBe(true);
    expect(second).toEqual({
      ...first,
      created: false,
    });
    await expect(
      t.withIdentity(SERVICE_IDENTITY).query(
        api.pipeline.status.capabilities,
        {},
      ),
    ).resolves.toMatchObject({
      servicePrincipalId: first.servicePrincipalId,
      name: "BBPC Pipeline",
      permissions: [
        "pipeline:heartbeat",
        "pipeline:publish",
      ],
    });
  });

  test("rejects malformed permissions and conflicting machine subjects", async () => {
    const malformed = createTestBackend();
    await initialize(malformed, true);
    await expectDomainError(
      malformed.mutation(
        internal.identity.provisioning
          .preprovisionPipelineService,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: "identity.preprovision.pipeline",
          ...SERVICE_IDENTITY,
          name: "BBPC Pipeline",
          permissions: ["not-a-capability"],
        },
      ),
      "VALIDATION_FAILED",
    );

    const conflict = createTestBackend();
    await initialize(conflict, true);
    await conflict.run(async (ctx) => {
      await ctx.db.insert("servicePrincipals", {
        tokenIdentifier: "unexpected-token",
        issuer: SERVICE_IDENTITY.issuer,
        subject: SERVICE_IDENTITY.subject,
        name: "Other Pipeline",
        status: "active",
        permissions: ["pipeline:heartbeat"],
        cutoverRunId: CUTOVER_RUN_ID,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expectDomainError(
      conflict.mutation(
        internal.identity.provisioning
          .preprovisionPipelineService,
        {
          cutoverRunId: CUTOVER_RUN_ID,
          operationId: "identity.preprovision.pipeline",
          ...SERVICE_IDENTITY,
          name: "BBPC Pipeline",
          permissions: ["pipeline:heartbeat"],
        },
      ),
      "IDENTITY_CONFLICT",
    );
  });
});
