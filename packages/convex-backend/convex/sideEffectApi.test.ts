/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import type { ActionCtx } from "./_generated/server.js";
import schema from "./schema.js";
import { retryDelayForAttempt } from "./sideEffects/constants.js";
import {
  deleteUploadThingFile,
  deleteUploadThingFileWith,
  dispatchUploadThingDeleteWith,
  requireSuccessfulDelete,
} from "./sideEffects/dispatcher.js";
import {
  enqueueUploadThingDelete,
  isIntentOwnedBy,
} from "./sideEffects/intents.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "side-effect-cutover";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|effect-admin",
  issuer: "https://issuer.example.test",
  subject: "effect-admin",
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

async function seedAdmin(t: TestBackend): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Effect Admin",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...ADMIN_IDENTITY,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    const roleId = await ctx.db.insert("roles", {
      name: "Admin",
      normalizedName: "admin",
      description: "Administrator",
      admin: true,
      permissions: ["admin"],
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userRoles", { userId, roleId });
    return userId;
  });
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "side-effect-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "side-effect-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "side-effect-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "side-effect-test",
    approvedBackupId: "side-effect-backup",
    approvedBackupChecksum: "sha256:side-effect",
  });
}

async function seedDeleteIntent(
  t: TestBackend,
  userId: Id<"users">,
  suffix: string,
): Promise<Id<"sideEffectIntents">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("sideEffectIntents", {
      operation: "uploadthing.deleteFile",
      resourceType: "episodeAudioMessage",
      resourceId: `resource-${suffix}`,
      idempotencyKey:
        `uploadthing.deleteFile:episodeAudioMessage:resource-${suffix}`,
      providerKey: `provider-${suffix}`,
      status: "pending",
      requestedByUserId: userId,
      effectiveUserId: userId,
      cutoverRunId: CUTOVER_RUN_ID,
      attemptCount: 0,
      nextAttemptAt: Date.now() - 1,
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

function actionCtx(t: TestBackend): Pick<ActionCtx, "runMutation"> {
  return {
    runMutation: t.mutation as unknown as Pick<
      ActionCtx,
      "runMutation"
    >["runMutation"],
  };
}

function dispatchArgs(intentId: Id<"sideEffectIntents">) {
  return {
    intentId,
    cutoverRunId: CUTOVER_RUN_ID,
    clientApiVersion: BBPC_API_VERSION,
  };
}

function testUploadThingToken(
  apiKey = "sk_synthetic-test-key",
): string {
  return btoa(
    JSON.stringify({
      apiKey,
      appId: "synthetic-app",
      regions: ["synthetic-region"],
    }),
  );
}

describe("durable side-effect intents", () => {
  test("calls the UploadThing REST deletion contract without the SDK", async () => {
    let requestedUrl: URL | RequestInfo | undefined;
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = input;
      requestedInit = init;
      return new Response(
        JSON.stringify({ success: true, deletedCount: 1 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    await expect(
      deleteUploadThingFileWith(
        "synthetic-provider-key",
        ` ${testUploadThingToken()} `,
        fetcher,
      ),
    ).resolves.toBeUndefined();
    expect(requestedUrl).toBe(
      "https://api.uploadthing.com/v6/deleteFiles",
    );
    expect(requestedInit).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        fileKeys: ["synthetic-provider-key"],
      }),
    });
    const headers = new Headers(requestedInit?.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-uploadthing-api-key")).toBe(
      "sk_synthetic-test-key",
    );
    expect(headers.get("x-uploadthing-be-adapter")).toBe(
      "bbpc-convex",
    );
    expect(headers.get("x-uploadthing-version")).toBe("7.7.4");
    expect(requestedInit?.signal).toBeInstanceOf(AbortSignal);
  });

  test("redacts and classifies UploadThing REST failures", async () => {
    const token = testUploadThingToken();
    const response = (
      status: number,
      payload: unknown = {
        success: true,
        deletedCount: 1,
      },
    ): typeof fetch =>
      async () =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "content-type": "application/json" },
        });

    for (const invalidToken of [
      undefined,
      "",
      "not-base64",
      btoa("[]"),
      btoa(JSON.stringify({})),
      testUploadThingToken("public-key"),
    ]) {
      await expect(
        deleteUploadThingFileWith(
          "synthetic-provider-key",
          invalidToken,
          response(200),
        ),
      ).rejects.toThrow("configuration_missing");
    }
    await expect(
      deleteUploadThingFileWith(
        "synthetic-provider-key",
        token,
        async () => {
          throw new Error("synthetic network failure");
        },
      ),
    ).rejects.toThrow("provider_unavailable");
    await expect(
      deleteUploadThingFileWith(
        "synthetic-provider-key",
        token,
        response(408),
      ),
    ).rejects.toThrow("provider_unavailable");
    await expect(
      deleteUploadThingFileWith(
        "synthetic-provider-key",
        token,
        response(429),
      ),
    ).rejects.toThrow("provider_unavailable");
    await expect(
      deleteUploadThingFileWith(
        "synthetic-provider-key",
        token,
        response(503),
      ),
    ).rejects.toThrow("provider_unavailable");
    await expect(
      deleteUploadThingFileWith(
        "synthetic-provider-key",
        token,
        response(400),
      ),
    ).rejects.toThrow("provider_rejected");
    await expect(
      deleteUploadThingFileWith(
        "synthetic-provider-key",
        token,
        async () => new Response("not-json", { status: 200 }),
      ),
    ).rejects.toThrow("provider_unavailable");
    await expect(
      deleteUploadThingFileWith(
        "synthetic-provider-key",
        token,
        response(200, {
          success: false,
          deletedCount: 0,
        }),
      ),
    ).rejects.toThrow("provider_rejected");
  });

  test("succeeds once, suppresses duplicate dispatch, and supports remote reconciliation", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    await advanceToS3(t);
    const intentId = await seedDeleteIntent(
      t,
      adminId,
      "success",
    );
    const deletedKeys: string[] = [];
    const deleteFile = async (providerKey: string) => {
      deletedKeys.push(providerKey);
    };

    await expect(
      dispatchUploadThingDeleteWith(
        actionCtx(t),
        dispatchArgs(intentId),
        deleteFile,
      ),
    ).resolves.toEqual({
      dispatched: true,
      status: "succeeded",
    });
    await expect(
      dispatchUploadThingDeleteWith(
        actionCtx(t),
        dispatchArgs(intentId),
        deleteFile,
      ),
    ).resolves.toEqual({
      dispatched: false,
      status: "succeeded",
    });
    expect(deletedKeys).toEqual(["provider-success"]);

    const beforeRedrive = await t.run(async (ctx) =>
      await ctx.db.get("sideEffectIntents", intentId),
    );
    if (beforeRedrive === null) {
      throw new Error("Expected completed side-effect intent");
    }
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.sideEffects.intents.redrive,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: intentId,
          expectedStatus: "succeeded",
          expectedUpdatedAt: beforeRedrive.updatedAt,
        },
      ),
    ).resolves.toMatchObject({
      id: intentId,
      status: "pending",
      attemptCount: 1,
    });
    await expect(
      dispatchUploadThingDeleteWith(
        actionCtx(t),
        dispatchArgs(intentId),
        deleteFile,
      ),
    ).resolves.toEqual({
      dispatched: true,
      status: "succeeded",
    });
    expect(deletedKeys).toEqual([
      "provider-success",
      "provider-success",
    ]);

    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.sideEffects.intents.list,
      {
        paginationOpts: { cursor: null, numItems: 10 },
      },
    );
    expect(page.page).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain("provider-success");
    expect(page.page[0]).toMatchObject({
      id: intentId,
      status: "succeeded",
      attemptCount: 2,
      lastErrorCode: null,
    });
  });

  test("retries transient failures, reaches terminal state, and recovers by operator redrive", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    await advanceToS3(t);
    const intentId = await seedDeleteIntent(
      t,
      adminId,
      "timeout",
    );
    let calls = 0;
    const unavailable = async () => {
      calls += 1;
      throw new Error("synthetic timeout");
    };

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(
        dispatchUploadThingDeleteWith(
          actionCtx(t),
          dispatchArgs(intentId),
          unavailable,
        ),
      ).resolves.toMatchObject({
        dispatched: true,
        status:
          attempt < 5 ? "retryScheduled" : "terminal",
      });
      if (attempt < 5) {
        await t.run(async (ctx) => {
          await ctx.db.patch(
            "sideEffectIntents",
            intentId,
            { nextAttemptAt: Date.now() - 1 },
          );
        });
      }
    }
    expect(calls).toBe(5);

    const terminal = await t.run(async (ctx) =>
      await ctx.db.get("sideEffectIntents", intentId),
    );
    expect(terminal).toMatchObject({
      status: "terminal",
      attemptCount: 5,
      lastErrorCode: "provider_unavailable",
    });
    if (terminal === null) {
      throw new Error("Expected terminal side-effect intent");
    }
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.sideEffects.intents.redrive,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: intentId,
        expectedStatus: "terminal",
        expectedUpdatedAt: terminal.updatedAt,
      },
    );
    await expect(
      dispatchUploadThingDeleteWith(
        actionCtx(t),
        dispatchArgs(intentId),
        async () => undefined,
      ),
    ).resolves.toEqual({
      dispatched: true,
      status: "succeeded",
    });
    const recovered = await t.run(async (ctx) =>
      await ctx.db.get("sideEffectIntents", intentId),
    );
    expect(recovered).toMatchObject({
      status: "succeeded",
      attemptCount: 6,
    });
  });

  test("fails before any provider call while application writes are disabled", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    await initializeS1(t);
    const intentId = await seedDeleteIntent(
      t,
      adminId,
      "write-gate",
    );
    let providerCalled = false;
    await expectDomainError(
      dispatchUploadThingDeleteWith(
        actionCtx(t),
        dispatchArgs(intentId),
        async () => {
          providerCalled = true;
        },
      ),
      "WRITE_DISABLED",
    );
    expect(providerCalled).toBe(false);
    const intent = await t.run(async (ctx) =>
      await ctx.db.get("sideEffectIntents", intentId),
    );
    expect(intent).toMatchObject({
      status: "pending",
      attemptCount: 0,
    });
  });

  test("guards not-due work, live leases, stale attempts, and idempotent completion", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    await advanceToS3(t);
    const intentId = await seedDeleteIntent(
      t,
      adminId,
      "claim-guards",
    );
    const common = dispatchArgs(intentId);

    await t.run(async (ctx) => {
      await ctx.db.patch("sideEffectIntents", intentId, {
        nextAttemptAt: Date.now() + 60_000,
      });
    });
    await expect(
      t.mutation(
        internal.sideEffects.intents.claimUploadThingDelete,
        common,
      ),
    ).resolves.toEqual({
      dispatch: false,
      status: "pending",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("sideEffectIntents", intentId, {
        status: "processing",
        nextAttemptAt: undefined,
        leaseExpiresAt: Date.now() + 60_000,
      });
    });
    await expect(
      t.mutation(
        internal.sideEffects.intents.claimUploadThingDelete,
        common,
      ),
    ).resolves.toEqual({
      dispatch: false,
      status: "processing",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("sideEffectIntents", intentId, {
        leaseExpiresAt: Date.now() - 1,
      });
    });
    const claim = await t.mutation(
      internal.sideEffects.intents.claimUploadThingDelete,
      common,
    );
    expect(claim).toMatchObject({
      dispatch: true,
      attemptCount: 1,
    });
    await expectDomainError(
      t.mutation(
        internal.sideEffects.intents
          .recordUploadThingDeleteSuccess,
        { ...common, attemptCount: 2 },
      ),
      "CONFLICT",
    );
    await expect(
      t.mutation(
        internal.sideEffects.intents
          .recordUploadThingDeleteSuccess,
        { ...common, attemptCount: 1 },
      ),
    ).resolves.toBe("succeeded");
    await expect(
      t.mutation(
        internal.sideEffects.intents
          .recordUploadThingDeleteSuccess,
        { ...common, attemptCount: 1 },
      ),
    ).resolves.toBe("succeeded");
  });

  test("rejects missing, cross-run, and stale failure records", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    await advanceToS3(t);
    const missingId = await seedDeleteIntent(
      t,
      adminId,
      "missing",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("sideEffectIntents", missingId);
    });
    await expectDomainError(
      t.mutation(
        internal.sideEffects.intents.claimUploadThingDelete,
        dispatchArgs(missingId),
      ),
      "NOT_FOUND",
    );

    const crossRunId = await seedDeleteIntent(
      t,
      adminId,
      "cross-run",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("sideEffectIntents", crossRunId, {
        cutoverRunId: "another-run",
      });
    });
    await expectDomainError(
      t.mutation(
        internal.sideEffects.intents.claimUploadThingDelete,
        dispatchArgs(crossRunId),
      ),
      "CONFLICT",
    );

    const failureId = await seedDeleteIntent(
      t,
      adminId,
      "failure-guards",
    );
    const failureCommon = dispatchArgs(failureId);
    await t.mutation(
      internal.sideEffects.intents.claimUploadThingDelete,
      failureCommon,
    );
    await expectDomainError(
      t.mutation(
        internal.sideEffects.intents
          .recordUploadThingDeleteFailure,
        {
          ...failureCommon,
          attemptCount: 2,
          errorCode: "provider_unavailable",
          retryable: true,
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.mutation(
        internal.sideEffects.intents
          .recordUploadThingDeleteFailure,
        {
          ...failureCommon,
          attemptCount: 1,
          errorCode: "configuration_missing",
          retryable: false,
        },
      ),
    ).resolves.toEqual({
      status: "terminal",
      nextAttemptAt: null,
    });
    await expect(
      t.mutation(
        internal.sideEffects.intents.claimUploadThingDelete,
        failureCommon,
      ),
    ).resolves.toEqual({
      dispatch: false,
      status: "terminal",
    });
  });

  test("filters redacted operator views and protects redrive concurrency", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    await advanceToS3(t);
    const pendingId = await seedDeleteIntent(
      t,
      adminId,
      "operator-pending",
    );
    const completedId = await seedDeleteIntent(
      t,
      adminId,
      "operator-complete",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("sideEffectIntents", completedId, {
        status: "succeeded",
        nextAttemptAt: undefined,
        completedAt: 2,
        updatedAt: 2,
      });
    });

    const pendingPage = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.sideEffects.intents.list, {
        status: "pending",
        paginationOpts: { cursor: null, numItems: 10 },
      });
    expect(pendingPage.page.map((intent) => intent.id)).toEqual([
      pendingId,
    ]);
    expect(JSON.stringify(pendingPage)).not.toContain(
      "provider-operator-pending",
    );

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.sideEffects.intents.redrive,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pendingId,
          expectedStatus: "succeeded",
          expectedUpdatedAt: 1,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("sideEffectIntents", pendingId, {
        status: "processing",
        nextAttemptAt: undefined,
        leaseExpiresAt: Date.now() + 60_000,
        updatedAt: 3,
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.sideEffects.intents.redrive,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pendingId,
          expectedStatus: "processing",
          expectedUpdatedAt: 3,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("sideEffectIntents", pendingId, {
        leaseExpiresAt: Date.now() - 1,
        updatedAt: 4,
      });
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.sideEffects.intents.redrive,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pendingId,
          expectedStatus: "processing",
          expectedUpdatedAt: 4,
        },
      ),
    ).resolves.toMatchObject({
      id: pendingId,
      status: "pending",
    });
  });

  test("classifies missing provider configuration as a terminal safe error", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    await advanceToS3(t);
    const intentId = await seedDeleteIntent(
      t,
      adminId,
      "configuration",
    );
    const previousToken = process.env.UPLOADTHING_TOKEN;
    delete process.env.UPLOADTHING_TOKEN;
    try {
      await expect(
        dispatchUploadThingDeleteWith(
          actionCtx(t),
          dispatchArgs(intentId),
          deleteUploadThingFile,
        ),
      ).resolves.toEqual({
        dispatched: true,
        status: "terminal",
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env.UPLOADTHING_TOKEN;
      } else {
        process.env.UPLOADTHING_TOKEN = previousToken;
      }
    }
    const intent = await t.run(async (ctx) =>
      await ctx.db.get("sideEffectIntents", intentId),
    );
    expect(intent).toMatchObject({
      status: "terminal",
      lastErrorCode: "configuration_missing",
    });
  });

  test("validates idempotent enqueue inputs and requester ownership", async () => {
    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    const otherId = await t.run(async (ctx) =>
      await ctx.db.insert("users", {
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const enqueue = async (providerKey: string) =>
      await t.run(async (ctx) =>
        await enqueueUploadThingDelete(ctx, {
          resourceType: "profileImage",
          resourceId: "enqueue-resource",
          providerKey,
          requestedByUserId: adminId,
          cutoverRunId: CUTOVER_RUN_ID,
          clientApiVersion: BBPC_API_VERSION,
        }),
      );

    await expectDomainError(enqueue(" "), "VALIDATION_FAILED");
    await expectDomainError(
      enqueue("x".repeat(1025)),
      "VALIDATION_FAILED",
    );
    const first = await enqueue("provider-enqueue");
    expect(first.created).toBe(true);
    const duplicate = await enqueue("provider-enqueue");
    expect(duplicate).toMatchObject({
      created: false,
      intent: { idempotencyKey: first.intent.idempotencyKey },
    });
    await expectDomainError(
      enqueue("provider-conflict"),
      "CONFLICT",
    );
    expect(isIntentOwnedBy(first.intent, adminId)).toBe(true);
    expect(isIntentOwnedBy(first.intent, otherId)).toBe(false);
  });

  test("uses bounded retry delays and classifies explicit provider rejection", async () => {
    expect(retryDelayForAttempt(0)).toBe(60_000);
    expect(retryDelayForAttempt(2)).toBe(300_000);
    expect(retryDelayForAttempt(3)).toBe(1_800_000);
    expect(retryDelayForAttempt(4)).toBe(7_200_000);
    expect(() => {
      requireSuccessfulDelete({
        success: true,
        deletedCount: 1,
      });
    }).not.toThrow();
    for (const invalidResponse of [
      null,
      [],
      {},
      { success: "yes", deletedCount: 1 },
      { success: true },
      { success: true, deletedCount: "one" },
      { success: true, deletedCount: Number.NaN },
    ]) {
      expect(() => {
        requireSuccessfulDelete(invalidResponse);
      }).toThrow("provider_unavailable");
    }

    const t = createTestBackend();
    const adminId = await seedAdmin(t);
    await advanceToS3(t);
    const intentId = await seedDeleteIntent(
      t,
      adminId,
      "rejected",
    );
    await expect(
      dispatchUploadThingDeleteWith(
        actionCtx(t),
        dispatchArgs(intentId),
        async () => {
          requireSuccessfulDelete({
            success: false,
            deletedCount: 0,
          });
        },
      ),
    ).resolves.toEqual({
      dispatched: true,
      status: "retryScheduled",
    });
    const intent = await t.run(async (ctx) =>
      await ctx.db.get("sideEffectIntents", intentId),
    );
    expect(intent).toMatchObject({
      status: "retryScheduled",
      lastErrorCode: "provider_rejected",
    });
  });
});
