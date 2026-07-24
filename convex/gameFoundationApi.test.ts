/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "game-foundation-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|game-admin",
  issuer: "https://issuer.example.test",
  subject: "game-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|game-member",
  issuer: "https://issuer.example.test",
  subject: "game-member",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;
type TestIdentity = typeof ADMIN_IDENTITY;

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
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: `${input.identity.subject}@example.test`,
      normalizedEmail: `${input.identity.subject}@example.test`,
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
    name: "Game Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Game Member",
  });
  return { adminId, memberId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "game-foundation-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "game-foundation-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "game-foundation-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "game-foundation-test",
    approvedBackupId: "game-foundation-backup",
    approvedBackupChecksum: "sha256:game-foundation",
  });
}

async function createGameType(
  t: TestBackend,
  input: {
    title: string;
    lookupId: string;
    description?: string;
  },
) {
  return await t.withIdentity(ADMIN_IDENTITY).mutation(
    api.games.config.createGameType,
    {
      clientApiVersion: BBPC_API_VERSION,
      ...input,
    },
  );
}

async function createSeason(
  t: TestBackend,
  input: {
    gameTypeId: Id<"gameTypes">;
    title: string;
    startedOn: string;
    endedOn?: string | null;
  },
) {
  return await t.withIdentity(ADMIN_IDENTITY).mutation(
    api.games.seasons.create,
    {
      clientApiVersion: BBPC_API_VERSION,
      ...input,
    },
  );
}

