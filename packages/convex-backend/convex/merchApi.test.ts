/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { MAX_MERCH_ITEMS } from "./merch/model.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "merch-api-test";
const NOW = Date.parse("2026-10-16T18:00:00Z");
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|merch-admin",
  issuer: "https://issuer.example.test",
  subject: "merch-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|merch-member",
  issuer: "https://issuer.example.test",
  subject: "merch-member",
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
    actor: "merch-api-test",
    ...(nextStage === "S3"
      ? {
          approvedBackupId: "merch-backup",
          approvedBackupChecksum: "sha256:merch",
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
    actor: "merch-api-test",
  });
  await transition(t, "S0", "S1");
  if (writable) {
    await transition(t, "S1", "S2");
    await transition(t, "S2", "S3");
  }
  return t;
}

interface MerchInput {
  title: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  priceLabel: string | null;
  badge: string | null;
  featured: boolean;
  visible: boolean;
}

function input(overrides: Partial<MerchInput> = {}) {
  return {
    clientApiVersion: BBPC_API_VERSION,
    title: "Bad Boys Logo Tee",
    description: null,
    url: "https://www.teepublic.com/t-shirt/1-bad-boys-logo",
    imageUrl: null,
    priceLabel: null,
    badge: null,
    featured: false,
    visible: true,
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

describe("merch administration", () => {
  test("requires an administrator and enabled writes", async () => {
    const t = await createBackend({ writable: false });

    await expectDomainError(
      t.query(api.merch.admin.list, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(api.merch.admin.list, {}),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.merch.admin.create, input()),
      "FORBIDDEN",
    );
    await expectDomainError(
      asAdmin(t).mutation(api.merch.admin.create, input()),
      "WRITE_DISABLED",
    );
  });

  test("refuses every write to members and anonymous callers", async () => {
    const t = await createBackend();
    const { id } = await asAdmin(t).mutation(api.merch.admin.create, input());
    const writes = (caller: TestBackend | ReturnType<typeof asAdmin>) => [
      caller.mutation(api.merch.admin.create, input()),
      caller.mutation(api.merch.admin.update, { ...input(), id }),
      caller.mutation(api.merch.admin.setVisible, {
        clientApiVersion: BBPC_API_VERSION,
        id,
        visible: false,
      }),
      caller.mutation(api.merch.admin.move, {
        clientApiVersion: BBPC_API_VERSION,
        id,
        direction: "down",
      }),
      caller.mutation(api.merch.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id,
      }),
    ];
    for (const request of writes(t.withIdentity(MEMBER_IDENTITY))) {
      await expectDomainError(request, "FORBIDDEN");
    }
    for (const request of writes(t)) {
      await expectDomainError(request, "AUTHENTICATION_REQUIRED");
    }
    await expect(
      asAdmin(t).query(api.merch.admin.list, {}),
    ).resolves.toMatchObject([{ id, visible: true }]);
  });

  test("changes only visibility, so a stale list cannot undo an edit", async () => {
    const t = await createBackend();
    const { id } = await asAdmin(t).mutation(api.merch.admin.create, input());
    vi.setSystemTime(NOW + 1000);
    // Another tab renames the item after this list was loaded.
    await asAdmin(t).mutation(api.merch.admin.update, {
      ...input({ title: "Renamed elsewhere" }),
      id,
    });
    vi.setSystemTime(NOW + 2000);

    const hidden = await asAdmin(t).mutation(api.merch.admin.setVisible, {
      clientApiVersion: BBPC_API_VERSION,
      id,
      visible: false,
    });
    expect(hidden).toMatchObject({
      title: "Renamed elsewhere",
      visible: false,
      updatedAt: NOW + 2000,
    });
    // Setting the current value again is a no-op.
    await expect(
      asAdmin(t).mutation(api.merch.admin.setVisible, {
        clientApiVersion: BBPC_API_VERSION,
        id,
        visible: false,
      }),
    ).resolves.toEqual(hidden);
    await expect(t.query(api.merch.public.listVisible, {})).resolves.toEqual(
      [],
    );
    await expectDomainError(
      asAdmin(t).mutation(api.merch.admin.setVisible, {
        clientApiVersion: "old-version",
        id,
        visible: true,
      }),
      "STALE_CLIENT",
    );

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
        .filter((event) => event.action === "merch.admin.visibilityChanged")
        .map((event) => event.metadata),
    ).toEqual([{ visible: false }]);
  });

  test("validates and normalizes item fields", async () => {
    const t = await createBackend();
    const create = (overrides: Partial<MerchInput>) =>
      asAdmin(t).mutation(api.merch.admin.create, input(overrides));

    await expectDomainError(
      asAdmin(t).mutation(api.merch.admin.create, {
        ...input(),
        clientApiVersion: "old-version",
      }),
      "STALE_CLIENT",
    );
    for (const overrides of [
      { title: "   " },
      { title: "x".repeat(81) },
      { description: "x".repeat(201) },
      { url: "" },
      { url: "javascript:alert(1)" },
      { url: "not a url" },
      { imageUrl: "data:image/png;base64,AAAA" },
      { priceLabel: "x".repeat(25) },
      { badge: "x".repeat(21) },
    ]) {
      await expectDomainError(create(overrides), "VALIDATION_FAILED");
    }

    const created = await create({
      title: "  Reese's Cup Mug  ",
      description: " For the MCP. ",
      url: " https://www.teepublic.com/mug/2-reeses ",
      imageUrl: " https://images.teepublic.com/mug.jpg ",
      priceLabel: " From $15 ",
      badge: " New ",
      featured: true,
    });
    expect(created).toMatchObject({
      title: "Reese's Cup Mug",
      description: "For the MCP.",
      url: "https://www.teepublic.com/mug/2-reeses",
      imageUrl: "https://images.teepublic.com/mug.jpg",
      priceLabel: "From $15",
      badge: "New",
      featured: true,
      visible: true,
      sortOrder: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // Text at each limit is accepted, and symbols are stored as written.
    const atLimits = await asAdmin(t).mutation(api.merch.admin.update, {
      ...input({
        title: `Bad Boys™ ${"x".repeat(70)}`,
        description: `Wait for it… ${"x".repeat(187)}`,
        priceLabel: "x".repeat(24),
        badge: "x".repeat(20),
      }),
      id: created.id,
    });
    expect(atLimits.title).toBe(`Bad Boys™ ${"x".repeat(70)}`);
    expect(atLimits.title).toHaveLength(80);
    expect(atLimits.description).toHaveLength(200);
    expect(atLimits.description?.startsWith("Wait for it…")).toBe(true);

    // Blank optional text clears the field.
    const cleared = await asAdmin(t).mutation(api.merch.admin.update, {
      ...input({ description: "  ", imageUrl: "", priceLabel: " ", badge: "" }),
      id: created.id,
    });
    expect(cleared).toMatchObject({
      description: null,
      imageUrl: null,
      priceLabel: null,
      badge: null,
    });
  });

  test("appends, reorders, updates, deletes and audits items", async () => {
    const t = await createBackend();
    const first = await asAdmin(t).mutation(
      api.merch.admin.create,
      input({ title: "First" }),
    );
    const second = await asAdmin(t).mutation(
      api.merch.admin.create,
      input({ title: "Second" }),
    );
    const third = await asAdmin(t).mutation(
      api.merch.admin.create,
      input({ title: "Third" }),
    );
    expect([first, second, third].map((item) => item.sortOrder)).toEqual([
      0, 1, 2,
    ]);

    const moved = await asAdmin(t).mutation(api.merch.admin.move, {
      clientApiVersion: BBPC_API_VERSION,
      id: third.id,
      direction: "up",
    });
    expect(moved.map((item) => item.title)).toEqual([
      "First",
      "Third",
      "Second",
    ]);
    // Moving past either end changes nothing.
    await expect(
      asAdmin(t).mutation(api.merch.admin.move, {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
        direction: "up",
      }),
    ).resolves.toEqual(moved);
    // Moving the last item down changes nothing and writes no audit event.
    await expect(
      asAdmin(t).mutation(api.merch.admin.move, {
        clientApiVersion: BBPC_API_VERSION,
        id: second.id,
        direction: "down",
      }),
    ).resolves.toEqual(moved);
    const movedDown = await asAdmin(t).mutation(api.merch.admin.move, {
      clientApiVersion: BBPC_API_VERSION,
      id: third.id,
      direction: "down",
    });
    expect(movedDown.map((item) => item.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(movedDown.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
    await expect(
      asAdmin(t).mutation(api.merch.admin.move, {
        clientApiVersion: BBPC_API_VERSION,
        id: third.id,
        direction: "up",
      }),
    ).resolves.toEqual(moved);

    vi.setSystemTime(NOW + 1000);
    const updated = await asAdmin(t).mutation(api.merch.admin.update, {
      ...input({ title: "Third, edited", visible: false }),
      id: third.id,
    });
    expect(updated).toMatchObject({
      title: "Third, edited",
      visible: false,
      sortOrder: moved[1]?.sortOrder,
      createdAt: NOW,
      updatedAt: NOW + 1000,
    });

    await expect(
      asAdmin(t).mutation(api.merch.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
      }),
    ).resolves.toEqual({ id: first.id });
    for (const request of [
      asAdmin(t).mutation(api.merch.admin.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
      }),
      asAdmin(t).mutation(api.merch.admin.move, {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
        direction: "down",
      }),
      asAdmin(t).mutation(api.merch.admin.update, {
        ...input(),
        id: first.id,
      }),
      asAdmin(t).mutation(api.merch.admin.setVisible, {
        clientApiVersion: BBPC_API_VERSION,
        id: first.id,
        visible: false,
      }),
    ]) {
      await expectDomainError(request, "NOT_FOUND");
    }
    await expect(
      asAdmin(t).query(api.merch.admin.list, {}),
    ).resolves.toMatchObject([{ title: "Third, edited" }, { title: "Second" }]);

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
        .filter((event) => event.targetType === "merchItem")
        .map((event) => event.action),
    ).toEqual([
      "merch.admin.created",
      "merch.admin.created",
      "merch.admin.created",
      "merch.admin.moved",
      "merch.admin.moved",
      "merch.admin.moved",
      "merch.admin.updated",
      "merch.admin.deleted",
    ]);
  });

  test("caps the number of items", async () => {
    const t = await createBackend();
    const items = [];
    for (let index = 0; index < MAX_MERCH_ITEMS; index += 1) {
      items.push(
        await asAdmin(t).mutation(
          api.merch.admin.create,
          input({ title: `Item ${String(index)}` }),
        ),
      );
    }
    await expectDomainError(
      asAdmin(t).mutation(api.merch.admin.create, input()),
      "CONFLICT",
    );
    const last = items.at(-1);
    if (last === undefined) {
      throw new Error("Expected seeded items");
    }
    await asAdmin(t).mutation(api.merch.admin.remove, {
      clientApiVersion: BBPC_API_VERSION,
      id: last.id,
    });
    await expect(
      asAdmin(t).mutation(api.merch.admin.create, input({ title: "Again" })),
    ).resolves.toMatchObject({ title: "Again", sortOrder: last.sortOrder });
  });
});

describe("visible merch", () => {
  test("lists only visible items, in shop order, without admin fields", async () => {
    const t = await createBackend();
    const tee = await asAdmin(t).mutation(
      api.merch.admin.create,
      input({ title: "Tee", featured: true }),
    );
    await asAdmin(t).mutation(
      api.merch.admin.create,
      input({ title: "Draft hoodie", visible: false }),
    );
    const mug = await asAdmin(t).mutation(
      api.merch.admin.create,
      input({ title: "Mug" }),
    );
    await asAdmin(t).mutation(api.merch.admin.move, {
      clientApiVersion: BBPC_API_VERSION,
      id: mug.id,
      direction: "up",
    });
    await asAdmin(t).mutation(api.merch.admin.move, {
      clientApiVersion: BBPC_API_VERSION,
      id: mug.id,
      direction: "up",
    });

    const listed = await t.query(api.merch.public.listVisible, {});
    expect(listed.map((item) => item.title)).toEqual(["Mug", "Tee"]);
    expect(listed[1]).toEqual({
      id: tee.id,
      title: "Tee",
      description: null,
      url: "https://www.teepublic.com/t-shirt/1-bad-boys-logo",
      imageUrl: null,
      priceLabel: null,
      badge: null,
      featured: true,
      updatedAt: NOW,
    });
  });
});
