/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { MAX_ASSIGNMENTS_PER_EPISODE } from "./assignments/limits.js";
import {
  MAX_GUESSES_PER_ASSIGNMENT,
  MAX_UNPUBLISHED_EPISODES,
} from "./games/limits.js";
import { MAX_REVIEW_RELATIONSHIPS } from "./reviews/limits.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "result-embargo-test";
const TODAY = "2026-07-24";
const EARLY = Date.UTC(2026, 1, 1, 20);
const PUBLISHED_AT = Date.UTC(2026, 6, 20, 20);
const RECORDED_AT = Date.UTC(2026, 6, 23, 20);
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|embargo-member",
  issuer: "https://issuer.example.test",
  subject: "embargo-member",
};

const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|embargo-other",
  issuer: "https://issuer.example.test",
  subject: "embargo-other",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

/**
 * One season with three rounds: episode 10 is published, episode 11 has been
 * recorded and awarded but its status is `heldStatus`, and episode 12 is the
 * open round. The member also holds a manual point that belongs to no episode.
 *
 * Member: 100 manual, 3 from the published round, and from the held round a
 * guess (5), a bonus (2), a won wager (stake 10, award 20) and a winning quote
 * (40). They have 7 staked on the open round. Other: 50 manual and a lost
 * wager on the held round (stake 4, award -4).
 */
async function seedSeason(t: TestBackend, heldStatus: string | undefined) {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "result-embargo-test",
  });
  return await t.run(async (ctx) => {
    const insertUser = async (name: string) =>
      await ctx.db.insert("users", {
        name,
        email: `${name.toLowerCase()}@example.test`,
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    const [memberId, otherId, hostId] = await Promise.all([
      insertUser("Member"),
      insertUser("Other"),
      insertUser("Host"),
    ]);
    await ctx.db.insert("authIdentities", {
      ...MEMBER_IDENTITY,
      userId: memberId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title: "Predictions",
      lookupId: "WTFIR",
      normalizedLookupId: "wtfir",
    });
    const seasonId = await ctx.db.insert("seasons", {
      title: "Active season",
      gameTypeId,
      startedOn: "2026-01-01",
      endedOn: "2026-12-31",
    });
    const hostRatingId = await ctx.db.insert("ratings", {
      name: "Excellent",
      value: 5,
    });
    const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
      lookupId: "default",
      normalizedLookupId: "default",
      title: "Default wager",
      multiplier: 2,
      isActive: true,
      createdAt: 1,
    });

    const insertPoint = async (
      userId: Id<"users">,
      adjustment: number,
      earnedAt: number,
    ) =>
      await ctx.db.insert("points", {
        userId,
        seasonId,
        adjustment,
        earnedAt,
        reason: "Synthetic point",
      });
    const insertRound = async (number: number, status: string | undefined) => {
      const movieId = await ctx.db.insert("movies", {
        title: `Movie ${String(number)}`,
        normalizedTitle: `movie ${String(number)}`,
        year: 2026,
        url: `https://catalog.example.test/${String(number)}`,
      });
      const episodeId = await ctx.db.insert("episodes", {
        number,
        title: `Episode ${String(number)}`,
        ...(status === undefined ? {} : { status }),
      });
      const assignmentId = await ctx.db.insert("assignments", {
        userId: hostId,
        episodeId,
        movieId,
        type: "HOMEWORK",
        playable: true,
      });
      const reviewId = await ctx.db.insert("reviews", {
        userId: hostId,
        movieId,
        ratingId: hostRatingId,
        reviewedAt: RECORDED_AT,
      });
      const assignmentReviewId = await ctx.db.insert("assignmentReviews", {
        assignmentId,
        reviewId,
      });
      return { episodeId, assignmentId, assignmentReviewId };
    };
    const insertGuess = async (
      assignmentReviewId: Id<"assignmentReviews">,
      pointId: Id<"points">,
    ) =>
      await ctx.db.insert("guesses", {
        ratingId: hostRatingId,
        createdAt: 1,
        userId: memberId,
        assignmentReviewId,
        seasonId,
        pointId,
      });

    const manualPointId = await insertPoint(memberId, 100, EARLY);
    await insertPoint(otherId, 50, EARLY);

    const published = await insertRound(10, "published");
    const publishedPointId = await insertPoint(memberId, 3, PUBLISHED_AT);
    await insertGuess(published.assignmentReviewId, publishedPointId);

    const held = await insertRound(11, heldStatus);
    const guessPointId = await insertPoint(memberId, 5, RECORDED_AT);
    await insertGuess(held.assignmentReviewId, guessPointId);
    const bonusPointId = await insertPoint(memberId, 2, RECORDED_AT);
    await ctx.db.insert("assignmentPointLinks", {
      assignmentId: held.assignmentId,
      userId: memberId,
      pointId: bonusPointId,
    });
    const wagerPointId = await insertPoint(memberId, 20, RECORDED_AT);
    const wonWagerId = await ctx.db.insert("gamblingEntries", {
      userId: memberId,
      assignmentId: held.assignmentId,
      points: 10,
      createdAt: 1,
      awardPointId: wagerPointId,
      seasonId,
      gamblingTypeId,
      status: "won",
    });
    const lostPointId = await insertPoint(otherId, -4, RECORDED_AT);
    await ctx.db.insert("gamblingEntries", {
      userId: otherId,
      assignmentId: held.assignmentId,
      points: 4,
      createdAt: 1,
      awardPointId: lostPointId,
      seasonId,
      gamblingTypeId,
      status: "lost",
    });
    const quotePointId = await insertPoint(memberId, 40, RECORDED_AT);
    await ctx.db.insert("quoteSubmissions", {
      userId: memberId,
      episodeId: held.episodeId,
      seasonId,
      quoteText: "Synthetic quote",
      sourceTitle: "Synthetic source",
      sourceType: "MOVIE",
      status: "INCLUDED",
      placement: 1,
      pointId: quotePointId,
      createdAt: 1,
      updatedAt: RECORDED_AT,
    });

    const open = await insertRound(12, "next");
    await ctx.db.insert("gamblingEntries", {
      userId: memberId,
      assignmentId: open.assignmentId,
      points: 7,
      createdAt: 2,
      seasonId,
      gamblingTypeId,
      status: "pending",
    });

    return {
      memberId,
      otherId,
      seasonId,
      held,
      wonWagerId,
      manualPointId,
      publishedPointId,
      heldPointIds: [guessPointId, bonusPointId, wagerPointId, quotePointId],
    };
  });
}

