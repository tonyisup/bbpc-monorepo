/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  FEEDBACK_COUNT_CAP,
  FEEDBACK_RATE_WINDOW_MS,
  MAX_FEEDBACK_PER_WINDOW,
} from "./feedback/model.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "feedback-api-test";
const NOW = Date.parse("2026-11-19T18:00:00Z");
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|feedback-admin",
  issuer: "https://issuer.example.test",
  subject: "feedback-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|feedback-member",
  issuer: "https://issuer.example.test",
  subject: "feedback-member",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;
type TestIdentity = typeof ADMIN_IDENTITY;

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

async function seedUser(
  t: TestBackend,
  identity: TestIdentity,
  admin: boolean,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const normalizedEmail = `${identity.subject}@example.test`;
    const userId = await ctx.db.insert("users", {
      name: identity.subject,
      email: normalizedEmail,
      normalizedEmail,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...identity,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    if (admin) {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Administrator role",
        admin: true,
        permissions: ["admin"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", { userId, roleId, assignedAt: 1 });
    }
    return userId;
  });
}

async function transition(
  t: TestBackend,
  expectedStage: "S0" | "S1" | "S2",
  nextStage: "S1" | "S2" | "S3",
): Promise<void> {
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage,
    nextStage,
    actor: "feedback-api-test",
    ...(nextStage === "S3"
      ? {
          approvedBackupId: "feedback-backup",
          approvedBackupChecksum: "sha256:feedback",
        }
      : {}),
  });
}

async function createBackend(
  { writable }: { writable: boolean } = { writable: true },
): Promise<TestBackend> {
  const t = createTestBackend();
  await seedUser(t, ADMIN_IDENTITY, true);
  await seedUser(t, MEMBER_IDENTITY, false);
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "feedback-api-test",
  });
  await transition(t, "S0", "S1");
  if (writable) {
    await transition(t, "S1", "S2");
    await transition(t, "S2", "S3");
  }
  return t;
}

function submission(overrides: Partial<{
  category: "bug" | "idea" | "praise" | "other";
  message: string;
  pagePath: string | null;
}> = {}) {
  return {
    clientApiVersion: BBPC_API_VERSION,
    category: "idea" as const,
    message: "Add a dark mode to the syllabus.",
    pagePath: "/syllabus",
    ...overrides,
  };
}

function asAdmin(t: TestBackend) {
  return t.withIdentity(ADMIN_IDENTITY);
}

