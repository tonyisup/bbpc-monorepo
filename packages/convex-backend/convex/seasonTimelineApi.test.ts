/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { MAX_SEASON_TIMELINE_EPISODES } from "./games/limits.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|timeline-admin",
  issuer: "https://issuer.example.test",
  subject: "timeline-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|timeline-member",
  issuer: "https://issuer.example.test",
  subject: "timeline-member",
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

async function seedUser(
  t: TestBackend,
  identity: typeof ADMIN_IDENTITY,
  name: string,
  admin = false,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name,
      email: `${identity.subject}@example.test`,
      normalizedEmail: `${identity.subject}@example.test`,
      image: `https://images.example.test/${identity.subject}.jpg`,
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

async function seedSeasons(t: TestBackend) {
  return await t.run(async (ctx) => {
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title: "Predictions",
      lookupId: "WTFIR",
      normalizedLookupId: "wtfir",
    });
    const pointTypeId = await ctx.db.insert("gamePointTypes", {
      title: "Correct host",
      lookupId: "guess",
      normalizedLookupId: "guess",
      points: 10,
      gameTypeId,
    });
    const seasonId = await ctx.db.insert("seasons", {
      title: "Season 5",
      gameTypeId,
      startedOn: "2026-03-01",
      endedOn: "2026-12-31",
      episodeCount: 20,
    });
    const otherSeasonId = await ctx.db.insert("seasons", {
      title: "Season 4",
      gameTypeId,
      startedOn: "2025-01-01",
      endedOn: "2026-02-28",
    });
    return { pointTypeId, seasonId, otherSeasonId };
  });
}

async function seedEpisode(
  t: TestBackend,
  input: { number: number; date?: string; userId: Id<"users"> },
) {
  return await t.run(async (ctx) => {
    const episodeId = await ctx.db.insert("episodes", {
      number: input.number,
      title: `Episode ${String(input.number)}`,
      status: "published",
      slug: `episode-${String(input.number)}`,
      normalizedSlug: `episode-${String(input.number)}`,
      ...(input.date === undefined ? {} : { date: input.date }),
    });
    const movieId = await ctx.db.insert("movies", {
      title: `Movie ${String(input.number)}`,
      normalizedTitle: `movie ${String(input.number)}`,
      year: 2026,
      url: `https://catalog.example.test/${String(input.number)}`,
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId: input.userId,
      movieId,
      episodeId,
      type: "HOMEWORK",
      playable: true,
    });
    const reviewId = await ctx.db.insert("reviews", {
      userId: input.userId,
      movieId,
    });
    const assignmentReviewId = await ctx.db.insert("assignmentReviews", {
      assignmentId,
      reviewId,
    });
    return { episodeId, assignmentId, assignmentReviewId };
  });
}

