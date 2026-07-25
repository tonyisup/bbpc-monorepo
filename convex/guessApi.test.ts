/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "guess-api-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|guess-admin",
  issuer: "https://issuer.example.test",
  subject: "guess-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|guess-member",
  issuer: "https://issuer.example.test",
  subject: "guess-member",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|guess-other",
  issuer: "https://issuer.example.test",
  subject: "guess-other",
};
const HOST_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|guess-host",
  issuer: "https://issuer.example.test",
  subject: "guess-host",
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
    name: "Guess Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Guess Member",
  });
  const otherId = await seedUser(t, {
    identity: OTHER_IDENTITY,
    name: "Guess Other",
  });
  const hostId = await seedUser(t, {
    identity: HOST_IDENTITY,
    name: "Guess Host",
  });
  return { adminId, memberId, otherId, hostId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "guess-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "guess-api-test",
  });
}

async function advanceFromS1ToS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "guess-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "guess-api-test",
    approvedBackupId: "guess-api-backup",
    approvedBackupChecksum: "sha256:guess-api",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await advanceFromS1ToS3(t);
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
    const otherSeasonId = await ctx.db.insert("seasons", {
      title: "Past season",
      gameTypeId,
      startedOn: "2025-01-01",
      endedOn: "2025-12-31",
    });
    const highRatingId = await ctx.db.insert("ratings", {
      name: "Excellent",
      value: 5,
    });
    const lowRatingId = await ctx.db.insert("ratings", {
      name: "Poor",
      value: 1,
    });
    return {
      gameTypeId,
      pointTypeId,
      seasonId,
      otherSeasonId,
      highRatingId,
      lowRatingId,
    };
  });
}

async function seedAssignmentRound(
  t: TestBackend,
  input: {
    ownerId: Id<"users">;
    hostIds: Array<Id<"users">>;
    ratingId: Id<"ratings">;
    suffix: string;
    playable?: boolean;
    episodeStatus?: string;
  },
) {
  return await t.run(async (ctx) => {
    const movieId = await ctx.db.insert("movies", {
      title: `Movie ${input.suffix}`,
      normalizedTitle: `movie ${input.suffix}`,
      year: 2026,
      poster: `https://images.example.test/${input.suffix}.jpg`,
      url: `https://catalog.example.test/${input.suffix}`,
    });
    const episodeId = await ctx.db.insert("episodes", {
      number: Number(input.suffix),
      title: `Episode ${input.suffix}`,
      status: input.episodeStatus ?? "next",
      slug: `episode-${input.suffix}`,
      normalizedSlug: `episode-${input.suffix}`,
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId: input.ownerId,
      movieId,
      episodeId,
      type: "HOMEWORK",
      playable: input.playable ?? true,
      slug: `assignment-${input.suffix}`,
      normalizedSlug: `assignment-${input.suffix}`,
    });
    const assignmentReviewIds = [];
    for (const hostId of input.hostIds) {
      const reviewId = await ctx.db.insert("reviews", {
        userId: hostId,
        movieId,
        ratingId: input.ratingId,
        reviewedAt: 1,
      });
      assignmentReviewIds.push(
        await ctx.db.insert("assignmentReviews", {
          assignmentId,
          reviewId,
        }),
      );
    }
    return {
      assignmentId,
      assignmentReviewIds,
      episodeId,
      movieId,
    };
  });
}

async function seedPoint(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    seasonId: Id<"seasons">;
  },
): Promise<Id<"points">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("points", {
      userId: input.userId,
      seasonId: input.seasonId,
      earnedAt: 1,
      adjustment: 1,
    });
  });
}

function requireFirst<T>(items: T[], label: string): T {
  const first = items.at(0);
  if (first === undefined) {
    throw new Error(`Expected ${label}`);
  }
  return first;
}