function asMember(t: TestBackend) {
  return t.withIdentity(MEMBER_IDENTITY);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("feedback submission", () => {
  test("requires a signed-in member and enabled writes", async () => {
    const t = await createBackend({ writable: false });

    await expectDomainError(
      t.mutation(api.feedback.member.submit, submission()),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      asMember(t).mutation(api.feedback.member.submit, submission()),
      "WRITE_DISABLED",
    );
  });

  test("validates the message and page", async () => {
    const t = await createBackend();
    const submit = (overrides: Parameters<typeof submission>[0]) =>
      asMember(t).mutation(api.feedback.member.submit, submission(overrides));

    await expectDomainError(
      asMember(t).mutation(api.feedback.member.submit, {
        ...submission(),
        clientApiVersion: "old-version",
      }),
      "STALE_CLIENT",
    );
    for (const overrides of [
      { message: "   " },
      { message: "x".repeat(2001) },
      { pagePath: "" },
      { pagePath: "history" },
      { pagePath: "//evil.example/path" },
      { pagePath: "https://example.test/history" },
      { pagePath: "/has space" },
      { pagePath: "/history?token=secret" },
      { pagePath: "/history#transcript" },
      { pagePath: `/${"x".repeat(300)}` },
    ]) {
      await expectDomainError(submit(overrides), "VALIDATION_FAILED");
    }

    const result = await submit({
      category: "bug",
      message: "  The ™ symbol vanished 🎬  ",
      pagePath: null,
    });
    expect(result).toMatchObject({ createdAt: NOW });
    const stored = await t.run(async (ctx) => await ctx.db.get("feedback", result.id));
    expect(stored).toMatchObject({
      category: "bug",
      message: "The ™ symbol vanished 🎬",
      status: "new",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(stored?.pagePath).toBeUndefined();
  });

  test("limits how often one person can send feedback", async () => {
    const t = await createBackend();
    for (let index = 0; index < MAX_FEEDBACK_PER_WINDOW; index += 1) {
      await asMember(t).mutation(
        api.feedback.member.submit,
        submission({ message: `Note ${String(index)}` }),
      );
    }
    await expectDomainError(
      asMember(t).mutation(api.feedback.member.submit, submission()),
      "CONFLICT",
    );
    // Deleting a message does not hand capacity back within the window.
    const { items } = await asAdmin(t).query(api.feedback.admin.list, {
      status: "new",
    });
    expect(items).toHaveLength(MAX_FEEDBACK_PER_WINDOW);
    for (const item of items.slice(0, 1)) {
      await asAdmin(t).mutation(api.feedback.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: item.id,
      });
    }
    await expectDomainError(
      asMember(t).mutation(api.feedback.member.submit, submission()),
      "CONFLICT",
    );
    // Another person is unaffected.
    await expect(
      asAdmin(t).mutation(api.feedback.member.submit, submission()),
    ).resolves.toMatchObject({ createdAt: NOW });

    vi.setSystemTime(NOW + FEEDBACK_RATE_WINDOW_MS);
    await expect(
      asMember(t).mutation(api.feedback.member.submit, submission()),
    ).resolves.toMatchObject({ createdAt: NOW + FEEDBACK_RATE_WINDOW_MS });
  });

  test("credits the signed-in administrator while impersonating", async () => {
    const t = await createBackend();
    const memberUserId = await t.run(async (ctx) => {
      const identity = await ctx.db
        .query("authIdentities")
        .withIndex("by_tokenIdentifier", (index) =>
          index.eq("tokenIdentifier", MEMBER_IDENTITY.tokenIdentifier),
        )
        .unique();
      if (identity === null) throw new Error("missing member");
      return identity.userId;
    });
    await asAdmin(t).mutation(api.identity.impersonation.start, {
      clientApiVersion: BBPC_API_VERSION,
      targetUserId: memberUserId,
      reason: "Check the feedback flow",
      durationMinutes: 15,
    });
    const result = await asAdmin(t).mutation(
      api.feedback.member.submit,
      submission(),
    );

    const stored = await t.run(async (ctx) => {
      const row = await ctx.db.get("feedback", result.id);
      return row === null ? null : await ctx.db.get("users", row.submittedByUserId);
    });
    expect(stored?.name).toBe(ADMIN_IDENTITY.subject);
    expect(memberUserId).not.toBe(stored?._id);
  });
});

describe("feedback administration", () => {
  test("requires an administrator", async () => {
    const t = await createBackend();
    const created = await asMember(t).mutation(
      api.feedback.member.submit,
      submission(),
    );

    await expectDomainError(
      t.query(api.feedback.admin.list, { status: "new" }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      asMember(t).query(api.feedback.admin.list, { status: "new" }),
      "FORBIDDEN",
    );
    await expectDomainError(
      asMember(t).query(api.feedback.admin.counts, {}),
      "FORBIDDEN",
    );
    await expectDomainError(
      asMember(t).mutation(api.feedback.admin.setStatus, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        status: "reviewed",
      }),
      "FORBIDDEN",
    );
    await expectDomainError(
      asMember(t).mutation(api.feedback.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
      "FORBIDDEN",
    );
  });

  test("lists by status, moves between statuses, deletes and audits", async () => {
    const t = await createBackend();
    const first = await asMember(t).mutation(
      api.feedback.member.submit,
      submission({ message: "First" }),
    );
    vi.setSystemTime(NOW + 1000);
    const second = await asMember(t).mutation(
      api.feedback.member.submit,
      submission({ category: "praise", message: "Second", pagePath: null }),
    );

    const fresh = await asAdmin(t).query(api.feedback.admin.list, {
      status: "new",
    });
    expect(fresh.hasMore).toBe(false);
    expect(fresh.items.map((item) => item.id)).toEqual([second.id, first.id]);
    expect(fresh.items[1]).toEqual({
      id: first.id,
      category: "idea",
      message: "First",
      pagePath: "/syllabus",
      status: "new",
      createdAt: NOW,
      updatedAt: NOW,
      submitter: {
        id: expect.any(String) as string,
        name: MEMBER_IDENTITY.subject,
        email: `${MEMBER_IDENTITY.subject}@example.test`,
      },
    });

    vi.setSystemTime(NOW + 2000);
    const reviewed = await asAdmin(t).mutation(api.feedback.admin.setStatus, {
      clientApiVersion: BBPC_API_VERSION,
      id: first.id,
      status: "reviewed",
    });
    expect(reviewed).toMatchObject({ status: "reviewed", updatedAt: NOW + 2000 });
    // Setting the same status again changes nothing.
    vi.setSystemTime(NOW + 3000);
    await expect(
      asAdmin(t).mutation(api.feedback.admin.setStatus, {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
        status: "reviewed",
      }),
    ).resolves.toEqual(reviewed);
    await asAdmin(t).mutation(api.feedback.admin.setStatus, {
      clientApiVersion: BBPC_API_VERSION,
      id: second.id,
      status: "archived",
    });

    await expect(
      asAdmin(t).query(api.feedback.admin.counts, {}),
    ).resolves.toEqual({ new: 0, reviewed: 1, archived: 1, cap: FEEDBACK_COUNT_CAP });
    await expect(
      asAdmin(t).query(api.feedback.admin.list, { status: "reviewed" }),
    ).resolves.toMatchObject({ items: [{ id: first.id }] });

    await expect(
      asAdmin(t).mutation(api.feedback.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: second.id,
      }),
    ).resolves.toEqual({ id: second.id });
    for (const request of [
      asAdmin(t).mutation(api.feedback.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: second.id,
      }),
      asAdmin(t).mutation(api.feedback.admin.setStatus, {
        clientApiVersion: BBPC_API_VERSION,
        id: second.id,
        status: "new",
      }),
    ]) {
      await expectDomainError(request, "NOT_FOUND");
    }

    const audits = await t.run(async (ctx) =>
      await ctx.db
        .query("auditEvents")
        .withIndex("by_cutoverRunId_and_createdAt", (index) =>
          index.eq("cutoverRunId", CUTOVER_RUN_ID),
        )
        .collect(),
    );
    expect(
      audits
        .filter((event) => event.targetType === "feedback")
        .map((event) => event.action),
    ).toEqual([
      "feedback.member.submitted",
      "feedback.member.submitted",
      "feedback.admin.statusChanged",
      "feedback.admin.statusChanged",
      "feedback.admin.deleted",
    ]);
  });

  test("caps the counts it reports", async () => {
    const t = await createBackend();
    const userId = await t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      if (user === null) throw new Error("missing user");
      return user._id;
    });
    await t.run(async (ctx) => {
      for (let index = 0; index < FEEDBACK_COUNT_CAP + 5; index += 1) {
        await ctx.db.insert("feedback", {
          category: "other",
          message: `Bulk ${String(index)}`,
          status: "new",
          submittedByUserId: userId,
          createdAt: NOW - index,
          updatedAt: NOW - index,
        });
      }
    });
    await expect(
      asAdmin(t).query(api.feedback.admin.counts, {}),
    ).resolves.toMatchObject({ new: FEEDBACK_COUNT_CAP + 1 });
  });
});
