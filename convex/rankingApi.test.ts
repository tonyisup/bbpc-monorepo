/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  validateRankingComment,
  validateRankingDescription,
  validateRankingMaxItems,
  validateRankingPageSize,
  validateRankingRank,
  validateRankingStatus,
  validateRankingTargetType,
  validateRankingTimestamp,
  validateRankingTitle,
  validateRankingTypeName,
} from "./rankings/writeModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "ranking-api-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|ranking-admin",
  issuer: "https://issuer.example.test",
  subject: "ranking-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|ranking-member",
  issuer: "https://issuer.example.test",
  subject: "ranking-member",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|ranking-other",
  issuer: "https://issuer.example.test",
  subject: "ranking-other",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;
type TestIdentity = typeof ADMIN_IDENTITY;
type RankingTargetType = "MOVIE" | "SHOW" | "EPISODE";

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({
      code: expectedCode,
      ...(details === undefined ? {} : { details }),
    });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function seedUser(
  t: TestBackend,
  input: {
    identity: TestIdentity;
    name: string;
    admin?: boolean;
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const normalizedEmail = `${input.identity.subject}@example.test`;
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: normalizedEmail,
      normalizedEmail,
      image: `https://images.example.test/${input.identity.subject}.jpg`,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...input.identity,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    if (input.admin === true) {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Administrator role",
        admin: true,
        permissions: ["admin"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
        assignedAt: 1,
      });
    }
    return userId;
  });
}

async function seedActors(t: TestBackend) {
  const adminId = await seedUser(t, {
    identity: ADMIN_IDENTITY,
    name: "Ranking Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Ranking Member",
  });
  const otherId = await seedUser(t, {
    identity: OTHER_IDENTITY,
    name: "Ranking Other",
  });
  return { adminId, memberId, otherId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "ranking-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "ranking-api-test",
  });
}

async function advanceFromS1ToS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "ranking-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "ranking-api-test",
    approvedBackupId: "ranking-api-backup",
    approvedBackupChecksum: "sha256:ranking-api",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await advanceFromS1ToS3(t);
}

async function seedCatalog(t: TestBackend) {
  return await t.run(async (ctx) => {
    const movieIds = [];
    for (let index = 1; index <= 5; index += 1) {
      movieIds.push(
        await ctx.db.insert("movies", {
          title: `Movie ${String(index)}`,
          normalizedTitle: `movie ${String(index)}`,
          year: 2000 + index,
          poster: `https://images.example.test/movie-${String(index)}.jpg`,
          url: `https://movies.example.test/${String(index)}`,
          tmdbId: index,
        }),
      );
    }
    const showId = await ctx.db.insert("shows", {
      title: "Ranking show",
      normalizedTitle: "ranking show",
      year: 2020,
      poster: "https://images.example.test/show.jpg",
      url: "https://shows.example.test/ranking",
    });
    const episodeId = await ctx.db.insert("episodes", {
      number: 42,
      title: "Ranking episode",
      date: "2026-07-24",
      status: "published",
    });
    return { episodeId, movieIds, showId };
  });
}

function catalogMovieId(
  catalog: { movieIds: Array<Id<"movies">> },
  index: number,
): Id<"movies"> {
  const id = catalog.movieIds.at(index);
  if (id === undefined) {
    throw new Error(`Missing synthetic movie ${String(index)}`);
  }
  return id;
}

async function insertType(
  t: TestBackend,
  input: {
    targetType: RankingTargetType;
    maxItems?: number;
    name?: string;
    createdAt?: number;
  },
): Promise<Id<"rankedListTypes">> {
  return await t.run(async (ctx) => {
    const createdAt = input.createdAt ?? 1;
    return await ctx.db.insert("rankedListTypes", {
      name: input.name ?? `${input.targetType} ranking`,
      maxItems: input.maxItems ?? 5,
      targetType: input.targetType,
      createdAt,
      updatedAt: createdAt,
    });
  });
}

async function insertList(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    typeId: Id<"rankedListTypes">;
    status?: "DRAFT" | "PUBLISHED";
    title?: string;
    updatedAt?: number;
  },
): Promise<Id<"rankedLists">> {
  return await t.run(async (ctx) => {
    const updatedAt = input.updatedAt ?? 1;
    return await ctx.db.insert("rankedLists", {
      userId: input.userId,
      rankedListTypeId: input.typeId,
      status: input.status ?? "DRAFT",
      ...(input.title === undefined ? {} : { title: input.title }),
      createdAt: updatedAt,
      updatedAt,
    });
  });
}

