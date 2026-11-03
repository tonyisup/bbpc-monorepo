/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const TODAY = "2026-07-24";

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

async function seedSeasons(t: TestBackend) {
  return await t.run(async (ctx) => {
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title: "WTFIR",
      lookupId: "wtfir",
      normalizedLookupId: "wtfir",
    });
    const currentSeasonId = await ctx.db.insert("seasons", {
      title: "Season 3",
      gameTypeId,
      startedOn: "2026-07-01",
    });
    const pastSeasonId = await ctx.db.insert("seasons", {
      title: "Season 2",
      gameTypeId,
      startedOn: "2026-01-01",
      endedOn: "2026-06-30",
      episodeCount: 3,
    });
    const quietSeasonId = await ctx.db.insert("seasons", {
      title: "Season 1",
      gameTypeId,
      startedOn: "2025-07-01",
      endedOn: "2025-12-31",
    });
    return { currentSeasonId, pastSeasonId, quietSeasonId };
  });
}

async function seedUser(t: TestBackend, name: string): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name,
      email: "player@example.test",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function insertPoint(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    seasonId: Id<"seasons">;
    earnedAt: number;
    adjustment: number;
  },
): Promise<Id<"points">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("points", input);
  });
}

describe("public season standings", () => {
  test("lists seasons with points plus the current season, newest first", async () => {
    const t = createTestBackend();
    const { currentSeasonId, pastSeasonId } = await seedSeasons(t);
    const userId = await seedUser(t, "Player");
    await insertPoint(t, {
      userId,
      seasonId: pastSeasonId,
      earnedAt: Date.UTC(2026, 1, 1),
      adjustment: 2,
    });

    expect(
      await t.query(api.games.public.standingsSeasons, { today: TODAY }),
    ).toEqual([
      {
        id: currentSeasonId,
        title: "Season 3",
        startedOn: "2026-07-01",
        endedOn: null,
        isCurrent: true,
      },
      {
        id: pastSeasonId,
        title: "Season 2",
        startedOn: "2026-01-01",
        endedOn: "2026-06-30",
        isCurrent: false,
      },
    ]);
  });

  test("totals a past season's points without the other seasons'", async () => {
    const t = createTestBackend();
    const { currentSeasonId, pastSeasonId } = await seedSeasons(t);
    const [leader, runnerUp] = await Promise.all([
      seedUser(t, "Leader"),
      seedUser(t, "Runner Up"),
    ]);
    await insertPoint(t, {
      userId: runnerUp,
      seasonId: pastSeasonId,
      earnedAt: Date.UTC(2026, 1, 1),
      adjustment: 3,
    });
    await insertPoint(t, {
      userId: leader,
      seasonId: pastSeasonId,
      earnedAt: Date.UTC(2026, 2, 1),
      adjustment: 5,
    });
    await insertPoint(t, {
      userId: runnerUp,
      seasonId: currentSeasonId,
      earnedAt: Date.UTC(2026, 6, 10),
      adjustment: 40,
    });
    await t.run(async (ctx) => {
      for (const [number, date] of [
        [10, "2026-02-01"],
        [11, "2026-03-01"],
        [12, "2026-07-10"],
      ] as const) {
        await ctx.db.insert("episodes", {
          title: `Episode ${String(number)}`,
          number,
          date,
          status: "published",
        });
      }
    });

    const standings = await t.query(api.games.public.seasonStandings, {
      seasonId: pastSeasonId,
      today: TODAY,
    });

    expect(standings).toMatchObject({
      season: { id: pastSeasonId, title: "Season 2", episodeCount: 3 },
      // Only the episodes inside the season's dates count.
      recordedEpisodeCount: 2,
      userSummary: [
        { user: { id: leader, name: "Leader" }, total: 5 },
        { user: { id: runnerUp, name: "Runner Up" }, total: 3 },
      ],
      points: [
        { userId: runnerUp, pointValue: 3 },
        { userId: leader, pointValue: 5 },
      ],
    });
  });

  test("matches currentPerformance for the current season", async () => {
    const t = createTestBackend();
    const { currentSeasonId } = await seedSeasons(t);
    const userId = await seedUser(t, "Player");
    await insertPoint(t, {
      userId,
      seasonId: currentSeasonId,
      earnedAt: Date.UTC(2026, 6, 10),
      adjustment: 4,
    });

    expect(
      await t.query(api.games.public.seasonStandings, {
        seasonId: currentSeasonId,
        today: TODAY,
      }),
    ).toEqual(
      await t.query(api.games.public.currentPerformance, { today: TODAY }),
    );
  });

  test("leaves out points for an episode that is not published yet", async () => {
    const t = createTestBackend();
    const { currentSeasonId } = await seedSeasons(t);
    const userId = await seedUser(t, "Player");
    await insertPoint(t, {
      userId,
      seasonId: currentSeasonId,
      earnedAt: Date.UTC(2026, 6, 10),
      adjustment: 1,
    });
    const heldPointId = await insertPoint(t, {
      userId,
      seasonId: currentSeasonId,
      earnedAt: Date.UTC(2026, 6, 20),
      adjustment: 40,
    });
    await t.run(async (ctx) => {
      const episodeId = await ctx.db.insert("episodes", {
        title: "Episode 20",
        number: 20,
        date: "2026-07-20",
        status: "recording",
      });
      await ctx.db.insert("quoteSubmissions", {
        userId,
        episodeId,
        seasonId: currentSeasonId,
        quoteText: "Held quote",
        sourceTitle: "Synthetic source",
        sourceType: "MOVIE",
        status: "INCLUDED",
        placement: 1,
        pointId: heldPointId,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const standings = await t.query(api.games.public.seasonStandings, {
      seasonId: currentSeasonId,
      today: TODAY,
    });

    expect(standings?.userSummary).toMatchObject([{ total: 1 }]);
    expect(standings?.points).toHaveLength(1);
  });

  test("returns an empty board for a season without points and null for a missing one", async () => {
    const t = createTestBackend();
    const { quietSeasonId } = await seedSeasons(t);
    const missingSeasonId = await t.run(async (ctx) => {
      const quietSeason = await ctx.db.get("seasons", quietSeasonId);
      if (quietSeason === null) {
        throw new Error("Seeded season is missing");
      }
      const seasonId = await ctx.db.insert("seasons", {
        title: "Gone",
        gameTypeId: quietSeason.gameTypeId,
      });
      await ctx.db.delete("seasons", seasonId);
      return seasonId;
    });

    expect(
      await t.query(api.games.public.seasonStandings, {
        seasonId: quietSeasonId,
        today: TODAY,
      }),
    ).toMatchObject({ userSummary: [], points: [] });
    expect(
      await t.query(api.games.public.seasonStandings, {
        seasonId: missingSeasonId,
        today: TODAY,
      }),
    ).toBeNull();
  });

  test("rejects a date that is not a real calendar day", async () => {
    const t = createTestBackend();
    const { pastSeasonId } = await seedSeasons(t);

    for (const today of ["07/24/2026", "2026-02-30", ""]) {
      for (const read of [
        () => t.query(api.games.public.standingsSeasons, { today }),
        () =>
          t.query(api.games.public.seasonStandings, {
            seasonId: pastSeasonId,
            today,
          }),
      ]) {
        await expect(read()).rejects.toSatisfy(
          (error) =>
            error instanceof ConvexError &&
            (error.data as { code?: string }).code === "VALIDATION_FAILED",
        );
      }
    }
  });
});
