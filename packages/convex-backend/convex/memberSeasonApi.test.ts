/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const TODAY = "2026-09-25";
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|season-member",
  issuer: "https://issuer.example.test",
  subject: "season-member",
};
const RIVAL_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|season-rival",
  issuer: "https://issuer.example.test",
  subject: "season-rival",
};
const NEWCOMER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|season-newcomer",
  issuer: "https://issuer.example.test",
  subject: "season-newcomer",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;
type TestIdentity = typeof MEMBER_IDENTITY;

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
  name: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name,
      email: `${identity.subject}@example.test`,
      normalizedEmail: `${identity.subject}@example.test`,
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
    return userId;
  });
}

/**
 * Two seasons for one game. The member scored in both; a rival leads the
 * current season. Current-season points cover every way a point can reach
 * an episode: an assignment link, a wager award, a quote, and none.
 */
async function seedSeasons(t: TestBackend) {
  const memberId = await seedUser(t, MEMBER_IDENTITY, "Season Member");
  const rivalId = await seedUser(t, RIVAL_IDENTITY, "Season Rival");
  const newcomerId = await seedUser(t, NEWCOMER_IDENTITY, "Newcomer");
  const ids = await t.run(async (ctx) => {
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title: "Predictions",
      lookupId: "WTFIR",
      normalizedLookupId: "wtfir",
    });
    const guessPointTypeId = await ctx.db.insert("gamePointTypes", {
      title: "Correct host",
      lookupId: "guess",
      normalizedLookupId: "guess",
      points: 10,
      gameTypeId,
    });
    const currentSeasonId = await ctx.db.insert("seasons", {
      title: "Season 12",
      gameTypeId,
      startedOn: "2026-08-04",
      episodeCount: 10,
    });
    const pastSeasonId = await ctx.db.insert("seasons", {
      title: "Season 11",
      gameTypeId,
      startedOn: "2026-06-02",
      endedOn: "2026-07-28",
      episodeCount: 8,
    });
    const latestEpisodeId = await ctx.db.insert("episodes", {
      number: 418,
      title: "Episode 418",
      date: "2026-09-22",
      status: "published",
      slug: "episode-418",
      normalizedSlug: "episode-418",
    });
    const earlierEpisodeId = await ctx.db.insert("episodes", {
      number: 417,
      title: "Episode 417",
      date: "2026-09-15",
      status: "published",
      slug: "episode-417",
      normalizedSlug: "episode-417",
    });
    const movieId = await ctx.db.insert("movies", {
      title: "Heat",
      normalizedTitle: "heat",
      year: 1995,
      url: "https://catalog.example.test/heat",
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId: rivalId,
      movieId,
      episodeId: latestEpisodeId,
      type: "HOMEWORK",
      playable: true,
      slug: "heat-418",
      normalizedSlug: "heat-418",
    });
    const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
      lookupId: "double",
      normalizedLookupId: "double",
      title: "Double Down",
      multiplier: 2,
      isActive: true,
      createdAt: 1,
    });

    const manualPointId = await ctx.db.insert("points", {
      userId: memberId,
      seasonId: currentSeasonId,
      reason: "Voicemail bonus",
      earnedAt: 1,
      adjustment: -1,
    });
    const quotePointId = await ctx.db.insert("points", {
      userId: memberId,
      seasonId: currentSeasonId,
      reason: "Quotabunga - Episode 417 - Second place",
      earnedAt: 2,
      adjustment: 5,
    });
    await ctx.db.insert("quoteSubmissions", {
      userId: memberId,
      episodeId: earlierEpisodeId,
      seasonId: currentSeasonId,
      quoteText: "I'm never going back.",
      sourceTitle: "Heat",
      sourceType: "MOVIE",
      status: "INCLUDED",
      placement: 2,
      pointId: quotePointId,
      createdAt: 2,
      updatedAt: 2,
    });
    const guessPointId = await ctx.db.insert("points", {
      userId: memberId,
      seasonId: currentSeasonId,
      reason: "Correct prediction",
      earnedAt: 3,
      adjustment: null,
      gamePointTypeId: guessPointTypeId,
    });
    await ctx.db.insert("assignmentPointLinks", {
      assignmentId,
      userId: memberId,
      pointId: guessPointId,
    });
    const wagerPointId = await ctx.db.insert("points", {
      userId: memberId,
      seasonId: currentSeasonId,
      reason: "Gamble win: Double Down",
      earnedAt: 4,
      adjustment: 10,
    });
    await ctx.db.insert("gamblingEntries", {
      userId: memberId,
      assignmentId,
      seasonId: currentSeasonId,
      gamblingTypeId,
      points: 5,
      status: "won",
      awardPointId: wagerPointId,
      createdAt: 5,
    });
    await ctx.db.insert("gamblingEntries", {
      userId: memberId,
      assignmentId,
      seasonId: currentSeasonId,
      gamblingTypeId,
      points: 4,
      status: "pending",
      createdAt: 6,
    });
    await ctx.db.insert("gamblingEntries", {
      userId: memberId,
      seasonId: pastSeasonId,
      gamblingTypeId,
      points: 3,
      status: "lost",
      createdAt: 1,
    });
    await ctx.db.insert("points", {
      userId: memberId,
      seasonId: pastSeasonId,
      reason: "Final tally",
      earnedAt: 1,
      adjustment: 7,
    });
    await ctx.db.insert("points", {
      userId: rivalId,
      seasonId: currentSeasonId,
      reason: "Big week",
      earnedAt: 2,
      adjustment: 25,
    });
    return {
      currentSeasonId,
      pastSeasonId,
      assignmentId,
      manualPointId,
      quotePointId,
      guessPointId,
      wagerPointId,
    };
  });
  return { memberId, rivalId, newcomerId, ...ids };
}

