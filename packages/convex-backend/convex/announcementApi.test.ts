/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { MAX_UNENDED_ANNOUNCEMENTS } from "./announcements/model.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "announcement-api-test";
const NOW = Date.parse("2026-09-23T18:00:00Z");
const HOUR = 60 * 60 * 1000;
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|announcement-admin",
  issuer: "https://issuer.example.test",
  subject: "announcement-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|announcement-member",
  issuer: "https://issuer.example.test",
  subject: "announcement-member",
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
    actor: "announcement-api-test",
    ...(nextStage === "S3"
      ? {
          approvedBackupId: "announcement-backup",
          approvedBackupChecksum: "sha256:announcement",
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
    actor: "announcement-api-test",
  });
  await transition(t, "S0", "S1");
  if (writable) {
    await transition(t, "S1", "S2");
    await transition(t, "S2", "S3");
  }
  return t;
}

function input(overrides: Partial<{
  message: string;
  severity: "info" | "warning";
  startsAt: number;
  endsAt: number;
  linkUrl: string | null;
  linkLabel: string | null;
  dismissible: boolean;
}> = {}) {
  return {
    clientApiVersion: BBPC_API_VERSION,
    message: "No episode this week.",
    severity: "info" as const,
    startsAt: NOW - HOUR,
    endsAt: NOW + HOUR,
    linkUrl: null,
    linkLabel: null,
    dismissible: true,
    ...overrides,
  };
}