function requirePresent<T>(
  value: T | null | undefined,
  label: string,
): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label}`);
  }
  return value;
}

describe("guess API", () => {
  test("derives ownership, gates writes, and idempotently updates a member submission", async () => {
    const t = createTestBackend();
    const { adminId, memberId, hostId } =
      await seedActors(t);
    const { highRatingId, lowRatingId } =
      await seedGameFoundation(t);
    const round = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId],
      ratingId: highRatingId,
      suffix: "1",
    });

    await expectDomainError(
      t.query(api.games.guesses.mineForAssignment, {
        assignmentId: round.assignmentId,
      }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.guesses.listForAssignment, {
          assignmentId: round.assignmentId,
        }),
      "FORBIDDEN",
    );
    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.guesses.submit,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: round.assignmentId,
          hostId,
          ratingId: highRatingId,
          today: "2026-07-24",
          createdAt: 100,
        },
      ),
      "WRITE_DISABLED",
    );
    await advanceFromS1ToS3(t);

    const created = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.games.guesses.submit,
      {
        clientApiVersion: BBPC_API_VERSION,
        assignmentId: round.assignmentId,
        hostId,
        ratingId: highRatingId,
        today: "2026-07-24",
        createdAt: 100,
      },
    );
    expect(created).toMatchObject({
      createdAt: 100,
      user: { id: memberId },
      rating: { id: highRatingId },
      assignmentReview: {
        id: requireFirst(
          round.assignmentReviewIds,
          "host assignment review",
        ),
        review: { user: { id: hostId } },
      },
      point: null,
    });
    await expect(
      t.withIdentity(OTHER_IDENTITY).query(
        api.games.guesses.mineForAssignment,
        { assignmentId: round.assignmentId },
      ),
    ).resolves.toEqual([]);

    const updated = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.games.guesses.submit,
      {
        clientApiVersion: BBPC_API_VERSION,
        assignmentId: round.assignmentId,
        hostId,
        ratingId: lowRatingId,
        today: "2026-07-24",
        createdAt: 200,
      },
    );
    expect(updated).toMatchObject({
      id: created.id,
      createdAt: 200,
      user: { id: memberId },
      rating: { id: lowRatingId },
    });
    const defaultTimestamp =
      await t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.guesses.submit,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: round.assignmentId,
          hostId,
          ratingId: highRatingId,
          today: "2026-07-24",
        },
      );
    expect(defaultTimestamp.id).toBe(created.id);
    expect(defaultTimestamp.createdAt).toBeGreaterThan(0);
    const grouped = await t.withIdentity(MEMBER_IDENTITY).query(
      api.games.guesses.mineForAssignments,
      { assignmentIds: [round.assignmentId] },
    );
    expect(grouped).toMatchObject([
      {
        assignmentId: round.assignmentId,
        guesses: [{ id: created.id }],
      },
    ]);
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.guesses.mineForAssignments,
        {
          assignmentIds: [
            round.assignmentId,
            round.assignmentId,
          ],
        },
      ),
      "VALIDATION_FAILED",
    );
    await t.run(async (ctx) => {
      const guesses = await ctx.db.query("guesses").collect();
      expect(guesses).toHaveLength(1);
      const auditEvents = await ctx.db.query("auditEvents").collect();
      expect(
        auditEvents.map((event) => event.action),
      ).toEqual(
        expect.arrayContaining([
          "games.member.guessCreated",
          "games.member.guessUpdated",
        ]),
      );
      const serializedAudit = JSON.stringify(auditEvents);
      expect(serializedAudit).not.toContain(
        `${MEMBER_IDENTITY.subject}@example.test`,
      );
      expect(serializedAudit).not.toContain("Guess Member");
      expect(serializedAudit).not.toContain("Guess Host");
    });
  });

  test("rejects locked rounds, invalid hosts, invalid timestamps, and dates without a season", async () => {
    const t = createTestBackend();
    const { adminId, hostId } = await seedActors(t);
    const { highRatingId } = await seedGameFoundation(t);
    const openRound = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId],
      ratingId: highRatingId,
      suffix: "2",
    });
    const lockedRound = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId],
      ratingId: highRatingId,
      suffix: "3",
      playable: false,
      episodeStatus: "published",
    });
    const missingEpisodeRound = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId],
      ratingId: highRatingId,
      suffix: "9",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(
        "episodes",
        missingEpisodeRound.episodeId,
      );
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.guesses.submit,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: lockedRound.assignmentId,
          hostId,
          ratingId: highRatingId,
          today: "2026-07-24",
        },
      ),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.guesses.submit,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: missingEpisodeRound.assignmentId,
          hostId,
          ratingId: highRatingId,
          today: "2026-07-24",
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.guesses.submit,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: openRound.assignmentId,
          hostId: adminId,
          ratingId: highRatingId,
          today: "2026-07-24",
        },
      ),
      "VALIDATION_FAILED",
      { reason: "INVALID_HOST" },
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.guesses.submit,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: openRound.assignmentId,
          hostId,
          ratingId: highRatingId,
          today: "2026-07-24",
          createdAt: 1.5,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.guesses.submit,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: openRound.assignmentId,
          hostId,
          ratingId: highRatingId,
          today: "2027-01-01",
        },
      ),
      "NOT_FOUND",
    );
  });

  test("supports administrator creation, batch upserts, pagination, and rating updates", async () => {
    const t = createTestBackend();
    const { adminId, memberId, otherId, hostId } =
      await seedActors(t);
    const {
      seasonId,
      highRatingId,
      lowRatingId,
    } = await seedGameFoundation(t);
    const round = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId, otherId],
      ratingId: highRatingId,
      suffix: "4",
    });
    await advanceToS3(t);

    const created = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.guesses.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        assignmentReviewId: requireFirst(
          round.assignmentReviewIds,
          "host assignment review",
        ),
        ratingId: highRatingId,
        seasonId,
        createdAt: 100,
      },
    );
    const upserted = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.guesses.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        assignmentReviewId: requireFirst(
          round.assignmentReviewIds,
          "host assignment review",
        ),
        ratingId: lowRatingId,
        seasonId,
        createdAt: 150,
      },
    );
    expect(upserted).toMatchObject({
      id: created.id,
      createdAt: 150,
      rating: { id: lowRatingId },
    });

    const batch = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.guesses.upsertForUser,
      {
        clientApiVersion: BBPC_API_VERSION,
        assignmentId: round.assignmentId,
        userId: memberId,
        today: "2026-07-24",
        guesses: [
          { hostId, ratingId: highRatingId },
          { hostId: otherId, ratingId: lowRatingId },
        ],
        createdAt: 200,
      },
    );
    expect(batch).toHaveLength(2);
    expect(batch.map((guess) => guess.user.id)).toEqual([
      memberId,
      memberId,
    ]);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.upsertForUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: round.assignmentId,
          userId: memberId,
          today: "2026-07-24",
          guesses: [
            { hostId, ratingId: highRatingId },
            { hostId, ratingId: lowRatingId },
          ],
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.upsertForUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: round.assignmentId,
          userId: memberId,
          today: "2026-07-24",
          guesses: [],
        },
      ),
      "VALIDATION_FAILED",
    );

    const assignmentGuesses =
      await t.withIdentity(ADMIN_IDENTITY).query(
        api.games.guesses.listForAssignment,
        { assignmentId: round.assignmentId },
      );
    expect(assignmentGuesses).toHaveLength(2);
    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.guesses.listForUserPage,
      {
        userId: memberId,
        season: { kind: "season", seasonId },
        paginationOpts: { numItems: 1, cursor: null },
      },
    );
    expect(page.page).toHaveLength(1);
    expect(page.isDone).toBe(false);
    const seasonPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.guesses.listForSeasonPage,
      {
        seasonId,
        paginationOpts: { numItems: 1, cursor: null },
      },
    );
    expect(seasonPage.page).toHaveLength(1);
    expect(seasonPage.isDone).toBe(false);
    const seasonPerformance =
      await t.withIdentity(ADMIN_IDENTITY).query(
        api.games.seasons.getPerformance,
        { seasonId },
      );
    expect(seasonPerformance.userSummary).toMatchObject([
      {
        user: { id: memberId },
        total: 0,
        guessCount: 2,
        gamblingCount: 0,
      },
    ]);
    const allPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.guesses.listForUserPage,
      {
        userId: memberId,
        season: { kind: "all" },
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(allPage.page).toHaveLength(2);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.guesses.listForUserPage,
        {
          userId: memberId,
          season: { kind: "all" },
          paginationOpts: { numItems: 0, cursor: null },
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.guesses.listForSeasonPage,
        {
          seasonId,
          paginationOpts: { numItems: 0, cursor: null },
        },
      ),
      "VALIDATION_FAILED",
    );

    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.guesses.updateRating,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: requireFirst(batch, "batch guess").id,
        ratingId: lowRatingId,
      },
    );
    expect(updated.rating.id).toBe(lowRatingId);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.updateRating,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: updated.id,
          ratingId: highRatingId,
          expectedRatingId: highRatingId,
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.guesses.getById,
        { id: updated.id },
      ),
    ).resolves.toMatchObject({ id: updated.id });
  });

  test("awards, validates, clears, and preserves points on single-guess deletion", async () => {
    const t = createTestBackend();
    const { adminId, memberId, otherId, hostId } =
      await seedActors(t);
    const {
      pointTypeId,
      seasonId,
      otherSeasonId,
      highRatingId,
    } = await seedGameFoundation(t);
    const round = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId],
      ratingId: highRatingId,
      suffix: "5",
    });
    await advanceToS3(t);
    const guess = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.guesses.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        assignmentReviewId: requireFirst(
          round.assignmentReviewIds,
          "host assignment review",
        ),
        ratingId: highRatingId,
        seasonId,
        createdAt: 100,
      },
    );

    const awarded = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.guesses.awardPoint,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: guess.id,
        adjustment: 2,
        reason: " Correct ",
        earnedAt: 200,
      },
    );
    expect(awarded).toMatchObject({
      point: {
        user: { id: memberId },
        season: { id: seasonId },
        gamePointType: { id: pointTypeId },
        reason: "Correct",
        adjustment: 2,
        total: 12,
      },
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.awardPoint,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: guess.id,
          adjustment: 0,
          reason: "Duplicate",
        },
      ),
      "CONFLICT",
    );

    const wrongUserPointId = await seedPoint(t, {
      userId: otherId,
      seasonId,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.setPoint,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: guess.id,
          pointId: wrongUserPointId,
        },
      ),
      "VALIDATION_FAILED",
    );
    const wrongSeasonPointId = await seedPoint(t, {
      userId: memberId,
      seasonId: otherSeasonId,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.setPoint,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: guess.id,
          pointId: wrongSeasonPointId,
        },
      ),
      "VALIDATION_FAILED",
    );
    const cleared = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.guesses.setPoint,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: guess.id,
        pointId: null,
      },
    );
    expect(cleared.point).toBeNull();
    const explicitAward =
      await t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.awardPoint,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: guess.id,
          adjustment: 0,
          reason: "Explicit type",
          gamePointTypeId: pointTypeId,
        },
      );
    expect(explicitAward.point?.gamePointType?.id).toBe(pointTypeId);
    const ownPointId = await seedPoint(t, { userId: memberId, seasonId });
    const linked = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.guesses.setPoint,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: guess.id,
        pointId: ownPointId,
      },
    );
    expect(linked.point?.id).toBe(ownPointId);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: guess.id,
          expected: {
            userId: linked.user.id,
            assignmentReviewId: linked.assignmentReview.id,
            ratingId: linked.rating.id,
            seasonId: linked.season.id,
            createdAt: linked.createdAt + 1,
            hasPoint: true,
          },
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: guess.id,
          expected: {
            userId: linked.user.id,
            assignmentReviewId: linked.assignmentReview.id,
            ratingId: linked.rating.id,
            seasonId: linked.season.id,
            createdAt: linked.createdAt,
            hasPoint: true,
          },
        },
      ),
    ).resolves.toEqual({ id: guess.id });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("guesses", guess.id)).toBeNull();
      expect(await ctx.db.get("points", ownPointId)).not.toBeNull();
      expect(
        await ctx.db.get(
          "points",
          requirePresent(awarded.point, "awarded point").id,
        ),
      ).not.toBeNull();
      expect(
        await ctx.db.get(
          "points",
          requirePresent(explicitAward.point, "explicit award point").id,
        ),
      ).not.toBeNull();
    });
  });

  test("bulk deletion removes orphan awards but retains points shared by another guess", async () => {
    const t = createTestBackend();
    const { adminId, memberId, hostId } = await seedActors(t);
    const { seasonId, highRatingId } =
      await seedGameFoundation(t);
    const firstRound = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId],
      ratingId: highRatingId,
      suffix: "6",
    });
    const secondRound = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId],
      ratingId: highRatingId,
      suffix: "7",
    });
    await advanceToS3(t);
    const sharedPointId = await seedPoint(t, {
      userId: memberId,
      seasonId,
    });
    const ids = await t.run(async (ctx) => {
      const firstGuessId = await ctx.db.insert("guesses", {
        userId: memberId,
        assignmentReviewId: requireFirst(
          firstRound.assignmentReviewIds,
          "first-round assignment review",
        ),
        ratingId: highRatingId,
        seasonId,
        pointId: sharedPointId,
        createdAt: 1,
      });
      const secondGuessId = await ctx.db.insert("guesses", {
        userId: memberId,
        assignmentReviewId: requireFirst(
          secondRound.assignmentReviewIds,
          "second-round assignment review",
        ),
        ratingId: highRatingId,
        seasonId,
        pointId: sharedPointId,
        createdAt: 2,
      });
      return { firstGuessId, secondGuessId };
    });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.removeForAssignmentUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: firstRound.assignmentId,
          userId: memberId,
        },
      ),
    ).resolves.toEqual({
      deletedGuesses: 1,
      deletedPoints: 0,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("guesses", ids.firstGuessId)).toBeNull();
      expect(await ctx.db.get("guesses", ids.secondGuessId)).not.toBeNull();
      expect(await ctx.db.get("points", sharedPointId)).not.toBeNull();
    });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.removeForAssignmentUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          assignmentId: secondRound.assignmentId,
          userId: memberId,
        },
      ),
    ).resolves.toEqual({
      deletedGuesses: 1,
      deletedPoints: 1,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("guesses", ids.secondGuessId)).toBeNull();
      expect(await ctx.db.get("points", sharedPointId)).toBeNull();
    });
  });

  test("fails closed on duplicate guesses and broken canonical relationships", async () => {
    const t = createTestBackend();
    const { adminId, memberId, hostId } = await seedActors(t);
    const { seasonId, highRatingId, lowRatingId } =
      await seedGameFoundation(t);
    const round = await seedAssignmentRound(t, {
      ownerId: adminId,
      hostIds: [hostId],
      ratingId: highRatingId,
      suffix: "8",
    });
    await advanceToS3(t);
    const guessIds = await t.run(async (ctx) => {
      const firstId = await ctx.db.insert("guesses", {
        userId: memberId,
        assignmentReviewId: requireFirst(
          round.assignmentReviewIds,
          "host assignment review",
        ),
        ratingId: highRatingId,
        seasonId,
        createdAt: 1,
      });
      const secondId = await ctx.db.insert("guesses", {
        userId: memberId,
        assignmentReviewId: requireFirst(
          round.assignmentReviewIds,
          "host assignment review",
        ),
        ratingId: highRatingId,
        seasonId,
        createdAt: 2,
      });
      return { firstId, secondId };
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.guesses.mineForAssignment,
        { assignmentId: round.assignmentId },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          assignmentReviewId: requireFirst(
            round.assignmentReviewIds,
            "host assignment review",
          ),
          ratingId: highRatingId,
          seasonId,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("guesses", guessIds.secondId);
      await ctx.db.delete("ratings", highRatingId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.guesses.getById,
        { id: guessIds.firstId },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.updateRating,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: guessIds.firstId,
          ratingId: highRatingId,
        },
      ),
      "NOT_FOUND",
    );
    await t.run(async (ctx) => {
      const missingPointId = await ctx.db.insert("points", {
        userId: memberId,
        seasonId,
        earnedAt: 1,
        adjustment: 0,
      });
      await ctx.db.patch("guesses", guessIds.firstId, {
        ratingId: lowRatingId,
        pointId: missingPointId,
      });
      await ctx.db.delete("points", missingPointId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.guesses.getById,
        { id: guessIds.firstId },
      ),
      "CONFLICT",
    );
    const assignmentReviewId = requireFirst(
      round.assignmentReviewIds,
      "host assignment review",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("guesses", guessIds.firstId, {
        pointId: undefined,
      });
      await ctx.db.delete(
        "assignmentReviews",
        assignmentReviewId,
      );
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          userId: memberId,
          assignmentReviewId,
          ratingId: lowRatingId,
          seasonId,
        },
      ),
      "NOT_FOUND",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("guesses", guessIds.firstId);
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.guesses.getById,
        { id: guessIds.firstId },
      ),
    ).resolves.toBeNull();
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.guesses.updateRating,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: guessIds.firstId,
          ratingId: lowRatingId,
        },
      ),
      "NOT_FOUND",
    );
  });
});
