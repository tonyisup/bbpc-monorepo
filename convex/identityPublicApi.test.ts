/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";
import {
  MAX_PUBLIC_HOST_MEMBERSHIPS_TO_INSPECT,
  MAX_ROLE_CATALOG_SIZE,
} from "./identity/limits.js";

const modules = import.meta.glob("./**/*.ts");

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

async function seedUser(
  t: TestBackend,
  input: {
    name: string | null;
    status?: "active" | "disabled";
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      ...(input.name === null ? {} : { name: input.name }),
      email: `${input.name ?? "unnamed"}@private.example`,
      normalizedEmail: `${input.name ?? "unnamed"}@private.example`
        .toLowerCase(),
      ...(input.name === null
        ? {}
        : {
            image: `https://images.example/${encodeURIComponent(input.name)}.png`,
          }),
      status: input.status ?? "active",
      createdAt: 1,
      updatedAt: 2,
    });
  });
}

async function seedRole(
  t: TestBackend,
  input: { name: string; admin: boolean },
): Promise<Id<"roles">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("roles", {
      name: input.name,
      normalizedName: input.name.toLowerCase(),
      description: `${input.name} role`,
      admin: input.admin,
      permissions: input.admin ? ["admin"] : ["member"],
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function assignRole(
  t: TestBackend,
  userId: Id<"users">,
  roleId: Id<"roles">,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("userRoles", {
      userId,
      roleId,
      assignedAt: 1,
    });
  });
}

describe("public host catalog", () => {
  test("returns only safe active administrator fields and deduplicates roles", async () => {
    const t = createTestBackend();
    const [adminRole, producerRole, memberRole] = await Promise.all([
      seedRole(t, { name: "Administrator", admin: true }),
      seedRole(t, { name: "Producer", admin: true }),
      seedRole(t, { name: "Member", admin: false }),
    ]);
    const [alice, zed, disabled, member] = await Promise.all([
      seedUser(t, { name: "Alice Host" }),
      seedUser(t, { name: "Zed Host" }),
      seedUser(t, {
        name: "Disabled Host",
        status: "disabled",
      }),
      seedUser(t, { name: "Listener" }),
    ]);
    await Promise.all([
      assignRole(t, alice, adminRole),
      assignRole(t, alice, producerRole),
      assignRole(t, zed, producerRole),
      assignRole(t, disabled, adminRole),
      assignRole(t, member, memberRole),
    ]);

    const hosts = await t.query(api.identity.public.listHosts, {});

    expect(hosts).toEqual([
      {
        id: alice,
        name: "Alice Host",
        image: "https://images.example/Alice%20Host.png",
      },
      {
        id: zed,
        name: "Zed Host",
        image: "https://images.example/Zed%20Host.png",
      },
    ]);
    expect(Object.keys(hosts[0] ?? {}).sort()).toEqual([
      "id",
      "image",
      "name",
    ]);
  });

  test("fails closed when the role catalog exceeds its bound", async () => {
    const t = createTestBackend();
    await Promise.all(
      Array.from(
        { length: MAX_ROLE_CATALOG_SIZE + 1 },
        (_, index) =>
          seedRole(t, {
            name: `Role ${String(index).padStart(2, "0")}`,
            admin: false,
          }),
      ),
    );

    await expectDomainError(
      t.query(api.identity.public.listHosts, {}),
      "CONFLICT",
    );
  });

  test("fails closed when administrator memberships exceed their bound", async () => {
    const t = createTestBackend();
    const roleId = await seedRole(t, {
      name: "Administrator",
      admin: true,
    });
    const userIds = await Promise.all(
      Array.from(
        {
          length:
            MAX_PUBLIC_HOST_MEMBERSHIPS_TO_INSPECT + 1,
        },
        (_, index) =>
          seedUser(t, {
            name: `Host ${String(index).padStart(3, "0")}`,
          }),
      ),
    );
    await Promise.all(
      userIds.map((userId) => assignRole(t, userId, roleId)),
    );

    await expectDomainError(
      t.query(api.identity.public.listHosts, {}),
      "CONFLICT",
    );
  });
});