describe("member season API", () => {
  test("lists the member's seasons with current-season standing", async () => {
    const t = createTestBackend();
    const seeded = await seedSeasons(t);

    const seasons = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.member.mySeasons, { today: TODAY });
    expect(seasons).toHaveLength(2);
    expect(seasons[0]).toMatchObject({
      season: { id: seeded.currentSeasonId, title: "Season 12" },
      isCurrent: true,
      total: 24,
      pointCount: 4,
      available: 20,
      recordedEpisodeCount: 2,
      standing: { rank: 2, playerCount: 2 },
    });
    expect(seasons[1]).toMatchObject({
      season: { id: seeded.pastSeasonId, title: "Season 11" },
      isCurrent: false,
      total: 7,
      pointCount: 1,
      available: null,
      recordedEpisodeCount: null,
      standing: null,
    });

    const rivalSeasons = await t
      .withIdentity(RIVAL_IDENTITY)
      .query(api.games.member.mySeasons, { today: TODAY });
    expect(rivalSeasons).toHaveLength(1);
    expect(rivalSeasons[0]).toMatchObject({
      total: 25,
      standing: { rank: 1, playerCount: 2 },
    });

    const newcomerSeasons = await t
      .withIdentity(NEWCOMER_IDENTITY)
      .query(api.games.member.mySeasons, { today: TODAY });
    expect(newcomerSeasons).toHaveLength(1);
    expect(newcomerSeasons[0]).toMatchObject({
      isCurrent: true,
      total: 0,
      pointCount: 0,
      available: 0,
      standing: null,
    });

    await expectDomainError(
      t.query(api.games.member.mySeasons, { today: TODAY }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.member.mySeasons, { today: "2026-13-01" }),
      "VALIDATION_FAILED",
    );
  });

  test("summarizes one season for the member alongside every player", async () => {
    const t = createTestBackend();
    const seeded = await seedSeasons(t);
    const member = t.withIdentity(MEMBER_IDENTITY);

    const current = await member.query(api.games.member.mySeasonOverview, {
      seasonId: seeded.currentSeasonId,
      today: TODAY,
    });
    expect(current).toMatchObject({
      season: { title: "Season 12" },
      isCurrent: true,
      total: 24,
      pointCount: 4,
      available: 20,
      recordedEpisodeCount: 2,
      standing: { rank: 2, playerCount: 2 },
    });
    expect(current.userSummary.map((entry) => entry.user.id)).toEqual([
      seeded.rivalId,
      seeded.memberId,
    ]);
    expect(current.points.map((point) => point.earnedAt)).toEqual([
      1, 2, 2, 3, 4,
    ]);

    const past = await member.query(api.games.member.mySeasonOverview, {
      seasonId: seeded.pastSeasonId,
      today: TODAY,
    });
    expect(past).toMatchObject({
      isCurrent: false,
      total: 7,
      pointCount: 1,
      available: 7,
      standing: { rank: 1, playerCount: 1 },
    });
    expect(past.userSummary).toHaveLength(1);

    const removedSeasonId = await t.run(async (ctx) => {
      const gameType = await ctx.db.query("gameTypes").first();
      if (gameType === null) {
        throw new Error("Expected a game type");
      }
      const id = await ctx.db.insert("seasons", {
        title: "Removed",
        gameTypeId: gameType._id,
      });
      await ctx.db.delete("seasons", id);
      return id;
    });
    await expectDomainError(
      member.query(api.games.member.mySeasonOverview, {
        seasonId: removedSeasonId,
        today: TODAY,
      }),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.query(api.games.member.mySeasonOverview, {
        seasonId: seeded.currentSeasonId,
        today: TODAY,
      }),
      "AUTHENTICATION_REQUIRED",
    );
  });

  test("pages the member's season points with their episode and assignment", async () => {
    const t = createTestBackend();
    const seeded = await seedSeasons(t);
    const member = t.withIdentity(MEMBER_IDENTITY);

    const firstPage = await member.query(api.games.member.mySeasonPointsPage, {
      seasonId: seeded.currentSeasonId,
      paginationOpts: { numItems: 3, cursor: null },
    });
    expect(firstPage.isDone).toBe(false);
    expect(firstPage.page.map((point) => point.id)).toEqual([
      seeded.wagerPointId,
      seeded.guessPointId,
      seeded.quotePointId,
    ]);
    expect(firstPage.page[0]).toMatchObject({
      total: 10,
      episode: { number: 418, slug: "episode-418" },
      assignment: {
        id: seeded.assignmentId,
        movie: { title: "Heat", year: 1995 },
      },
    });
    expect(firstPage.page[1]).toMatchObject({
      total: 10,
      gamePointType: { lookupId: "guess" },
      episode: { number: 418, slug: "episode-418" },
      assignment: { id: seeded.assignmentId },
    });
    expect(firstPage.page[2]).toMatchObject({
      total: 5,
      episode: { number: 417, slug: "episode-417" },
      assignment: null,
    });

    const secondPage = await member.query(api.games.member.mySeasonPointsPage, {
      seasonId: seeded.currentSeasonId,
      paginationOpts: { numItems: 3, cursor: firstPage.continueCursor },
    });
    expect(secondPage.isDone).toBe(true);
    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.page[0]).toMatchObject({
      id: seeded.manualPointId,
      total: -1,
      episode: null,
      assignment: null,
    });

    const pastPage = await member.query(api.games.member.mySeasonPointsPage, {
      seasonId: seeded.pastSeasonId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(pastPage.page.map((point) => point.total)).toEqual([7]);

    await expectDomainError(
      member.query(api.games.member.mySeasonPointsPage, {
        seasonId: seeded.currentSeasonId,
        paginationOpts: { numItems: 101, cursor: null },
      }),
      "VALIDATION_FAILED",
    );
  });

  test("lists the member's season wagers newest first", async () => {
    const t = createTestBackend();
    const seeded = await seedSeasons(t);
    const member = t.withIdentity(MEMBER_IDENTITY);

    const current = await member.query(api.games.member.mySeasonWagers, {
      seasonId: seeded.currentSeasonId,
    });
    expect(current.map((entry) => entry.status)).toEqual(["pending", "won"]);
    expect(current[1]).toMatchObject({
      points: 5,
      gamblingType: { title: "Double Down", multiplier: 2 },
      assignment: { episode: { number: 418 } },
      awardPoint: { total: 10 },
    });

    const past = await member.query(api.games.member.mySeasonWagers, {
      seasonId: seeded.pastSeasonId,
    });
    expect(past.map((entry) => entry.status)).toEqual(["lost"]);

    await expect(
      t
        .withIdentity(RIVAL_IDENTITY)
        .query(api.games.member.mySeasonWagers, {
          seasonId: seeded.currentSeasonId,
        }),
    ).resolves.toEqual([]);
  });
});
