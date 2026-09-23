/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "point-api-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|point-admin",
  issuer: "https://issuer.example.test",
  subject: "point-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|point-member",
  issuer: "https://issuer.example.test",
  subject: "point-member",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|point-other",
  issuer: "https://issuer.example.test",
  subject: "point-other",
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
    name: "Point Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Point Member",
  });
  const otherId = await seedUser(t, {
    identity: OTHER_IDENTITY,
    name: "Point Other",
  });
  return { adminId, memberId, otherId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "point-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "point-api-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "point-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "point-api-test",
    approvedBackupId: "point-api-backup",
    approvedBackupChecksum: "sha256:point-api",
  });
}

async function seedGameFoundation(t: TestBackend) {
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
      title: "Active season",
      gameTypeId,
      startedOn: "2026-01-01",
      endedOn: "2026-12-31",
    });
    return { gameTypeId, pointTypeId, seasonId };
  });
}

async function seedAssignment(
  t: TestBackend,
  userId: Id<"users">,
  suffix: string,
) {
  return await t.run(async (ctx) => {
    const movieId = await ctx.db.insert("movies", {
      title: `Movie ${suffix}`,
      normalizedTitle: `movie ${suffix}`.toLowerCase(),
      year: 2026,
      poster: `https://images.example.test/${suffix}.jpg`,
      url: `https://catalog.example.test/${suffix}`,
    });
    const episodeId = await ctx.db.insert("episodes", {
      number: Number(suffix),
      title: `Episode ${suffix}`,
      status: "pending",
      slug: `episode-${suffix}`,
      normalizedSlug: `episode-${suffix}`,
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId,
      movieId,
      episodeId,
      type: "HOMEWORK",
      playable: false,
      slug: `assignment-${suffix}`,
      normalizedSlug: `assignment-${suffix}`,
    });
    return { assignmentId, movieId, episodeId };
  });
}

async function seedPoint(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    seasonId: Id<"seasons">;
    pointTypeId?: Id<"gamePointTypes">;
    adjustment?: number | null;
    earnedAt?: number;
  },
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("points", {
      userId: input.userId,
      seasonId: input.seasonId,
      earnedAt: input.earnedAt ?? 1,
      adjustment: input.adjustment ?? 0,
      ...(input.pointTypeId === undefined
        ? {}
        : { gamePointTypeId: input.pointTypeId }),
    });
  });
}