async function insertMovieItem(
  t: TestBackend,
  input: {
    listId: Id<"rankedLists">;
    movieId: Id<"movies">;
    rank: number;
    createdAt?: number;
  },
): Promise<Id<"rankedItems">> {
  return await t.run(async (ctx) => {
    const createdAt = input.createdAt ?? input.rank;
    return await ctx.db.insert("rankedItems", {
      rankedListId: input.listId,
      targetType: "movie",
      movieId: input.movieId,
      rank: input.rank,
      createdAt,
      updatedAt: createdAt,
    });
  });
}

describe("Ranking workflows", () => {
  test("validates canonical ranking boundaries", async () => {
    expect(validateRankingTypeName("  Favorites  ")).toBe(
      "Favorites",
    );
    expect(validateRankingDescription(null)).toBeUndefined();
    expect(validateRankingTitle("   ")).toBeUndefined();
    expect(validateRankingComment(" Note ")).toBe("Note");
    expect(validateRankingTargetType("EPISODE")).toBe("EPISODE");
    expect(validateRankingStatus("PUBLISHED")).toBe("PUBLISHED");
    expect(validateRankingMaxItems(100)).toBe(100);
    expect(validateRankingRank(1, 1)).toBe(1);
    expect(validateRankingTimestamp(0, "Ranking time")).toBe(0);
    expect(() => {
      validateRankingPageSize(50);
    }).not.toThrow();

    const invalidValidations: Array<() => unknown> = [
      () => validateRankingTypeName(" "),
      () => validateRankingTypeName("x".repeat(1001)),
      () => validateRankingDescription("x".repeat(1001)),
      () => validateRankingComment("x".repeat(10_001)),
      () => validateRankingTargetType("BOOK"),
      () => validateRankingStatus("ARCHIVED"),
      () => validateRankingMaxItems(0),
      () => validateRankingMaxItems(1.5),
      () => validateRankingRank(2, 1),
      () => validateRankingRank(1.5, 2),
      () => validateRankingTimestamp(1.5, "Ranking time"),
      () => {
        validateRankingPageSize(0);
      },
      () => {
        validateRankingPageSize(51);
      },
    ];
    for (const invalid of invalidValidations) {
      await expectDomainError(
        Promise.resolve().then(invalid),
        "VALIDATION_FAILED",
      );
    }
  });

  test("manages types and owner-scoped list lifecycle", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    await initializeS1(t);

    await expectDomainError(
      t.query(api.rankings.types.list, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.types.list,
        {},
      ),
    ).resolves.toEqual([]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Movie list",
          maxItems: 3,
          targetType: "MOVIE",
        },
      ),
      "WRITE_DISABLED",
    );

    await advanceFromS1ToS3(t);
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.types.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Movie list",
          maxItems: 3,
          targetType: "MOVIE",
        },
      ),
      "FORBIDDEN",
    );
    const type = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.rankings.types.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        name: " Private movie type ",
        description: " ",
        maxItems: 3,
        targetType: "MOVIE",
        now: 10,
      },
    );
    expect(type).toMatchObject({
      name: "Private movie type",
      description: null,
      maxItems: 3,
      targetType: "MOVIE",
      createdAt: 10,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: type.id,
        },
      ),
    ).resolves.toEqual(type);
    const changedType = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.rankings.types.update,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: type.id,
        name: "Changed type",
        description: " Type note ",
        maxItems: 4,
        targetType: "SHOW",
        now: 11,
      },
    );
    expect(changedType).toMatchObject({
      name: "Changed type",
      description: "Type note",
      maxItems: 4,
      targetType: "SHOW",
      updatedAt: 11,
    });
    const auxiliaryType = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.rankings.types.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        name: "Auxiliary type",
        description: "Auxiliary description",
        maxItems: 2,
        targetType: "EPISODE",
      },
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: auxiliaryType.id,
          name: "Renamed auxiliary type",
        },
      ),
    ).resolves.toMatchObject({ name: "Renamed auxiliary type" });
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.rankings.types.remove,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: auxiliaryType.id,
      },
    );
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.rankings.types.update,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: type.id,
        targetType: "MOVIE",
        maxItems: 3,
        now: 12,
      },
    );

    const list = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.lists.createMine,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListTypeId: type.id,
        title: " Private title ",
        status: "DRAFT",
        now: 20,
      },
    );
    expect(list).toMatchObject({
      userId: memberId,
      title: "Private title",
      status: "DRAFT",
      itemCount: 0,
      items: [],
    });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.listMine,
        {},
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: list.id, itemCount: 0 }),
    ]);
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.listMine,
        { targetType: "MOVIE" },
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: list.id, itemCount: 0 }),
    ]);
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.listMine,
        { targetType: "SHOW" },
      ),
    ).resolves.toEqual([]);
    await expectDomainError(
      t
        .withIdentity(OTHER_IDENTITY)
        .query(api.rankings.lists.get, { id: list.id }),
      "FORBIDDEN",
    );
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.rankings.lists.get, { id: list.id }),
    ).resolves.toMatchObject({ id: list.id });
    await expectDomainError(
      t.withIdentity(OTHER_IDENTITY).mutation(
        api.rankings.lists.updateAccessible,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: list.id,
          status: "PUBLISHED",
        },
      ),
      "FORBIDDEN",
    );
    const updated = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.lists.updateAccessible,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: list.id,
        title: null,
        status: "PUBLISHED",
        now: 21,
      },
    );
    expect(updated).toMatchObject({
      title: null,
      status: "PUBLISHED",
      updatedAt: 21,
    });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.lists.updateAccessible,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: list.id,
        },
      ),
    ).resolves.toMatchObject({ id: list.id });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: type.id,
          maxItems: 2,
        },
      ),
    ).resolves.toMatchObject({ maxItems: 2 });
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.rankings.types.update,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: type.id,
        maxItems: 3,
      },
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: type.id,
          targetType: "SHOW",
        },
      ),
      "CONFLICT",
    );

    const transferred = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.rankings.lists.changeOwner,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: list.id,
        userId: otherId,
        now: 22,
      },
    );
    expect(transferred.userId).toBe(otherId);
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.lists.changeOwner,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: list.id,
          userId: otherId,
        },
      ),
    ).resolves.toMatchObject({ userId: otherId });
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.rankings.lists.get, { id: list.id }),
      "FORBIDDEN",
    );
    await expect(
      t.withIdentity(OTHER_IDENTITY).mutation(
        api.rankings.lists.removeAccessible,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: list.id,
        },
      ),
    ).resolves.toEqual({ id: list.id, deletedItems: 0 });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: type.id,
        },
      ),
    ).resolves.toEqual({ id: type.id });

    const audits = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditEvents")
        .withIndex("by_cutoverRunId_and_createdAt", (index) =>
          index.eq("cutoverRunId", CUTOVER_RUN_ID),
        )
        .collect();
    });
    expect(JSON.stringify(audits)).not.toContain("Private");
  });

  test("upserts targets, swaps occupied ranks, moves, and reorders atomically", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const catalog = await seedCatalog(t);
    const typeId = await insertType(t, {
      targetType: "MOVIE",
      maxItems: 3,
    });
    const listId = await insertList(t, {
      userId: memberId,
      typeId,
    });

    await expectDomainError(
      t.withIdentity(OTHER_IDENTITY).mutation(
        api.rankings.items.upsert,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListId: listId,
          target: { kind: "movie", id: catalogMovieId(catalog, 0) },
          rank: 1,
        },
      ),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.upsert,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListId: listId,
          target: { kind: "show", id: catalog.showId },
          rank: 1,
        },
      ),
      "VALIDATION_FAILED",
    );
    const deletedMovieId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("movies", {
        title: "Deleted movie",
        normalizedTitle: "deleted movie",
        year: 2000,
        url: "https://movies.example.test/deleted",
      });
      await ctx.db.delete("movies", id);
      return id;
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.upsert,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListId: listId,
          target: { kind: "movie", id: deletedMovieId },
          rank: 1,
        },
      ),
      "NOT_FOUND",
    );

    const first = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: listId,
        target: { kind: "movie", id: catalogMovieId(catalog, 0) },
        rank: 1,
        comment: " First private comment ",
        now: 100,
      },
    );
    const second = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: listId,
        target: { kind: "movie", id: catalogMovieId(catalog, 1) },
        rank: 2,
        now: 101,
      },
    );
    expect(first).toMatchObject({
      movieId: catalogMovieId(catalog, 0),
      rank: 1,
      comment: "First private comment",
    });
    expect(second.rank).toBe(2);

    const moved = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: listId,
        target: { kind: "movie", id: catalogMovieId(catalog, 0) },
        rank: 2,
        comment: "Moved",
        now: 102,
      },
    );
    expect(moved).toMatchObject({ id: first.id, rank: 2 });
    const afterSwap = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.rankings.lists.get, { id: listId });
    expect(
      afterSwap.items.map((item) => [item.id, item.rank]),
    ).toEqual([
      [second.id, 1],
      [first.id, 2],
    ]);

    const replaced = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: listId,
        target: { kind: "movie", id: catalogMovieId(catalog, 2) },
        rank: 2,
        comment: "Replacement",
        now: 103,
      },
    );
    expect(replaced).toMatchObject({
      id: first.id,
      movieId: catalogMovieId(catalog, 2),
      rank: 2,
    });
    const cleared = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: listId,
        target: { kind: "movie", id: catalogMovieId(catalog, 2) },
        rank: 2,
        comment: " ",
        now: 104,
      },
    );
    expect(cleared.comment).toBeNull();

    const third = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: listId,
        target: { kind: "movie", id: catalogMovieId(catalog, 3) },
        rank: 3,
        now: 105,
      },
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: typeId,
          maxItems: 2,
        },
      ),
      "CONFLICT",
    );

    const movedUp = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.move,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: third.id,
        newRank: 1,
        now: 106,
      },
    );
    expect(movedUp.rank).toBe(1);
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.move,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: third.id,
          newRank: 1,
        },
      ),
    ).resolves.toMatchObject({ rank: 1 });
    const movedDown = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.rankings.items.move,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: third.id,
        newRank: 3,
      },
    );
    expect(movedDown.rank).toBe(3);

    for (const itemIds of [
      [first.id, second.id],
      [first.id, first.id, third.id],
    ]) {
      await expectDomainError(
        t.withIdentity(MEMBER_IDENTITY).mutation(
          api.rankings.items.reorder,
          {
            clientApiVersion: BBPC_API_VERSION,
            rankedListId: listId,
            itemIds,
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    const otherListId = await insertList(t, {
      userId: memberId,
      typeId,
    });
    const foreignItemId = await insertMovieItem(t, {
      listId: otherListId,
      movieId: catalogMovieId(catalog, 4),
      rank: 1,
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.reorder,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListId: listId,
          itemIds: [first.id, second.id, foreignItemId],
        },
      ),
      "VALIDATION_FAILED",
    );

    const reordered = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.reorder,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: listId,
        itemIds: [third.id, first.id, second.id],
        now: 108,
      },
    );
    expect(reordered.items.map((item) => item.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: first.id,
        },
      ),
    ).resolves.toEqual({ id: first.id, rank: 2 });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.reorder,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListId: otherListId,
          itemIds: [foreignItemId],
        },
      ),
    ).resolves.toMatchObject({ itemCount: 1 });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.lists.removeAccessible,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: otherListId,
        },
      ),
    ).resolves.toEqual({ id: otherListId, deletedItems: 1 });

    const emptyListId = await insertList(t, {
      userId: memberId,
      typeId,
    });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.reorder,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListId: emptyListId,
          itemIds: [],
        },
      ),
    ).resolves.toMatchObject({ items: [] });

    const audits = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditEvents")
        .withIndex("by_cutoverRunId_and_createdAt", (index) =>
          index.eq("cutoverRunId", CUTOVER_RUN_ID),
        )
        .collect();
    });
    expect(JSON.stringify(audits)).not.toContain(
      "First private comment",
    );
  });

  test("hydrates movie, show, and episode targets and fails closed on corrupt items", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const catalog = await seedCatalog(t);
    const movieTypeId = await insertType(t, {
      targetType: "MOVIE",
      maxItems: 3,
    });
    const showTypeId = await insertType(t, {
      targetType: "SHOW",
      maxItems: 3,
    });
    const episodeTypeId = await insertType(t, {
      targetType: "EPISODE",
      maxItems: 3,
    });
    const movieListId = await insertList(t, {
      userId: memberId,
      typeId: movieTypeId,
    });
    const showListId = await insertList(t, {
      userId: memberId,
      typeId: showTypeId,
    });
    const episodeListId = await insertList(t, {
      userId: memberId,
      typeId: episodeTypeId,
    });

    const movieItem = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: movieListId,
        target: { kind: "movie", id: catalogMovieId(catalog, 0) },
        rank: 1,
      },
    );
    const showItem = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: showListId,
        target: { kind: "show", id: catalog.showId },
        rank: 1,
      },
    );
    const episodeItem = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.rankings.items.upsert,
      {
        clientApiVersion: BBPC_API_VERSION,
        rankedListId: episodeListId,
        target: { kind: "episode", id: catalog.episodeId },
        rank: 1,
      },
    );
    expect(movieItem.movie?.title).toBe("Movie 1");
    expect(showItem.show?.title).toBe("Ranking show");
    expect(episodeItem.episode).toMatchObject({
      number: 42,
      date: "2026-07-24",
    });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.upsert,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListId: showListId,
          target: { kind: "show", id: catalog.showId },
          rank: 1,
          comment: "Show note",
        },
      ),
    ).resolves.toMatchObject({ showId: catalog.showId });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.upsert,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListId: episodeListId,
          target: { kind: "episode", id: catalog.episodeId },
          rank: 1,
          comment: "Episode note",
        },
      ),
    ).resolves.toMatchObject({ episodeId: catalog.episodeId });

    const duplicateRankId = await insertMovieItem(t, {
      listId: movieListId,
      movieId: catalogMovieId(catalog, 1),
      rank: 1,
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.get,
        { id: movieListId },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("rankedItems", duplicateRankId);
    });
    const duplicateTargetId = await insertMovieItem(t, {
      listId: movieListId,
      movieId: catalogMovieId(catalog, 0),
      rank: 2,
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.get,
        { id: movieListId },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("rankedItems", duplicateTargetId);
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("rankedItems", movieItem.id, { rank: 4 });
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.get,
        { id: movieListId },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("rankedItems", movieItem.id, {
        rank: 1,
        targetType: "show",
        movieId: undefined,
        showId: catalog.showId,
      });
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.get,
        { id: movieListId },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("rankedItems", movieItem.id, {
        targetType: "movie",
        movieId: catalogMovieId(catalog, 0),
        showId: undefined,
      });
      await ctx.db.delete("movies", catalogMovieId(catalog, 0));
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.get,
        { id: movieListId },
      ),
      "CONFLICT",
    );
  });

  test("provides filtered administrator pagination", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    await advanceToS3(t);
    const movieTypeId = await insertType(t, {
      targetType: "MOVIE",
      createdAt: 1,
    });
    const showTypeId = await insertType(t, {
      targetType: "SHOW",
      createdAt: 2,
    });
    const firstId = await insertList(t, {
      userId: memberId,
      typeId: movieTypeId,
      updatedAt: 10,
    });
    const secondId = await insertList(t, {
      userId: otherId,
      typeId: movieTypeId,
      updatedAt: 20,
    });
    const thirdId = await insertList(t, {
      userId: memberId,
      typeId: showTypeId,
      updatedAt: 30,
    });
    const paginationOpts = { cursor: null, numItems: 10 };

    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.listAdminPage,
        { paginationOpts },
      ),
      "FORBIDDEN",
    );
    const all = await t.withIdentity(ADMIN_IDENTITY).query(
      api.rankings.lists.listAdminPage,
      { paginationOpts },
    );
    expect(all.page.map((list) => list.id)).toEqual([
      thirdId,
      secondId,
      firstId,
    ]);
    const byUser = await t.withIdentity(ADMIN_IDENTITY).query(
      api.rankings.lists.listAdminPage,
      { userId: memberId, paginationOpts },
    );
    expect(byUser.page.map((list) => list.id)).toEqual([
      thirdId,
      firstId,
    ]);
    const byType = await t.withIdentity(ADMIN_IDENTITY).query(
      api.rankings.lists.listAdminPage,
      { rankedListTypeId: movieTypeId, paginationOpts },
    );
    expect(byType.page.map((list) => list.id)).toEqual([
      secondId,
      firstId,
    ]);
    const exact = await t.withIdentity(ADMIN_IDENTITY).query(
      api.rankings.lists.listAdminPage,
      {
        userId: memberId,
        rankedListTypeId: movieTypeId,
        paginationOpts: { cursor: null, numItems: 1 },
      },
    );
    expect(exact.page.map((list) => list.id)).toEqual([firstId]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.rankings.lists.listAdminPage,
        { paginationOpts: { cursor: null, numItems: 51 } },
      ),
      "VALIDATION_FAILED",
    );

    const missing = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const typeId = await ctx.db.insert("rankedListTypes", {
        name: "Deleted",
        maxItems: 1,
        targetType: "MOVIE",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.delete("users", userId);
      await ctx.db.delete("rankedListTypes", typeId);
      return { typeId, userId };
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.rankings.lists.listAdminPage,
        {
          userId: missing.userId,
          paginationOpts,
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.rankings.lists.listAdminPage,
        {
          rankedListTypeId: missing.typeId,
          paginationOpts,
        },
      ),
      "NOT_FOUND",
    );
  });

  test("enforces type, owner, and item collection limits", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const catalog = await seedCatalog(t);
    const typeId = await insertType(t, {
      targetType: "MOVIE",
      maxItems: 100,
    });
    await t.run(async (ctx) => {
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("rankedLists", {
          userId: memberId,
          rankedListTypeId: typeId,
          status: "DRAFT",
          createdAt: index,
          updatedAt: index,
        });
      }
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.lists.createMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          rankedListTypeId: typeId,
          status: "DRAFT",
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("rankedLists", {
        userId: memberId,
        rankedListTypeId: typeId,
        status: "DRAFT",
        createdAt: 101,
        updatedAt: 101,
      });
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.lists.listMine,
        {},
      ),
      "CONFLICT",
    );

    await t.run(async (ctx) => {
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("rankedListTypes", {
          name: `Capacity ${String(index)}`,
          maxItems: 1,
          targetType: "MOVIE",
          createdAt: 1000 + index,
          updatedAt: 1000 + index,
        });
      }
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Over capacity",
          maxItems: 1,
          targetType: "MOVIE",
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.rankings.types.list,
        {},
      ),
      "CONFLICT",
    );

    const isolatedTypeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("rankedListTypes", {
        name: "Invalid bounds",
        maxItems: 0,
        targetType: "MOVIE",
        createdAt: 5000,
        updatedAt: 5000,
      });
      return id;
    });
    const invalidListId = await insertList(t, {
      userId: memberId,
      typeId: isolatedTypeId,
      updatedAt: 5001,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.rankings.lists.get,
        { id: invalidListId },
      ),
      "CONFLICT",
    );

    const itemTypeId = await insertType(t, {
      targetType: "MOVIE",
      maxItems: 100,
      createdAt: 6000,
    });
    const itemListId = await insertList(t, {
      userId: memberId,
      typeId: itemTypeId,
      updatedAt: 6000,
    });
    await t.run(async (ctx) => {
      for (let index = 1; index <= 101; index += 1) {
        const movieId =
          index === 1
            ? catalogMovieId(catalog, 0)
            : await ctx.db.insert("movies", {
                title: `Capacity movie ${String(index)}`,
                normalizedTitle: `capacity movie ${String(index)}`,
                year: 2000,
                url: `https://movies.example.test/capacity/${String(index)}`,
              });
        await ctx.db.insert("rankedItems", {
          rankedListId: itemListId,
          targetType: "movie",
          movieId,
          rank: index,
          createdAt: index,
          updatedAt: index,
        });
      }
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.rankings.lists.get,
        { id: itemListId },
      ),
      "CONFLICT",
    );
  });

  test("fails closed on missing lists, items, owners, and types", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const catalog = await seedCatalog(t);
    const typeId = await insertType(t, { targetType: "MOVIE" });
    const listId = await insertList(t, {
      userId: memberId,
      typeId,
    });
    const itemId = await insertMovieItem(t, {
      listId,
      movieId: catalogMovieId(catalog, 0),
      rank: 1,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("rankedItems", itemId);
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.rankings.items.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: itemId,
        },
      ),
      "NOT_FOUND",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("rankedLists", listId);
    });
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.rankings.lists.get, { id: listId }),
      "NOT_FOUND",
    );
    const ownerlessListId = await insertList(t, {
      userId: memberId,
      typeId,
      updatedAt: 10,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.rankings.types.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: typeId,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("users", memberId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.rankings.lists.get,
        { id: ownerlessListId },
      ),
      "CONFLICT",
    );

    const typedListId = await insertList(t, {
      userId: (await t.run(async (ctx) => {
        return await ctx.db.insert("users", {
          status: "active",
          createdAt: 1,
          updatedAt: 1,
        });
      })),
      typeId,
      updatedAt: 20,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("rankedListTypes", typeId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.rankings.lists.get,
        { id: typedListId },
      ),
      "CONFLICT",
    );
  });
});