async function publish(t: TestBackend, episodeId: Id<"episodes">) {
  await t.run(async (ctx) => {
    await ctx.db.patch("episodes", episodeId, { status: "published" });
  });
}

/** Moves the backend from its seeded stage to the one that accepts writes. */
async function openWrites(t: TestBackend) {
  const run = { cutoverRunId: CUTOVER_RUN_ID, actor: "result-embargo-test" };
  await t.mutation(internal.system.cutover.transition, {
    ...run,
    expectedStage: "S0",
    nextStage: "S1",
  });
  await t.mutation(internal.system.cutover.transition, {
    ...run,
    expectedStage: "S1",
    nextStage: "S2",
  });
  await t.mutation(internal.system.cutover.transition, {
    ...run,
    expectedStage: "S2",
    nextStage: "S3",
    approvedBackupId: "result-embargo-backup",
    approvedBackupChecksum: "sha256:result-embargo",
  });
}

async function publicTotals(t: TestBackend) {
  const performance = await t.query(api.games.public.currentPerformance, {
    today: TODAY,
  });
  const totals: Record<string, number> = {};
  for (const entry of performance?.userSummary ?? []) {
    totals[entry.user.name ?? ""] = entry.total;
  }
  return { totals, pointCount: performance?.points.length };
}

describe("results wait for the episode to be published", () => {
  test("public standings leave out a recorded but unpublished episode", async () => {
    const t = createTestBackend();
    const { held } = await seedSeason(t, "recording");

    expect(await publicTotals(t)).toEqual({
      totals: { Member: 103, Other: 50 },
      pointCount: 3,
    });

    await publish(t, held.episodeId);
    expect(await publicTotals(t)).toEqual({
      totals: { Member: 170, Other: 46 },
      pointCount: 8,
    });
  });

  test.each<[string | undefined]>([
    ["pending"],
    ["next"],
    [undefined],
    ["Zebra"],
    ["archived"],
  ])(
    "holds results for an episode whose status is %s",
    async (status) => {
      const t = createTestBackend();
      await seedSeason(t, status);
      expect((await publicTotals(t)).totals).toEqual({ Member: 103, Other: 50 });
    },
  );

  test("treats the title-case status as published", async () => {
    const t = createTestBackend();
    await seedSeason(t, "Published");
    expect((await publicTotals(t)).totals).toEqual({ Member: 170, Other: 46 });
  });

  test("a listener's own totals, standing and balance wait too", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    const member = t.withIdentity(MEMBER_IDENTITY);
    const season = { kind: "season" as const, seasonId: seeded.seasonId };

    const [summary] = await member.query(api.games.member.mySeasons, {
      today: TODAY,
    });
    expect(summary).toMatchObject({
      total: 103,
      pointCount: 2,
      // 103 visible, less 7 on the open round and the 10 still held.
      available: 86,
      standing: { rank: 1, playerCount: 2 },
    });
    const overview = await member.query(api.games.member.mySeasonOverview, {
      seasonId: seeded.seasonId,
      today: TODAY,
    });
    expect(overview).toMatchObject({ total: 103, pointCount: 2, available: 86 });
    expect(overview.points).toHaveLength(3);
    expect(
      await member.query(api.games.member.myAvailablePoints, { season }),
    ).toBe(86);
    expect(
      await member.query(api.games.member.mySeasonStanding, {
        seasonId: seeded.seasonId,
      }),
    ).toEqual({ rank: 1, playerCount: 2 });

    await publish(t, seeded.held.episodeId);
    const [revealed] = await member.query(api.games.member.mySeasons, {
      today: TODAY,
    });
    expect(revealed).toMatchObject({
      total: 170,
      pointCount: 6,
      available: 163,
    });
    expect(
      await member.query(api.games.member.myAvailablePoints, { season }),
    ).toBe(163);
  });

  test("a listener's point lists and last-episode badge wait too", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    const member = t.withIdentity(MEMBER_IDENTITY);
    const paginationOpts = { numItems: 20, cursor: null };
    const visibleIds = [seeded.publishedPointId, seeded.manualPointId];

    const allPoints = await member.query(api.games.member.myPointsPage, {
      paginationOpts,
    });
    expect(allPoints.page.map((point) => point.id)).toEqual(visibleIds);
    const seasonPoints = await member.query(
      api.games.member.mySeasonPointsPage,
      { seasonId: seeded.seasonId, paginationOpts },
    );
    expect(seasonPoints.page.map((point) => point.id)).toEqual(visibleIds);
    expect(
      await member.query(api.games.member.myLatestPointChange, {
        today: TODAY,
      }),
    ).toEqual({
      seasonId: seeded.seasonId,
      lastScoredAt: PUBLISHED_AT,
      points: [{ earnedAt: PUBLISHED_AT, pointValue: 3 }],
    });

    await publish(t, seeded.held.episodeId);
    const revealed = await member.query(api.games.member.mySeasonPointsPage, {
      seasonId: seeded.seasonId,
      paginationOpts,
    });
    expect(revealed.page.map((point) => point.id).sort()).toEqual(
      [...seeded.heldPointIds, ...visibleIds].sort(),
    );
    const change = await member.query(api.games.member.myLatestPointChange, {
      today: TODAY,
    });
    expect(change?.lastScoredAt).toBe(RECORDED_AT);
    expect(
      change?.points.map((point) => point.pointValue).sort((a, b) => a - b),
    ).toEqual([2, 5, 20, 40]);
  });

  test("a listener's wager, guess and quote read as unsettled until then", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    const member = t.withIdentity(MEMBER_IDENTITY);
    const { assignmentId, episodeId } = seeded.held;
    const read = async () => ({
      seasonWagers: await member.query(api.games.member.mySeasonWagers, {
        seasonId: seeded.seasonId,
      }),
      wagers: await member.query(api.games.gambling.mineForAssignment, {
        assignmentId,
      }),
      wagerGroups: await member.query(api.games.gambling.mineForAssignments, {
        assignmentIds: [assignmentId],
      }),
      activeWagers: await member.query(
        api.games.gambling.mineForActiveTypes,
        {},
      ),
      typeWagers: await member.query(api.games.gambling.mineForType, {}),
      guesses: await member.query(api.games.guesses.mineForAssignment, {
        assignmentId,
      }),
      guessGroups: await member.query(api.games.guesses.mineForAssignments, {
        assignmentIds: [assignmentId],
      }),
      quote: await member.query(api.games.quotes.mineForEpisode, {
        episodeId,
        now: RECORDED_AT,
      }),
    });
    const heldWager = (entries: Array<{ id: string }>) =>
      entries.find((entry) => entry.id === seeded.wonWagerId);

    const before = await read();
    for (const entries of [
      before.seasonWagers,
      before.wagers,
      before.wagerGroups[0]?.entries ?? [],
      before.activeWagers,
      before.typeWagers,
    ]) {
      expect(heldWager(entries)).toMatchObject({
        status: "locked",
        awardPoint: null,
        points: 10,
      });
    }
    for (const guesses of [
      before.guesses,
      before.guessGroups[0]?.guesses ?? [],
    ]) {
      expect(guesses).toHaveLength(1);
      expect(guesses[0]).toMatchObject({
        point: null,
        // The listener's own pick stays; the host's answer does not.
        rating: { value: 5 },
        assignmentReview: { review: { rating: null, reviewedAt: null } },
      });
    }
    expect(before.quote.submission).toMatchObject({
      status: "INCLUDED",
      placement: null,
      scored: false,
      // The award stamped a later time on the stored entry.
      createdAt: 1,
      updatedAt: 1,
    });

    await publish(t, episodeId);
    const after = await read();
    expect(heldWager(after.seasonWagers)).toMatchObject({
      status: "won",
      awardPoint: { adjustment: 20 },
    });
    expect(heldWager(after.wagers)).toMatchObject({ status: "won" });
    expect(after.guesses[0]).toMatchObject({
      point: { adjustment: 5 },
      assignmentReview: {
        review: { rating: { value: 5 }, reviewedAt: RECORDED_AT },
      },
    });
    expect(after.quote.submission).toMatchObject({
      placement: 1,
      scored: true,
      updatedAt: RECORDED_AT,
    });
  });

  test("a listener's standing does not move until the episode is published", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    // A held award that puts Other in first place once the episode is out.
    await t.run(async (ctx) => {
      const pointId = await ctx.db.insert("points", {
        userId: seeded.otherId,
        seasonId: seeded.seasonId,
        adjustment: 500,
        earnedAt: RECORDED_AT,
        reason: "Synthetic point",
      });
      await ctx.db.insert("assignmentPointLinks", {
        assignmentId: seeded.held.assignmentId,
        userId: seeded.otherId,
        pointId,
      });
    });
    const member = t.withIdentity(MEMBER_IDENTITY);
    const standings = async () => ({
      season: await member.query(api.games.member.mySeasonStanding, {
        seasonId: seeded.seasonId,
      }),
      summary: (
        await member.query(api.games.member.mySeasons, { today: TODAY })
      )[0]?.standing,
      overview: (
        await member.query(api.games.member.mySeasonOverview, {
          seasonId: seeded.seasonId,
          today: TODAY,
        })
      ).standing,
    });

    const first = { rank: 1, playerCount: 2 };
    expect(await standings()).toEqual({
      season: first,
      summary: first,
      overview: first,
    });
    await publish(t, seeded.held.episodeId);
    const second = { rank: 2, playerCount: 2 };
    expect(await standings()).toEqual({
      season: second,
      summary: second,
      overview: second,
    });
  });

  test("point pages are never short or empty because of held points", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    const member = t.withIdentity(MEMBER_IDENTITY);
    const visibleIds = [seeded.publishedPointId, seeded.manualPointId];

    // One row at a time: the four held points are the newest, so a filter
    // applied after paging would return four empty pages first.
    for (const read of [
      async (cursor: string | null) =>
        await member.query(api.games.member.myPointsPage, {
          paginationOpts: { numItems: 1, cursor },
        }),
      async (cursor: string | null) =>
        await member.query(api.games.member.mySeasonPointsPage, {
          seasonId: seeded.seasonId,
          paginationOpts: { numItems: 1, cursor },
        }),
    ]) {
      let cursor: string | null = null;
      for (const expectedId of visibleIds) {
        const result: {
          page: Array<{ id: string }>;
          continueCursor: string;
        } = await read(cursor);
        expect(result.page.map((point) => point.id)).toEqual([expectedId]);
        cursor = result.continueCursor;
      }
      expect((await read(cursor)).page).toEqual([]);
    }
  });

  test("an open round's entries do not count against the limits", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    // More pending wagers and unrated guesses than any one read allows.
    await t.run(async (ctx) => {
      const open = await ctx.db
        .query("episodes")
        .withIndex("by_status_and_number", (index) => index.eq("status", "next"))
        .unique();
      const assignment = await ctx.db
        .query("assignments")
        .withIndex("by_episodeId", (index) =>
          index.eq("episodeId", open?._id as Id<"episodes">),
        )
        .unique();
      const review = await ctx.db
        .query("assignmentReviews")
        .withIndex("by_assignmentId", (index) =>
          index.eq("assignmentId", assignment?._id as Id<"assignments">),
        )
        .unique();
      if (assignment === null || review === null || open === null) {
        throw new Error("fixture");
      }
      // The host has not rated the open round yet.
      await ctx.db.patch("reviews", review.reviewId, {
        ratingId: undefined,
        reviewedAt: undefined,
      });
      const gamblingType = await ctx.db.query("gamblingTypes").first();
      const rating = await ctx.db.query("ratings").first();
      if (gamblingType === null || rating === null) {
        throw new Error("fixture");
      }
      for (let index = 0; index <= MAX_GUESSES_PER_ASSIGNMENT; index += 1) {
        await ctx.db.insert("gamblingEntries", {
          userId: seeded.otherId,
          assignmentId: assignment._id,
          points: 0,
          createdAt: index,
          seasonId: seeded.seasonId,
          gamblingTypeId: gamblingType._id,
          status: "pending",
        });
        await ctx.db.insert("guesses", {
          ratingId: rating._id,
          createdAt: index,
          userId: seeded.otherId,
          assignmentReviewId: review._id,
          seasonId: seeded.seasonId,
        });
        await ctx.db.insert("quoteSubmissions", {
          userId: seeded.otherId,
          episodeId: open._id,
          seasonId: seeded.seasonId,
          quoteText: "Synthetic quote",
          sourceTitle: "Synthetic source",
          sourceType: "MOVIE",
          status: "SUBMITTED",
          createdAt: index,
          updatedAt: index,
        });
      }
    });

    expect((await publicTotals(t)).totals).toEqual({ Member: 103, Other: 50 });
    expect(
      await t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.member.myLatestPointChange, { today: TODAY }),
    ).toMatchObject({ lastScoredAt: PUBLISHED_AT });
  });

  test("fails closed when too many episodes are unpublished", async () => {
    const t = createTestBackend();
    await seedSeason(t, "recording");
    await t.run(async (ctx) => {
      for (let number = 100; number < 100 + MAX_UNPUBLISHED_EPISODES; number += 1) {
        await ctx.db.insert("episodes", {
          number,
          title: `Planned ${String(number)}`,
          status: "pending",
        });
      }
    });

    await expect(
      t.query(api.games.public.currentPerformance, { today: TODAY }),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof ConvexError &&
        (error.data as { code?: string }).code === "CONFLICT",
    );
  });

  test("held winnings cannot be wagered until the episode is published", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    await openWrites(t);
    const member = t.withIdentity(MEMBER_IDENTITY);
    const wager = async (points: number) =>
      await member.mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        points,
        today: TODAY,
      });

    // 86 is spendable; the 20 won at the recording is not, and its stake of
    // 10 stays reserved.
    await expect(wager(87)).rejects.toSatisfy(
      (error) =>
        error instanceof ConvexError &&
        (error.data as { details?: { reason?: string; available?: number } })
          .details?.reason === "INSUFFICIENT_POINTS" &&
        (error.data as { details?: { available?: number } }).details
          ?.available === 86,
    );

    await publish(t, seeded.held.episodeId);
    expect(await wager(87)).toMatchObject({ status: "pending", points: 87 });
    expect(
      await member.query(api.games.member.myAvailablePoints, {
        season: { kind: "season", seasonId: seeded.seasonId },
      }),
    ).toBe(76);
  });

  test("a lost wager reads as still locked, with its stake reserved", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    await t.run(async (ctx) => {
      await ctx.db.insert("authIdentities", {
        ...OTHER_IDENTITY,
        userId: seeded.otherId,
        linkedAt: 1,
        lastSeenAt: 1,
      });
    });
    const other = t.withIdentity(OTHER_IDENTITY);
    const read = async () => {
      const [summary] = await other.query(api.games.member.mySeasons, {
        today: TODAY,
      });
      const [wager] = await other.query(api.games.gambling.mineForAssignment, {
        assignmentId: seeded.held.assignmentId,
      });
      return { summary, wager };
    };

    const before = await read();
    expect(before.summary).toMatchObject({
      total: 50,
      available: 46,
      standing: { rank: 2, playerCount: 2 },
    });
    expect(before.wager).toMatchObject({
      status: "locked",
      awardPoint: null,
      points: 4,
    });

    await publish(t, seeded.held.episodeId);
    const after = await read();
    expect(after.summary).toMatchObject({ total: 46, available: 46 });
    expect(after.wager).toMatchObject({
      status: "lost",
      awardPoint: { adjustment: -4 },
    });
  });

  test("the last-episode badge is empty while every point is held", async () => {
    const t = createTestBackend();
    const seeded = await seedSeason(t, "recording");
    await t.run(async (ctx) => {
      for (const point of await ctx.db.query("points").take(20)) {
        if (point.earnedAt !== RECORDED_AT) {
          await ctx.db.delete("points", point._id);
        }
      }
    });
    const member = t.withIdentity(MEMBER_IDENTITY);

    expect(
      await member.query(api.games.member.myLatestPointChange, {
        today: TODAY,
      }),
    ).toBeNull();
    expect(await publicTotals(t)).toEqual({ totals: {}, pointCount: 0 });

    await publish(t, seeded.held.episodeId);
    expect(
      await member.query(api.games.member.myLatestPointChange, {
        today: TODAY,
      }),
    ).toMatchObject({ lastScoredAt: RECORDED_AT });
  });

  test.each([
    ["assignments", MAX_ASSIGNMENTS_PER_EPISODE],
    ["reviews", MAX_REVIEW_RELATIONSHIPS],
  ] as const)(
    "fails closed when an unpublished episode has too many %s",
    async (relationship, limit) => {
      const t = createTestBackend();
      const { held } = await seedSeason(t, "recording");
      await t.run(async (ctx) => {
        const assignment = await ctx.db.get("assignments", held.assignmentId);
        const link = await ctx.db.get(
          "assignmentReviews",
          held.assignmentReviewId,
        );
        if (assignment === null || link === null) {
          throw new Error("The held round was not seeded.");
        }
        for (let index = 0; index < limit; index += 1) {
          if (relationship === "assignments") {
            await ctx.db.insert("assignments", {
              userId: assignment.userId,
              episodeId: held.episodeId,
              movieId: assignment.movieId,
              type: "HOMEWORK",
              playable: false,
            });
          } else {
            await ctx.db.insert("assignmentReviews", {
              assignmentId: held.assignmentId,
              reviewId: link.reviewId,
            });
          }
        }
      });

      await expect(
        t.query(api.games.public.currentPerformance, { today: TODAY }),
      ).rejects.toSatisfy(
        (error) =>
          error instanceof ConvexError &&
          (error.data as { code?: string }).code === "CONFLICT" &&
          (error.data as { details?: { relationship?: string } }).details
            ?.relationship === relationship,
      );
    },
  );
});