describe("point API", () => {
  test("keeps performance public, derives member ownership, and gates administrator writes", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const { seasonId } = await seedGameFoundation(t);
    const pointId = await seedPoint(t, { userId: memberId, seasonId });

    await expect(
      t.query(api.games.public.currentPerformance, {
        today: "2027-01-01",
      }),
    ).resolves.toBeNull();
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.member.myAvailablePoints,
        {
          season: { kind: "current", today: "2027-01-01" },
        },
      ),
    ).resolves.toBe(0);
    await expectDomainError(
      t.query(api.games.points.getById, { id: pointId }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.points.getById, { id: pointId }),
      "FORBIDDEN",
    );

    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          season: { kind: "season", seasonId },
          adjustment: 1,
        },
      ),
      "WRITE_DISABLED",
    );
  });

  test("creates point events and preserves exact totals, ordering, and assignment links", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const { pointTypeId, seasonId } = await seedGameFoundation(t);
    const { assignmentId } = await seedAssignment(t, otherId, "1");
    await advanceToS3(t);

    const manual = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        season: { kind: "season", seasonId },
        reason: " Manual ",
        adjustment: 3,
        earnedAt: 100,
      },
    );
    expect(manual).toMatchObject({
      user: { id: memberId },
      reason: "Manual",
      adjustment: 3,
      gamePointType: null,
      total: 3,
    });
    const typed = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.createByLookup,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        season: { kind: "current", today: "2026-07-24" },
        gamePointLookupId: " GUESS ",
        reason: "Correct",
        adjustment: -2,
        earnedAt: 200,
      },
    );
    expect(typed).toMatchObject({
      gamePointType: { id: pointTypeId },
      total: 8,
    });
    const assignmentPoint =
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.createForAssignmentByLookup,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          assignmentId,
          season: { kind: "season", seasonId },
          gamePointLookupId: "guess",
          reason: "Bonus",
          adjustment: 1,
          earnedAt: 300,
        },
      );
    expect(assignmentPoint).toMatchObject({
      total: 11,
      assignmentLinks: [
        {
          assignment: { id: assignmentId },
        },
      ],
    });
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.linkAssignment,
      {
        clientApiVersion: BBPC_API_VERSION,
        pointId: manual.id,
        assignmentId,
      },
    );
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.linkAssignment,
      {
        clientApiVersion: BBPC_API_VERSION,
        pointId: typed.id,
        assignmentId,
      },
    );

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.totalForUser,
        {
          userId: memberId,
          season: { kind: "season", seasonId },
        },
      ),
    ).resolves.toBe(22);
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.totalForUser,
        {
          userId: memberId,
          season: { kind: "all" },
        },
      ),
    ).resolves.toBe(22);
    const userPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.points.listForUserPage,
      {
        userId: memberId,
        season: { kind: "all" },
        paginationOpts: { numItems: 2, cursor: null },
      },
    );
    expect(userPage.page.map((point) => point.earnedAt)).toEqual([
      300, 200,
    ]);
    expect(userPage.isDone).toBe(false);
    const currentUserPage =
      await t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.listForUserPage,
        {
          userId: memberId,
          season: {
            kind: "current",
            today: "2026-07-24",
          },
          paginationOpts: { numItems: 10, cursor: null },
        },
      );
    expect(currentUserPage.page).toHaveLength(3);
    const seasonPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.points.listForSeasonPage,
      {
        seasonId,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(seasonPage.page).toHaveLength(3);

    const links = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.points.listForAssignmentAndUser,
      { userId: memberId, assignmentId },
    );
    expect(
      links
        .map((link) => link.point.total)
        .sort((left, right) => left - right),
    ).toEqual([3, 8, 11]);
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.totalsForAssignments,
        {
          userIds: [memberId, otherId],
          assignmentIds: [assignmentId],
        },
      ),
    ).resolves.toEqual([
      {
        userId: memberId,
        assignmentId,
        total: 22,
      },
    ]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.totalsForAssignments,
        {
          userIds: [memberId, memberId],
          assignmentIds: [assignmentId],
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.totalsForAssignments,
        {
          userIds: [memberId],
          assignmentIds: [],
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.listForSeasonPage,
        {
          seasonId,
          paginationOpts: { numItems: 0, cursor: null },
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("calculates member availability and public current performance", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const { pointTypeId, seasonId } = await seedGameFoundation(t);
    await seedPoint(t, {
      userId: memberId,
      seasonId,
      pointTypeId,
      adjustment: 2,
      earnedAt: 100,
    });
    await seedPoint(t, {
      userId: otherId,
      seasonId,
      adjustment: 20,
      earnedAt: 200,
    });
    await t.run(async (ctx) => {
      const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
        lookupId: "double",
        normalizedLookupId: "double",
        title: "Double",
        multiplier: 2,
        isActive: true,
        createdAt: 1,
      });
      for (const [status, points] of [
        ["pending", 3],
        ["locked", 2],
        ["won", 99],
      ] as const) {
        await ctx.db.insert("gamblingEntries", {
          userId: memberId,
          points,
          createdAt: 1,
          seasonId,
          gamblingTypeId,
          status,
        });
      }
    });

    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.member.myAvailablePoints,
        {
          season: { kind: "season", seasonId },
        },
      ),
    ).resolves.toBe(7);
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.member.myAvailablePoints,
        {
          season: {
            kind: "current",
            today: "2026-07-24",
          },
        },
      ),
    ).resolves.toBe(7);
    const performance = await t.query(
      api.games.public.currentPerformance,
      { today: "2026-07-24" },
    );
    expect(performance).toMatchObject({
      season: { id: seasonId, episodeCount: null },
      recordedEpisodeCount: null,
      userSummary: [
        { user: { id: otherId }, total: 20 },
        { user: { id: memberId }, total: 12 },
      ],
      points: [
        { userId: memberId, earnedAt: 100, pointValue: 12 },
        { userId: otherId, earnedAt: 200, pointValue: 20 },
      ],
    });
  });

  test("reports fixed-length season progress from dated episodes", async () => {
    const t = createTestBackend();
    await seedActors(t);
    const { seasonId } = await seedGameFoundation(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("seasons", seasonId, { episodeCount: 20 });
      for (const [number, date, status] of [
        [99, "2025-12-29", "published"],
        [100, "2026-01-05", "published"],
        [101, "2026-01-12", "published"],
        [102, "2026-07-24", "recording"],
        [103, "2026-07-31", "next"],
        [104, undefined, "next"],
      ] as const) {
        await ctx.db.insert("episodes", {
          number,
          title: `Episode ${String(number)}`,
          status,
          ...(date === undefined ? {} : { date }),
        });
      }
    });

    await expect(
      t.query(api.games.public.currentPerformance, {
        today: "2026-07-24",
      }),
    ).resolves.toMatchObject({
      season: { id: seasonId, episodeCount: 20 },
      recordedEpisodeCount: 3,
    });
  });

  test("returns the member's points near the season's latest point", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const { pointTypeId, seasonId } = await seedGameFoundation(t);
    const hour = 60 * 60 * 1000;
    const latest = Date.parse("2026-07-17T04:00:00Z");

    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.member.myLatestPointChange,
        { today: "2026-07-24" },
      ),
    ).resolves.toBeNull();

    await seedPoint(t, {
      userId: memberId,
      seasonId,
      adjustment: 4,
      earnedAt: latest - 7 * 24 * hour,
    });
    await seedPoint(t, {
      userId: memberId,
      seasonId,
      pointTypeId,
      adjustment: 1,
      earnedAt: latest - 2 * hour,
    });
    await seedPoint(t, {
      userId: memberId,
      seasonId,
      adjustment: -3,
      earnedAt: latest - hour,
    });
    await seedPoint(t, {
      userId: otherId,
      seasonId,
      adjustment: 20,
      earnedAt: latest,
    });

    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.member.myLatestPointChange,
        { today: "2026-07-24" },
      ),
    ).resolves.toEqual({
      seasonId,
      lastScoredAt: latest,
      points: [
        { earnedAt: latest - 2 * hour, pointValue: 11 },
        { earnedAt: latest - hour, pointValue: -3 },
      ],
    });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.member.myLatestPointChange,
        { today: "2027-01-01" },
      ),
    ).resolves.toBeNull();
    await expectDomainError(
      t.query(api.games.member.myLatestPointChange, {
        today: "2026-07-24",
      }),
      "AUTHENTICATION_REQUIRED",
    );
  });

  test("labels season point activity with the episode it was awarded for", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const { seasonId } = await seedGameFoundation(t);
    await advanceToS3(t);
    const linked = await seedAssignment(t, memberId, "401");
    const guessed = await seedAssignment(t, memberId, "402");
    const wagered = await seedAssignment(t, memberId, "403");
    const pointIds = await Promise.all(
      [1, 2, 3, 4, 5].map((earnedAt) =>
        seedPoint(t, { userId: memberId, seasonId, earnedAt }),
      ),
    );
    const [linkPoint, guessPoint, wagerPoint, quotePoint] = pointIds;
    await t.run(async (ctx) => {
      await ctx.db.insert("assignmentPointLinks", {
        assignmentId: linked.assignmentId,
        userId: memberId,
        pointId: linkPoint,
      });
      const ratingId = await ctx.db.insert("ratings", {
        name: "Excellent",
        value: 5,
      });
      const reviewId = await ctx.db.insert("reviews", {
        userId: memberId,
        movieId: guessed.movieId,
        reviewedAt: 1,
      });
      const assignmentReviewId = await ctx.db.insert("assignmentReviews", {
        assignmentId: guessed.assignmentId,
        reviewId,
      });
      await ctx.db.insert("guesses", {
        ratingId,
        createdAt: 1,
        userId: memberId,
        assignmentReviewId,
        seasonId,
        pointId: guessPoint,
      });
      const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
        lookupId: "double",
        normalizedLookupId: "double",
        title: "Double",
        multiplier: 2,
        isActive: true,
        createdAt: 1,
      });
      await ctx.db.insert("gamblingEntries", {
        userId: memberId,
        assignmentId: wagered.assignmentId,
        points: 2,
        createdAt: 1,
        awardPointId: wagerPoint,
        seasonId,
        gamblingTypeId,
        status: "won",
      });
      await ctx.db.insert("quoteSubmissions", {
        userId: memberId,
        episodeId: linked.episodeId,
        seasonId,
        quoteText: "Shake and bake.",
        sourceTitle: "Talladega Nights",
        sourceType: "MOVIE",
        status: "INCLUDED",
        pointId: quotePoint,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.points.listForSeasonPage,
      { seasonId, paginationOpts: { numItems: 10, cursor: null } },
    );
    expect(
      page.page.map((point) => [point.earnedAt, point.episode?.number ?? null]),
    ).toEqual([
      [5, null],
      [4, 401],
      [3, 403],
      [2, 402],
      [1, 401],
    ]);
    expect(page.page[1]?.episode).toEqual({
      id: linked.episodeId,
      number: 401,
      title: "Episode 401",
    });
  });

  test("paginates only the authenticated member's point history", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const { pointTypeId, seasonId } = await seedGameFoundation(t);
    await seedPoint(t, {
      userId: memberId,
      seasonId,
      pointTypeId,
      adjustment: 1,
      earnedAt: 100,
    });
    await seedPoint(t, {
      userId: memberId,
      seasonId,
      adjustment: 2,
      earnedAt: 200,
    });
    await seedPoint(t, {
      userId: otherId,
      seasonId,
      adjustment: 99,
      earnedAt: 300,
    });

    await expectDomainError(
      t.query(api.games.member.myPointsPage, {
        paginationOpts: { numItems: 1, cursor: null },
      }),
      "AUTHENTICATION_REQUIRED",
    );
    const firstPage = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.member.myPointsPage, {
        paginationOpts: { numItems: 1, cursor: null },
      });
    expect(firstPage.page).toMatchObject([
      {
        user: { id: memberId },
        earnedAt: 200,
        total: 2,
      },
    ]);
    expect(firstPage.isDone).toBe(false);
    const secondPage = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.member.myPointsPage, {
        paginationOpts: {
          numItems: 1,
          cursor: firstPage.continueCursor,
        },
      });
    expect(secondPage.page).toMatchObject([
      {
        user: { id: memberId },
        earnedAt: 100,
        total: 11,
      },
    ]);
    expect(secondPage.isDone).toBe(true);

    await expect(
      t.withIdentity(OTHER_IDENTITY).query(
        api.games.member.myPointsPage,
        {
          paginationOpts: { numItems: 10, cursor: null },
        },
      ),
    ).resolves.toMatchObject({
      page: [{ user: { id: otherId }, total: 99 }],
      isDone: true,
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.member.myPointsPage,
        {
          paginationOpts: { numItems: 0, cursor: null },
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("fails closed when performance points have broken canonical relationships", async () => {
    const missingUserBackend = createTestBackend();
    const { memberId } = await seedActors(missingUserBackend);
    const { seasonId } = await seedGameFoundation(
      missingUserBackend,
    );
    await seedPoint(missingUserBackend, {
      userId: memberId,
      seasonId,
    });
    await missingUserBackend.run(async (ctx) => {
      await ctx.db.delete("users", memberId);
    });
    await expectDomainError(
      missingUserBackend.query(
        api.games.public.currentPerformance,
        { today: "2026-07-24" },
      ),
      "CONFLICT",
    );

    const missingTypeBackend = createTestBackend();
    const actors = await seedActors(missingTypeBackend);
    const foundation = await seedGameFoundation(
      missingTypeBackend,
    );
    await seedPoint(missingTypeBackend, {
      userId: actors.memberId,
      seasonId: foundation.seasonId,
      pointTypeId: foundation.pointTypeId,
    });
    await missingTypeBackend.run(async (ctx) => {
      await ctx.db.delete(
        "gamePointTypes",
        foundation.pointTypeId,
      );
    });
    await expectDomainError(
      missingTypeBackend.query(
        api.games.public.currentPerformance,
        { today: "2026-07-24" },
      ),
      "CONFLICT",
    );
  });

  test("updates and idempotently links or unlinks point assignments", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const { pointTypeId, seasonId } = await seedGameFoundation(t);
    const { assignmentId } = await seedAssignment(t, otherId, "2");
    await advanceToS3(t);
    const pointId = await seedPoint(t, {
      userId: memberId,
      seasonId,
      pointTypeId,
      adjustment: 5,
    });

    const linked = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.linkAssignment,
      {
        clientApiVersion: BBPC_API_VERSION,
        pointId,
        assignmentId,
      },
    );
    expect(linked).toMatchObject({
      assignment: { id: assignmentId },
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.searchAssignmentsForLink,
        { query: "Movie 2" },
      ),
    ).resolves.toMatchObject([{ id: assignmentId }]);
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.searchAssignmentsForLink,
        { query: "02" },
      ),
    ).resolves.toMatchObject([{ id: assignmentId }]);
    const duplicateEpisodeId = await t.run(async (ctx) => {
      return await ctx.db.insert("episodes", {
        number: 2,
        title: "Duplicate episode 2",
        status: "pending",
        slug: "duplicate-episode-2",
        normalizedSlug: "duplicate-episode-2",
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.searchAssignmentsForLink,
        { query: "02" },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("episodes", duplicateEpisodeId);
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.searchAssignmentsForLink,
        { query: "  " },
      ),
    ).resolves.toEqual([]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.searchAssignmentsForLink,
        { query: "x".repeat(101) },
      ),
      "VALIDATION_FAILED",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.getWorkbench,
        { id: pointId },
      ),
    ).resolves.toMatchObject({
      point: {
        id: pointId,
        assignmentLinks: [{ id: linked.id }],
      },
      impact: { assignmentLinkCount: 1 },
      guessAssignments: [],
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.linkAssignment,
        {
          clientApiVersion: BBPC_API_VERSION,
          pointId,
          assignmentId,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pointId,
          expected: {
            userId: memberId,
            seasonId,
            reason: null,
            adjustment: 5,
            gamePointTypeId: pointTypeId,
            earnedAt: 999,
          },
          adjustment: 1,
        },
      ),
      "CONFLICT",
    );
    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.update,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: pointId,
        expected: {
          userId: memberId,
          seasonId,
          reason: null,
          adjustment: 5,
          gamePointTypeId: pointTypeId,
          earnedAt: 1,
        },
        reason: null,
        adjustment: null,
        gamePointTypeId: null,
        earnedAt: 50,
      },
    );
    expect(updated).toMatchObject({
      reason: null,
      adjustment: null,
      gamePointType: null,
      earnedAt: 50,
      total: 0,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pointId,
        },
      ),
    ).resolves.toEqual(updated);
    const restored = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.update,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: pointId,
        reason: " Restored ",
        adjustment: 2,
        gamePointTypeId: pointTypeId,
      },
    );
    expect(restored).toMatchObject({
      reason: "Restored",
      adjustment: 2,
      gamePointType: { id: pointTypeId },
      total: 12,
    });
    const otherPointId = await seedPoint(t, {
      userId: otherId,
      seasonId,
      pointTypeId,
    });
    const otherLink = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.linkAssignment,
      {
        clientApiVersion: BBPC_API_VERSION,
        pointId: otherPointId,
        assignmentId,
      },
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.unlinkAssignment,
        {
          clientApiVersion: BBPC_API_VERSION,
          pointId,
          assignmentId,
          expectedLinkId: otherLink.id,
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.unlinkAssignment,
        {
          clientApiVersion: BBPC_API_VERSION,
          pointId,
          assignmentId,
          expectedLinkId: linked.id,
        },
      ),
    ).resolves.toEqual({ count: 1 });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.unlinkAssignment,
        {
          clientApiVersion: BBPC_API_VERSION,
          pointId,
          assignmentId,
          expectedLinkId: linked.id,
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.unlinkAssignment,
        {
          clientApiVersion: BBPC_API_VERSION,
          pointId,
          assignmentId,
        },
      ),
    ).resolves.toEqual({ count: 0 });
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.linkAssignment,
      {
        clientApiVersion: BBPC_API_VERSION,
        pointId,
        assignmentId,
      },
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("assignments", assignmentId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.getById,
        { id: pointId },
      ),
      "CONFLICT",
    );
  });

  test("fails point workbench closed on broken guess relationships", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const { pointTypeId, seasonId } = await seedGameFoundation(t);
    const { assignmentId, movieId } = await seedAssignment(
      t,
      otherId,
      "4",
    );
    await advanceToS3(t);
    const pointId = await seedPoint(t, {
      userId: memberId,
      seasonId,
      pointTypeId,
    });
    const ids = await t.run(async (ctx) => {
      const ratingId = await ctx.db.insert("ratings", {
        name: "Excellent",
        value: 5,
      });
      const reviewId = await ctx.db.insert("reviews", {
        userId: memberId,
        movieId,
        reviewedAt: 1,
      });
      const assignmentReviewId = await ctx.db.insert(
        "assignmentReviews",
        { assignmentId, reviewId },
      );
      const guessId = await ctx.db.insert("guesses", {
        ratingId,
        createdAt: 1,
        userId: memberId,
        assignmentReviewId,
        seasonId,
        pointId,
      });
      return { assignmentReviewId, guessId, reviewId };
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(
        "assignmentReviews",
        ids.assignmentReviewId,
      );
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.getWorkbench,
        { id: pointId },
      ),
      "CONFLICT",
    );
    const replacementReviewId = await t.run(async (ctx) => {
      const assignmentReviewId = await ctx.db.insert(
        "assignmentReviews",
        { assignmentId, reviewId: ids.reviewId },
      );
      await ctx.db.patch("guesses", ids.guessId, {
        assignmentReviewId,
      });
      await ctx.db.delete("assignments", assignmentId);
      return assignmentReviewId;
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.getWorkbench,
        { id: pointId },
      ),
      "CONFLICT",
    );
    expect(replacementReviewId).toBeDefined();
  });

  test("deletes a point while clearing every canonical award relationship", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const { pointTypeId, seasonId } = await seedGameFoundation(t);
    const { assignmentId, movieId, episodeId } =
      await seedAssignment(t, otherId, "3");
    await advanceToS3(t);
    const pointId = await seedPoint(t, {
      userId: memberId,
      seasonId,
      pointTypeId,
    });
    const relatedIds = await t.run(async (ctx) => {
      const assignmentPointLinkId = await ctx.db.insert(
        "assignmentPointLinks",
        {
          assignmentId,
          userId: memberId,
          pointId,
        },
      );
      const ratingId = await ctx.db.insert("ratings", {
        name: "Excellent",
        value: 5,
      });
      const reviewId = await ctx.db.insert("reviews", {
        userId: memberId,
        movieId,
        reviewedAt: 1,
      });
      const assignmentReviewId = await ctx.db.insert(
        "assignmentReviews",
        { assignmentId, reviewId },
      );
      const guessId = await ctx.db.insert("guesses", {
        ratingId,
        createdAt: 1,
        userId: memberId,
        assignmentReviewId,
        seasonId,
        pointId,
      });
      const gamblingTypeId = await ctx.db.insert("gamblingTypes", {
        lookupId: "double",
        normalizedLookupId: "double",
        title: "Double",
        multiplier: 2,
        isActive: true,
        createdAt: 1,
      });
      const gamblingEntryId = await ctx.db.insert(
        "gamblingEntries",
        {
          userId: memberId,
          points: 2,
          createdAt: 1,
          awardPointId: pointId,
          seasonId,
          gamblingTypeId,
          status: "won",
        },
      );
      const tagVoteId = await ctx.db.insert("tagVotes", {
        tag: "funny",
        normalizedTag: "funny",
        tmdbId: 1,
        createdAt: 1,
        userId: memberId,
        award: { kind: "point", pointId },
      });
      const quoteSubmissionId = await ctx.db.insert(
        "quoteSubmissions",
        {
          userId: memberId,
          episodeId,
          seasonId,
          quoteText: "Quote",
          sourceTitle: "Movie",
          sourceType: "MOVIE",
          status: "SUBMITTED",
          pointId,
          createdAt: 1,
          updatedAt: 1,
        },
      );
      return {
        assignmentPointLinkId,
        assignmentReviewId,
        guessId,
        gamblingEntryId,
        tagVoteId,
        quoteSubmissionId,
      };
    });

    const detail = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.points.getById,
      { id: pointId },
    );
    expect(detail).toMatchObject({
      assignmentLinks: [{ id: relatedIds.assignmentPointLinkId }],
      guesses: [{ id: relatedIds.guessId }],
      gamblingEntries: [{ id: relatedIds.gamblingEntryId }],
      tagVotes: [{ id: relatedIds.tagVoteId, tag: "funny" }],
      quoteSubmissions: [{ id: relatedIds.quoteSubmissionId }],
    });
    const expected = {
      userId: memberId,
      seasonId,
      reason: null,
      adjustment: 0,
      gamePointTypeId: pointTypeId,
      earnedAt: 1,
    };
    const expectedImpact = {
      assignmentLinkCount: 1,
      guessCount: 1,
      gamblingEntryCount: 1,
      tagVoteCount: 1,
      quoteSubmissionCount: 1,
    };
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.getWorkbench,
        { id: pointId },
      ),
    ).resolves.toMatchObject({
      point: { id: pointId },
      impact: expectedImpact,
      guessAssignments: [
        {
          id: relatedIds.guessId,
          assignmentReviewId: relatedIds.assignmentReviewId,
          assignment: { id: assignmentId },
        },
      ],
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pointId,
          expected: { ...expected, earnedAt: 999 },
          expectedImpact,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pointId,
          expected,
          expectedImpact: {
            ...expectedImpact,
            assignmentLinkCount: 0,
          },
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: pointId,
          expected,
          expectedImpact,
        },
      ),
    ).resolves.toEqual({ id: pointId });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("points", pointId)).toBeNull();
      expect(
        await ctx.db.get(
          "assignmentPointLinks",
          relatedIds.assignmentPointLinkId,
        ),
      ).toBeNull();
      expect(await ctx.db.get("guesses", relatedIds.guessId))
        .not.toHaveProperty("pointId");
      expect(
        await ctx.db.get(
          "gamblingEntries",
          relatedIds.gamblingEntryId,
        ),
      ).not.toHaveProperty("awardPointId");
      expect(
        await ctx.db.get("tagVotes", relatedIds.tagVoteId),
      ).toMatchObject({ award: { kind: "unawarded" } });
      expect(
        await ctx.db.get(
          "quoteSubmissions",
          relatedIds.quoteSubmissionId,
        ),
      ).not.toHaveProperty("pointId");
    });
  });

  test("rejects invalid adjustments, timestamps, lookup IDs, and missing current seasons", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const { seasonId } = await seedGameFoundation(t);
    await advanceToS3(t);

    for (const adjustment of [1.5, 2_147_483_648]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.games.points.create,
          {
            clientApiVersion: BBPC_API_VERSION,
            userId: memberId,
            season: { kind: "season", seasonId },
            adjustment,
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.createByLookup,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          season: { kind: "season", seasonId },
          gamePointLookupId: "missing",
          reason: "Missing",
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          season: { kind: "current", today: "2027-01-01" },
          adjustment: 1,
        },
      ),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          season: { kind: "season", seasonId },
          adjustment: 1,
          earnedAt: 1.5,
        },
      ),
      "VALIDATION_FAILED",
    );
    const defaulted = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.createByLookup,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        season: { kind: "season", seasonId },
        gamePointLookupId: "guess",
        reason: "Defaulted",
      },
    );
    expect(defaulted).toMatchObject({
      adjustment: 0,
      total: 10,
    });
    expect(defaulted.earnedAt).toBeGreaterThan(0);
    const noReason = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.points.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        season: { kind: "season", seasonId },
        adjustment: null,
      },
    );
    expect(noReason).toMatchObject({
      reason: null,
      adjustment: null,
      total: 0,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: noReason.id,
          reason: "x".repeat(1001),
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("points", noReason.id);
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.getById,
        { id: noReason.id },
      ),
    ).resolves.toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.points.getWorkbench,
        { id: noReason.id },
      ),
    ).resolves.toBeNull();
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: noReason.id,
          adjustment: 1,
        },
      ),
      "NOT_FOUND",
    );
    const { assignmentId } = await seedAssignment(
      t,
      memberId,
      "9",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("assignments", assignmentId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.createForAssignmentByLookup,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          assignmentId,
          season: { kind: "season", seasonId },
          gamePointLookupId: "guess",
          reason: "Missing assignment",
        },
      ),
      "NOT_FOUND",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("users", memberId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.points.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          season: { kind: "season", seasonId },
          adjustment: 1,
        },
      ),
      "NOT_FOUND",
    );
  });
});