describe("game foundation API", () => {
  test("keeps current-season reads public and gates administrator configuration", async () => {
    const t = createTestBackend();
    await seedActors(t);

    await expect(
      t.query(api.games.public.currentSeason, {
        today: "2026-07-24",
      }),
    ).resolves.toBeNull();
    await expectDomainError(
      t.query(api.games.config.listGameTypes, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.config.listGameTypes, {}),
      "FORBIDDEN",
    );

    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.createGameType,
        {
          clientApiVersion: BBPC_API_VERSION,
          title: "Predictions",
          lookupId: "predictions",
        },
      ),
      "WRITE_DISABLED",
    );
  });

  test("manages normalized game and point-type configuration safely", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);

    const gameType = await createGameType(t, {
      title: "  Predictions ",
      description: " Weekly game ",
      lookupId: " WTFIR ",
    });
    expect(gameType).toMatchObject({
      title: "Predictions",
      description: "Weekly game",
      lookupId: "WTFIR",
    });
    await expectDomainError(
      createGameType(t, {
        title: "Duplicate",
        lookupId: "wtfir",
      }),
      "CONFLICT",
    );
    const updatedGameType =
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.updateGameType,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: gameType.id,
          title: " Weekly Predictions ",
          description: null,
          lookupId: " WTFIR ",
        },
      );
    expect(updatedGameType).toMatchObject({
      title: "Weekly Predictions",
      description: null,
      lookupId: "WTFIR",
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.updateGameType,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: gameType.id,
        },
      ),
    ).resolves.toEqual(updatedGameType);
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.config.listGameTypes, {}),
    ).resolves.toEqual([updatedGameType]);

    const pointType =
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.createGamePointType,
        {
          clientApiVersion: BBPC_API_VERSION,
          gameTypeId: gameType.id,
          title: " Correct host ",
          description: " Award ",
          lookupId: " Guess ",
          points: 10,
        },
      );
    expect(pointType).toMatchObject({
      title: "Correct host",
      description: "Award",
      lookupId: "Guess",
      points: 10,
      gameType: { id: gameType.id },
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.config.listGamePointTypes,
        { gameTypeId: gameType.id },
      ),
    ).resolves.toHaveLength(1);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.createGamePointType,
        {
          clientApiVersion: BBPC_API_VERSION,
          gameTypeId: gameType.id,
          title: "Invalid",
          lookupId: "invalid",
          points: 32_768,
        },
      ),
      "VALIDATION_FAILED",
    );

    const updated =
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.updateGamePointType,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pointType.id,
          gameTypeId: gameType.id,
          title: "Host guess",
          description: null,
          lookupId: "host-guess",
          points: -2,
        },
      );
    expect(updated).toMatchObject({
      title: "Host guess",
      description: null,
      lookupId: "host-guess",
      points: -2,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.updateGamePointType,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pointType.id,
        },
      ),
    ).resolves.toEqual(updated);
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.config.listGamePointTypes,
        {},
      ),
    ).resolves.toEqual([updated]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.removeGameType,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: gameType.id,
        },
      ),
      "CONFLICT",
      { relationship: "game point type" },
    );

    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.config.removeGamePointType,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: pointType.id,
      },
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.removeGameType,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: gameType.id,
        },
      ),
    ).resolves.toEqual({ id: gameType.id });
  });

  test("prevents deleting a point type that is used by a point", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const gameType = await createGameType(t, {
      title: "Awards",
      lookupId: "awards",
    });
    const pointType =
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.createGamePointType,
        {
          clientApiVersion: BBPC_API_VERSION,
          gameTypeId: gameType.id,
          title: "Award",
          lookupId: "award",
          points: 5,
        },
      );
    const season = await createSeason(t, {
      gameTypeId: gameType.id,
      title: "Season",
      startedOn: "2026-01-01",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("points", {
        userId: memberId,
        seasonId: season.id,
        earnedAt: 1,
        adjustment: null,
        gamePointTypeId: pointType.id,
      });
    });

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.removeGamePointType,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pointType.id,
        },
      ),
      "CONFLICT",
      { relationship: "point" },
    );
  });

  test("selects the newest active season from an explicit date", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);
    const gameType = await createGameType(t, {
      title: "Predictions",
      lookupId: "predictions",
    });
    await createSeason(t, {
      gameTypeId: gameType.id,
      title: "Old active",
      startedOn: "2026-01-01",
      endedOn: "2026-12-31",
    });
    const newest = await createSeason(t, {
      gameTypeId: gameType.id,
      title: "Newest active",
      startedOn: "2026-07-01",
      endedOn: "2026-08-01",
    });
    await createSeason(t, {
      gameTypeId: gameType.id,
      title: "Already ended",
      startedOn: "2026-07-20",
      endedOn: "2026-07-22",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("seasons", {
        title: "Legacy undated",
        gameTypeId: gameType.id,
      });
    });

    await expect(
      t.query(api.games.public.currentSeason, {
        today: "2026-07-24",
      }),
    ).resolves.toMatchObject({
      id: newest.id,
      title: "Newest active",
    });
    await expect(
      t.query(api.games.public.hasActiveSeason, {
        today: "2027-01-01",
      }),
    ).resolves.toBe(false);
    await expectDomainError(
      t.query(api.games.public.currentSeason, {
        today: "2026-02-30",
      }),
      "VALIDATION_FAILED",
    );
  });

  test("creates, paginates, updates, counts, and safely removes seasons", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const gameType = await createGameType(t, {
      title: "League",
      lookupId: "league",
    });
    await expectDomainError(
      createSeason(t, {
        gameTypeId: gameType.id,
        title: "Invalid range",
        startedOn: "2026-02-02",
        endedOn: "2026-02-01",
      }),
      "VALIDATION_FAILED",
    );
    const season = await createSeason(t, {
      gameTypeId: gameType.id,
      title: "Season One",
      startedOn: "2026-01-01",
      endedOn: "2026-12-31",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("points", {
        userId: memberId,
        seasonId: season.id,
        reason: "Manual award",
        earnedAt: 1,
        adjustment: 3,
      });
    });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.seasons.getById,
        { id: season.id },
      ),
    ).resolves.toMatchObject({
      id: season.id,
      counts: {
        points: { count: 1, isExact: true },
        guesses: { count: 0, isExact: true },
        gamblingEntries: { count: 0, isExact: true },
        quoteSubmissions: { count: 0, isExact: true },
      },
    });
    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.seasons.listPage,
      {
        paginationOpts: {
          numItems: 10,
          cursor: null,
        },
      },
    );
    expect(page.page).toHaveLength(1);
    expect(page.isDone).toBe(true);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.seasons.listPage,
        {
          paginationOpts: {
            numItems: 51,
            cursor: null,
          },
        },
      ),
      "VALIDATION_FAILED",
    );

    const replacementGameType = await createGameType(t, {
      title: "Replacement league",
      lookupId: "replacement-league",
    });
    const updated =
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.seasons.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: season.id,
          title: " Season 1 ",
          description: " Updated season ",
          gameTypeId: replacementGameType.id,
          startedOn: "2026-02-01",
          endedOn: "2026-11-30",
        },
      );
    expect(updated).toMatchObject({
      title: "Season 1",
      description: "Updated season",
      startedOn: "2026-02-01",
      endedOn: "2026-11-30",
      gameType: { id: replacementGameType.id },
    });
    const cleared =
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.seasons.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: season.id,
          description: null,
          endedOn: null,
        },
      );
    expect(cleared).toMatchObject({
      description: null,
      endedOn: null,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.seasons.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: season.id,
        },
      ),
    ).resolves.toEqual(cleared);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.seasons.removeIfUnreferenced,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: season.id,
        },
      ),
      "CONFLICT",
      { relationship: "point" },
    );

    const removable = await createSeason(t, {
      gameTypeId: gameType.id,
      title: "Temporary",
      startedOn: "2027-01-01",
      endedOn: null,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.seasons.removeIfUnreferenced,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: removable.id,
        },
      ),
    ).resolves.toEqual({ id: removable.id });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.seasons.getById,
        { id: removable.id },
      ),
    ).resolves.toBeNull();
  });

  test("returns public prediction scoring for the WTFIR configuration", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);

    await expect(
      t.query(api.games.public.predictionScoring, {}),
    ).resolves.toEqual({
      correctHost: null,
      allCorrectBonus: null,
      allIncorrect: null,
    });

    const gameType = await createGameType(t, {
      title: "Who The Freak Is Reviewing",
      lookupId: "WTFIR",
    });
    for (const [title, lookupId, points] of [
      ["Correct host", "guess", 3],
      ["All correct", "allcorrect", 5],
      ["All incorrect", "all-incorrect", -2],
    ] as const) {
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.config.createGamePointType,
        {
          clientApiVersion: BBPC_API_VERSION,
          gameTypeId: gameType.id,
          title,
          lookupId,
          points,
        },
      );
    }

    await expect(
      t.query(api.games.public.predictionScoring, {}),
    ).resolves.toEqual({
      correctHost: 3,
      allCorrectBonus: 5,
      allIncorrect: -2,
    });
  });
});