describe("season episode timeline", () => {
  test("lists the season's dated episodes so far, newest first", async () => {
    const t = createTestBackend();
    const adminId = await seedUser(t, ADMIN_IDENTITY, "Admin", true);
    const { seasonId } = await seedSeasons(t);
    await seedEpisode(t, { number: 40, date: "2026-02-20", userId: adminId });
    await seedEpisode(t, { number: 41, date: "2026-03-01", userId: adminId });
    const { episodeId } = await seedEpisode(t, {
      number: 42,
      date: "2026-03-08",
      userId: adminId,
    });
    await seedEpisode(t, { number: 43, date: "2026-03-15", userId: adminId });
    await seedEpisode(t, { number: 44, userId: adminId });

    const timeline = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.seasons.getEpisodeTimeline, {
        seasonId,
        today: "2026-03-08",
      });
    expect(timeline.map(({ episode }) => episode.number)).toEqual([42, 41]);
    expect(timeline[0]).toEqual({
      episode: {
        id: episodeId,
        number: 42,
        title: "Episode 42",
        date: "2026-03-08",
        status: "published",
        slug: "episode-42",
      },
      points: { total: 0, count: 0 },
      guesses: { count: 0, scored: 0 },
      wagers: { count: 0, pointsWagered: 0, won: 0, lost: 0 },
      quotes: { count: 0 },
      players: [],
    });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.seasons.getEpisodeTimeline,
        { seasonId, today: "2026-02-01" },
      ),
    ).resolves.toEqual([]);
  });

  test("summarizes each episode's points, guesses, wagers and quotes", async () => {
    const t = createTestBackend();
    const adminId = await seedUser(t, ADMIN_IDENTITY, "Admin", true);
    const memberId = await seedUser(t, MEMBER_IDENTITY, "Member");
    const { pointTypeId, seasonId, otherSeasonId } = await seedSeasons(t);
    const first = await seedEpisode(t, {
      number: 41,
      date: "2026-03-01",
      userId: adminId,
    });
    const second = await seedEpisode(t, {
      number: 42,
      date: "2026-03-08",
      userId: adminId,
    });

    await t.run(async (ctx) => {
      const ratingId = await ctx.db.insert("ratings", {
        name: "Great",
        value: 4,
      });
      const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
        lookupId: "default",
        normalizedLookupId: "default",
        title: "Wager",
        multiplier: 2,
        isActive: true,
        createdAt: 1,
      });
      // A correct guess on episode 41: 10 points from its type.
      const guessPoint = await ctx.db.insert("points", {
        userId: memberId,
        seasonId,
        earnedAt: 10,
        adjustment: null,
        gamePointTypeId: pointTypeId,
      });
      await ctx.db.insert("guesses", {
        ratingId,
        createdAt: 1,
        userId: memberId,
        assignmentReviewId: first.assignmentReviewId,
        seasonId,
        pointId: guessPoint,
      });
      await ctx.db.insert("guesses", {
        ratingId,
        createdAt: 2,
        userId: adminId,
        assignmentReviewId: first.assignmentReviewId,
        seasonId,
      });
      // A won wager on episode 41 pays 6.
      const wagerPoint = await ctx.db.insert("points", {
        userId: adminId,
        seasonId,
        earnedAt: 11,
        adjustment: 6,
      });
      await ctx.db.insert("gamblingEntries", {
        userId: adminId,
        assignmentId: first.assignmentId,
        points: 3,
        createdAt: 1,
        awardPointId: wagerPoint,
        seasonId,
        gamblingTypeId,
        status: "won",
      });
      await ctx.db.insert("gamblingEntries", {
        userId: memberId,
        assignmentId: first.assignmentId,
        points: 4,
        createdAt: 2,
        seasonId,
        gamblingTypeId,
        status: "rejected",
      });
      // An assignment-linked point and a quote point on episode 42.
      const linkPoint = await ctx.db.insert("points", {
        userId: memberId,
        seasonId,
        earnedAt: 20,
        adjustment: -2,
      });
      await ctx.db.insert("assignmentPointLinks", {
        assignmentId: second.assignmentId,
        userId: memberId,
        pointId: linkPoint,
      });
      const quotePoint = await ctx.db.insert("points", {
        userId: adminId,
        seasonId,
        earnedAt: 21,
        adjustment: 5,
      });
      await ctx.db.insert("quoteSubmissions", {
        userId: adminId,
        episodeId: second.episodeId,
        seasonId,
        quoteText: "Quote",
        sourceTitle: "Movie",
        sourceType: "MOVIE",
        status: "INCLUDED",
        pointId: quotePoint,
        createdAt: 1,
        updatedAt: 1,
      });
      // Neither a manual adjustment nor another season's activity counts.
      await ctx.db.insert("points", {
        userId: memberId,
        seasonId,
        earnedAt: 30,
        adjustment: 100,
      });
      await ctx.db.insert("guesses", {
        ratingId,
        createdAt: 3,
        userId: memberId,
        assignmentReviewId: second.assignmentReviewId,
        seasonId: otherSeasonId,
      });
    });

    const timeline = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.seasons.getEpisodeTimeline, {
        seasonId,
        today: "2026-04-01",
      });
    const player = (
      id: Id<"users">,
      identity: typeof ADMIN_IDENTITY,
      name: string,
      total: number,
    ) => ({
      user: {
        id,
        name,
        image: `https://images.example.test/${identity.subject}.jpg`,
      },
      total,
    });
    expect(timeline).toMatchObject([
      {
        episode: { number: 42 },
        points: { total: 3, count: 2 },
        guesses: { count: 0, scored: 0 },
        wagers: { count: 0, pointsWagered: 0, won: 0, lost: 0 },
        quotes: { count: 1 },
        players: [
          player(adminId, ADMIN_IDENTITY, "Admin", 5),
          player(memberId, MEMBER_IDENTITY, "Member", -2),
        ],
      },
      {
        episode: { number: 41 },
        points: { total: 16, count: 2 },
        guesses: { count: 2, scored: 1 },
        wagers: { count: 2, pointsWagered: 3, won: 1, lost: 0 },
        quotes: { count: 0 },
        players: [
          player(memberId, MEMBER_IDENTITY, "Member", 10),
          player(adminId, ADMIN_IDENTITY, "Admin", 6),
        ],
      },
    ]);
  });

  test("is limited to administrators and fails closed past its episode limit", async () => {
    const t = createTestBackend();
    await seedUser(t, ADMIN_IDENTITY, "Admin", true);
    await seedUser(t, MEMBER_IDENTITY, "Member");
    const { seasonId } = await seedSeasons(t);

    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.seasons.getEpisodeTimeline,
        { seasonId, today: "2026-04-01" },
      ),
      "FORBIDDEN",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.seasons.getEpisodeTimeline,
        { seasonId, today: "April 1" },
      ),
      "VALIDATION_FAILED",
    );

    await t.run(async (ctx) => {
      for (let index = 0; index <= MAX_SEASON_TIMELINE_EPISODES; index += 1) {
        await ctx.db.insert("episodes", {
          number: index + 1,
          title: `Episode ${String(index + 1)}`,
          date: "2026-03-01",
        });
      }
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.seasons.getEpisodeTimeline,
        { seasonId, today: "2026-04-01" },
      ),
      "CONFLICT",
    );
  });
});