function asAdmin(t: TestBackend) {
  return t.withIdentity(ADMIN_IDENTITY);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("announcement administration", () => {
  test("requires an administrator and enabled writes", async () => {
    const t = await createBackend({ writable: false });

    await expectDomainError(
      t.query(api.announcements.admin.list, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(api.announcements.admin.list, {}),
      "FORBIDDEN",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .mutation(api.announcements.admin.create, input()),
      "FORBIDDEN",
    );
    await expectDomainError(
      asAdmin(t).mutation(api.announcements.admin.create, input()),
      "WRITE_DISABLED",
    );
  });

  test("validates the message, schedule and link", async () => {
    const t = await createBackend();
    const create = (overrides: Parameters<typeof input>[0]) =>
      asAdmin(t).mutation(api.announcements.admin.create, input(overrides));

    await expectDomainError(
      asAdmin(t).mutation(api.announcements.admin.create, {
        ...input(),
        clientApiVersion: "old-version",
      }),
      "STALE_CLIENT",
    );
    for (const overrides of [
      { message: "   " },
      { message: "x".repeat(281) },
      { endsAt: NOW - HOUR },
      { startsAt: NOW + HOUR, endsAt: NOW + HOUR },
      { startsAt: NOW - 2 * HOUR, endsAt: NOW - HOUR },
      { startsAt: 1.5 },
      { endsAt: Number.POSITIVE_INFINITY },
      { linkLabel: "Listen" },
      { linkUrl: "javascript:alert(1)" },
      { linkUrl: "not a url" },
      { linkUrl: "https://example.test", linkLabel: " " },
      { linkUrl: "https://example.test", linkLabel: "x".repeat(41) },
    ]) {
      await expectDomainError(create(overrides), "VALIDATION_FAILED");
    }

    const created = await create({
      message: "  Live show Friday!  ",
      severity: "warning",
      linkUrl: " https://example.test/live ",
      linkLabel: " Watch ",
      dismissible: false,
    });
    expect(created).toMatchObject({
      message: "Live show Friday!",
      severity: "warning",
      startsAt: NOW - HOUR,
      endsAt: NOW + HOUR,
      linkUrl: "https://example.test/live",
      linkLabel: "Watch",
      dismissible: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await expect(
      asAdmin(t).query(api.announcements.admin.list, {}),
    ).resolves.toEqual([created]);
  });

  test("updates, ends, deletes and audits announcements", async () => {
    const t = await createBackend();
    const created = await asAdmin(t).mutation(
      api.announcements.admin.create,
      input({ linkUrl: "https://example.test" }),
    );

    vi.setSystemTime(NOW + 1000);
    const updated = await asAdmin(t).mutation(api.announcements.admin.update, {
      ...input({ message: "Updated", severity: "warning" }),
      id: created.id,
    });
    expect(updated).toMatchObject({
      id: created.id,
      message: "Updated",
      severity: "warning",
      linkUrl: null,
      linkLabel: null,
      createdAt: NOW,
      updatedAt: NOW + 1000,
    });

    const ended = await asAdmin(t).mutation(api.announcements.admin.endNow, {
      clientApiVersion: BBPC_API_VERSION,
      id: created.id,
    });
    expect(ended).toMatchObject({ endsAt: NOW + 1000, startsAt: NOW - HOUR });
    await expect(
      asAdmin(t).mutation(api.announcements.admin.endNow, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
    ).resolves.toEqual(ended);

    // Text on an ended announcement stays editable; its schedule cannot stay past.
    await expect(
      asAdmin(t).mutation(api.announcements.admin.update, {
        ...input({ message: "Archived", startsAt: ended.startsAt, endsAt: ended.endsAt }),
        id: created.id,
      }),
    ).resolves.toMatchObject({ message: "Archived" });
    await expectDomainError(
      asAdmin(t).mutation(api.announcements.admin.update, {
        ...input({ startsAt: NOW - 2 * HOUR, endsAt: NOW }),
        id: created.id,
      }),
      "VALIDATION_FAILED",
    );

    const scheduled = await asAdmin(t).mutation(
      api.announcements.admin.create,
      input({ startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR }),
    );
    await expect(
      asAdmin(t).mutation(api.announcements.admin.endNow, {
        clientApiVersion: BBPC_API_VERSION,
        id: scheduled.id,
      }),
    ).resolves.toMatchObject({ startsAt: NOW + 999, endsAt: NOW + 1000 });

    await expect(
      asAdmin(t).mutation(api.announcements.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
    ).resolves.toEqual({ id: created.id });
    for (const request of [
      asAdmin(t).mutation(api.announcements.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
      asAdmin(t).mutation(api.announcements.admin.endNow, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
      asAdmin(t).mutation(api.announcements.admin.update, {
        ...input(),
        id: created.id,
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
        .filter((event) => event.targetType === "announcement")
        .map((event) => event.action),
    ).toEqual([
      "announcements.admin.created",
      "announcements.admin.updated",
      "announcements.admin.ended",
      "announcements.admin.updated",
      "announcements.admin.created",
      "announcements.admin.ended",
      "announcements.admin.deleted",
    ]);
  });

  test("caps live and scheduled announcements", async () => {
    const t = await createBackend();
    const first = await asAdmin(t).mutation(
      api.announcements.admin.create,
      input({ message: "Announcement 0" }),
    );
    for (let index = 1; index < MAX_UNENDED_ANNOUNCEMENTS; index += 1) {
      await asAdmin(t).mutation(
        api.announcements.admin.create,
        input({ message: `Announcement ${String(index)}` }),
      );
    }
    await expectDomainError(
      asAdmin(t).mutation(api.announcements.admin.create, input()),
      "CONFLICT",
    );
    // An existing announcement can still be edited at capacity.
    await expect(
      asAdmin(t).mutation(api.announcements.admin.update, {
        ...input({ message: "Edited at capacity" }),
        id: first.id,
      }),
    ).resolves.toMatchObject({ message: "Edited at capacity" });

    await asAdmin(t).mutation(api.announcements.admin.endNow, {
      clientApiVersion: BBPC_API_VERSION,
      id: first.id,
    });
    await expect(
      asAdmin(t).mutation(api.announcements.admin.create, input()),
    ).resolves.toMatchObject({ message: "No episode this week." });
  });
});

describe("live announcements", () => {
  test("returns only announcements live at the supplied time", async () => {
    const t = await createBackend();
    const live = await asAdmin(t).mutation(
      api.announcements.admin.create,
      input({ message: "Live info" }),
    );
    const olderWarning = await asAdmin(t).mutation(
      api.announcements.admin.create,
      input({
        message: "Older warning",
        severity: "warning",
        startsAt: NOW - 2 * HOUR,
      }),
    );
    const newerWarning = await asAdmin(t).mutation(
      api.announcements.admin.create,
      input({ message: "Newer warning", severity: "warning" }),
    );
    await asAdmin(t).mutation(
      api.announcements.admin.create,
      input({ message: "Scheduled", startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR }),
    );

    const listed = await t.query(api.announcements.public.listLive, {
      now: NOW,
    });
    expect(listed.map((row) => row.id)).toEqual([
      newerWarning.id,
      olderWarning.id,
      live.id,
    ]);
    expect(listed[2]).toEqual({
      id: live.id,
      message: "Live info",
      severity: "info",
      startsAt: NOW - HOUR,
      endsAt: NOW + HOUR,
      linkUrl: null,
      linkLabel: null,
      dismissible: true,
      updatedAt: NOW,
    });

    await expect(
      t.query(api.announcements.public.listLive, { now: NOW + HOUR }),
    ).resolves.toMatchObject([{ message: "Scheduled" }]);
    await expect(
      t.query(api.announcements.public.listLive, { now: NOW + 2 * HOUR }),
    ).resolves.toEqual([]);
    await expectDomainError(
      t.query(api.announcements.public.listLive, { now: -1 }),
      "VALIDATION_FAILED",
    );
  });
});
