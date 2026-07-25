/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "gambling-api-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|gambling-admin",
  issuer: "https://issuer.example.test",
  subject: "gambling-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|gambling-member",
  issuer: "https://issuer.example.test",
  subject: "gambling-member",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|gambling-other",
  issuer: "https://issuer.example.test",
  subject: "gambling-other",
};
const HOST_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|gambling-host",
  issuer: "https://issuer.example.test",
  subject: "gambling-host",
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

function requirePresent<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${label}`);
  }
  return value;
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
    name: "Gambling Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Gambling Member",
  });
  const otherId = await seedUser(t, {
    identity: OTHER_IDENTITY,
    name: "Gambling Other",
  });
  const hostId = await seedUser(t, {
    identity: HOST_IDENTITY,
    name: "Gambling Host",
  });
  return { adminId, memberId, otherId, hostId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "gambling-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "gambling-api-test",
  });
}

async function advanceFromS1ToS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "gambling-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "gambling-api-test",
    approvedBackupId: "gambling-api-backup",
    approvedBackupChecksum: "sha256:gambling-api",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await advanceFromS1ToS3(t);
}

async function seedFoundation(t: TestBackend) {
  return await t.run(async (ctx) => {
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
    const pastSeasonId = await ctx.db.insert("seasons", {
      title: "Past season",
      gameTypeId,
      startedOn: "2025-01-01",
      endedOn: "2025-12-31",
    });
    const ratingId = await ctx.db.insert("ratings", {
      name: "Excellent",
      value: 5,
    });
    const defaultTypeId = await ctx.db.insert("gamblingTypes", {
      lookupId: "default",
      normalizedLookupId: "default",
      title: "Default wager",
      multiplier: 1.5,
      isActive: true,
      createdAt: 100,
    });
    const targetTypeId = await ctx.db.insert("gamblingTypes", {
      lookupId: "host-rating-guess-1x",
      normalizedLookupId: "host-rating-guess-1x",
      title: "Targeted wager",
      multiplier: 2,
      isActive: true,
      createdAt: 200,
    });
    const alternateTypeId = await ctx.db.insert("gamblingTypes", {
      lookupId: "alternate",
      normalizedLookupId: "alternate",
      title: "Alternate wager",
      multiplier: 3,
      isActive: true,
      createdAt: 300,
    });
    const inactiveTypeId = await ctx.db.insert("gamblingTypes", {
      lookupId: "inactive",
      normalizedLookupId: "inactive",
      title: "Inactive wager",
      multiplier: 1,
      isActive: false,
      createdAt: 400,
    });
    return {
      gameTypeId,
      seasonId,
      pastSeasonId,
      ratingId,
      defaultTypeId,
      targetTypeId,
      alternateTypeId,
      inactiveTypeId,
    };
  });
}

async function seedRound(
  t: TestBackend,
  input: {
    ownerId: Id<"users">;
    hostId: Id<"users">;
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
      episodeId,
      movieId,
      type: "HOMEWORK",
      playable: input.playable ?? true,
      slug: `assignment-${input.suffix}`,
      normalizedSlug: `assignment-${input.suffix}`,
    });
    const reviewId = await ctx.db.insert("reviews", {
      userId: input.hostId,
      movieId,
      ratingId: input.ratingId,
      reviewedAt: 1,
    });
    const assignmentReviewId = await ctx.db.insert("assignmentReviews", {
      assignmentId,
      reviewId,
    });
    return {
      assignmentId,
      assignmentReviewId,
      episodeId,
      movieId,
    };
  });
}

async function seedBalance(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    seasonId: Id<"seasons">;
    adjustment: number;
  },
): Promise<Id<"points">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("points", {
      userId: input.userId,
      seasonId: input.seasonId,
      adjustment: input.adjustment,
      earnedAt: 1,
    });
  });
}

describe("gambling API", () => {
  test("derives the current user's episode-win banner", async () => {
    const t = createTestBackend();
    const { memberId, otherId, hostId } = await seedActors(t);
    const { ratingId, seasonId, defaultTypeId } = await seedFoundation(t);
    const round = await seedRound(t, {
      ownerId: hostId,
      hostId,
      ratingId,
      suffix: "15",
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("gamblingEntries", {
        userId: memberId,
        assignmentId: round.assignmentId,
        points: 5,
        createdAt: 1,
        gamblingTypeId: defaultTypeId,
        seasonId,
        status: "won",
      });
      await ctx.db.insert("gamblingEntries", {
        userId: otherId,
        assignmentId: round.assignmentId,
        points: 5,
        createdAt: 2,
        gamblingTypeId: defaultTypeId,
        seasonId,
        status: "lost",
      });
    });
    const missingEpisodeId = await t.run(async (ctx) => {
      const episodeId = await ctx.db.insert("episodes", {
        number: 16,
        title: "Deleted episode",
      });
      await ctx.db.delete("episodes", episodeId);
      return episodeId;
    });
    await initializeS1(t);

    await expect(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.gambling.hasWonForEpisode, {
          episodeId: round.episodeId,
        }),
    ).resolves.toBe(true);
    await expect(
      t
        .withIdentity(OTHER_IDENTITY)
        .query(api.games.gambling.hasWonForEpisode, {
          episodeId: round.episodeId,
        }),
    ).resolves.toBe(false);
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.gambling.hasWonForEpisode, {
          episodeId: missingEpisodeId,
        }),
      "NOT_FOUND",
    );
  });

  test("keeps active types public and gates administrator type management", async () => {
    const t = createTestBackend();
    const { adminId } = await seedActors(t);
    const { inactiveTypeId } = await seedFoundation(t);

    const publicTypes = await t.query(api.games.gambling.listActiveTypes, {});
    expect(publicTypes).toHaveLength(3);
    expect(publicTypes.map((type) => type.createdAt)).toEqual([300, 200, 100]);
    expect(publicTypes.some((type) => type.id === inactiveTypeId)).toBe(false);
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(api.games.gambling.listTypes, {}),
      "FORBIDDEN",
    );

    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.createType, {
        clientApiVersion: BBPC_API_VERSION,
        title: "New type",
        lookupId: "new-type",
      }),
      "WRITE_DISABLED",
    );
    await advanceFromS1ToS3(t);
    const created = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.createType, {
        clientApiVersion: BBPC_API_VERSION,
        title: " New type ",
        lookupId: " NEW-TYPE ",
        description: " Description ",
        createdAt: 500,
      });
    expect(created).toMatchObject({
      title: "New type",
      lookupId: "NEW-TYPE",
      description: "Description",
      multiplier: 1.5,
      isActive: true,
      createdAt: 500,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.createType, {
        clientApiVersion: BBPC_API_VERSION,
        title: "Collision",
        lookupId: "new-type",
      }),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.createType, {
        clientApiVersion: BBPC_API_VERSION,
        title: "Invalid",
        lookupId: "invalid",
        multiplier: -1,
      }),
      "VALIDATION_FAILED",
    );
    const updated = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.updateType, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        title: "Renamed type",
        lookupId: "renamed-type",
        description: null,
        multiplier: 2.25,
        isActive: false,
      });
    expect(updated).toMatchObject({
      title: "Renamed type",
      lookupId: "renamed-type",
      description: null,
      multiplier: 2.25,
      isActive: false,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.updateType, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
    ).resolves.toEqual(updated);
    const referenceId = await t.run(async (ctx) => {
      return await ctx.db.insert("gamblingEntries", {
        userId: adminId,
        points: 0,
        createdAt: 1,
        gamblingTypeId: created.id,
        status: "pending",
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.removeType, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("gamblingEntries", referenceId);
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.removeType, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
    ).resolves.toEqual({ id: created.id });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.gambling.getTypeById, { id: created.id }),
    ).resolves.toBeNull();
  });

  test("derives member ownership and idempotently upserts the canonical wager key", async () => {
    const t = createTestBackend();
    const { adminId, memberId, hostId } = await seedActors(t);
    const { seasonId, ratingId, defaultTypeId } = await seedFoundation(t);
    const round = await seedRound(t, {
      ownerId: adminId,
      hostId,
      ratingId,
      suffix: "1",
    });
    await seedBalance(t, {
      userId: memberId,
      seasonId,
      adjustment: 30,
    });
    await advanceToS3(t);

    const created = await t
      .withIdentity(MEMBER_IDENTITY)
      .mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        points: 10,
        assignmentId: round.assignmentId,
        today: "2026-07-24",
        createdAt: 1000,
      });
    expect(created).toMatchObject({
      points: 10,
      createdAt: 1000,
      status: "pending",
      user: { id: memberId },
      gamblingType: { id: defaultTypeId },
      assignment: { id: round.assignmentId },
      targetUser: null,
      season: { id: seasonId },
      awardPoint: null,
    });
    const updated = await t
      .withIdentity(MEMBER_IDENTITY)
      .mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        points: 20,
        assignmentId: round.assignmentId,
        today: "2026-07-24",
        createdAt: 9999,
      });
    expect(updated).toMatchObject({
      id: created.id,
      points: 20,
      createdAt: 1000,
    });
    await expect(
      t
        .withIdentity(OTHER_IDENTITY)
        .query(api.games.gambling.mineForAssignment, {
          assignmentId: round.assignmentId,
        }),
    ).resolves.toEqual([]);
    const mine = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.gambling.mineForAssignment, {
        assignmentId: round.assignmentId,
      });
    expect(mine).toMatchObject([{ id: created.id }]);
    const grouped = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.gambling.mineForAssignments, {
        assignmentIds: [round.assignmentId],
      });
    expect(grouped).toMatchObject([
      {
        assignmentId: round.assignmentId,
        entries: [{ id: created.id }],
      },
    ]);
    const byDefaultType = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.gambling.mineForType, {});
    expect(byDefaultType).toMatchObject([{ id: created.id }]);
    const active = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.gambling.mineForActiveTypes, {});
    expect(active).toMatchObject([{ id: created.id }]);
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.gambling.mineForAssignments, {
          assignmentIds: [round.assignmentId, round.assignmentId],
        }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        points: 31,
        assignmentId: round.assignmentId,
        today: "2026-07-24",
      }),
      "CONFLICT",
      { reason: "INSUFFICIENT_POINTS" },
    );
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("gamblingEntries").collect();
      expect(rows).toHaveLength(1);
      const audits = await ctx.db.query("auditEvents").collect();
      expect(audits.map((event) => event.action)).toEqual(
        expect.arrayContaining([
          "games.member.gamblingEntryCreated",
          "games.member.gamblingEntryUpdated",
        ]),
      );
      const serialized = JSON.stringify(audits);
      expect(serialized).not.toContain("Gambling Member");
      expect(serialized).not.toContain(
        `${MEMBER_IDENTITY.subject}@example.test`,
      );
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("gamblingEntries", {
        userId: memberId,
        points: 1,
        createdAt: 2,
        seasonId,
        gamblingTypeId: defaultTypeId,
        assignmentId: round.assignmentId,
        status: "pending",
      });
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        points: 1,
        assignmentId: round.assignmentId,
        today: "2026-07-24",
      }),
      "CONFLICT",
    );
  });

  test("enforces active types, open rounds, target shape, and host eligibility", async () => {
    const t = createTestBackend();
    const { adminId, memberId, otherId, hostId } = await seedActors(t);
    const { seasonId, ratingId, defaultTypeId, targetTypeId, inactiveTypeId } =
      await seedFoundation(t);
    const openRound = await seedRound(t, {
      ownerId: adminId,
      hostId,
      ratingId,
      suffix: "2",
    });
    const lockedRound = await seedRound(t, {
      ownerId: adminId,
      hostId,
      ratingId,
      suffix: "3",
      episodeStatus: "published",
    });
    await seedBalance(t, {
      userId: memberId,
      seasonId,
      adjustment: 100,
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: inactiveTypeId,
        points: 1,
        today: "2026-07-24",
      }),
      "CONFLICT",
      { reason: "WAGER_TYPE_UNAVAILABLE" },
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: targetTypeId,
        points: 1,
        assignmentId: openRound.assignmentId,
        today: "2026-07-24",
      }),
      "VALIDATION_FAILED",
      { reason: "INVALID_HOST" },
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: targetTypeId,
        points: 1,
        targetUserId: hostId,
        today: "2026-07-24",
      }),
      "VALIDATION_FAILED",
      { reason: "INVALID_HOST" },
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: defaultTypeId,
        points: 1,
        assignmentId: openRound.assignmentId,
        targetUserId: hostId,
        today: "2026-07-24",
      }),
      "VALIDATION_FAILED",
      { reason: "INVALID_HOST" },
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: targetTypeId,
        points: 1,
        assignmentId: openRound.assignmentId,
        targetUserId: otherId,
        today: "2026-07-24",
      }),
      "VALIDATION_FAILED",
      { reason: "INVALID_HOST" },
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: defaultTypeId,
        points: 1,
        assignmentId: lockedRound.assignmentId,
        today: "2026-07-24",
      }),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );
    const targeted = await t
      .withIdentity(MEMBER_IDENTITY)
      .mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: targetTypeId,
        points: 10,
        assignmentId: openRound.assignmentId,
        targetUserId: hostId,
        today: "2026-07-24",
      });
    expect(targeted.targetUser?.id).toBe(hostId);
    await t.run(async (ctx) => {
      await ctx.db.patch("gamblingEntries", targeted.id, {
        status: "locked",
      });
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: targetTypeId,
        points: 5,
        assignmentId: openRound.assignmentId,
        targetUserId: hostId,
        today: "2026-07-24",
      }),
      "CONFLICT",
      { reason: "WAGER_LOCKED" },
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        points: -1,
        today: "2026-07-24",
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        points: 1,
        today: "2027-01-01",
      }),
      "NOT_FOUND",
    );
  });

  test("serializes concurrent wagers against one available balance", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const { seasonId, defaultTypeId, alternateTypeId } =
      await seedFoundation(t);
    await seedBalance(t, {
      userId: memberId,
      seasonId,
      adjustment: 30,
    });
    await advanceToS3(t);

    const results = await Promise.allSettled([
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: defaultTypeId,
        points: 20,
        today: "2026-07-24",
      }),
      t.withIdentity(MEMBER_IDENTITY).mutation(api.games.gambling.submit, {
        clientApiVersion: BBPC_API_VERSION,
        gamblingTypeId: alternateTypeId,
        points: 20,
        today: "2026-07-24",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    await expect(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.member.myAvailablePoints, {
          season: { kind: "season", seasonId },
        }),
    ).resolves.toBe(10);
  });

  test("supports administrator creation, indexed reads, updates, and pending deletion", async () => {
    const t = createTestBackend();
    const { adminId, memberId, hostId } = await seedActors(t);
    const { seasonId, ratingId, defaultTypeId } = await seedFoundation(t);
    const round = await seedRound(t, {
      ownerId: adminId,
      hostId,
      ratingId,
      suffix: "4",
    });
    await seedBalance(t, {
      userId: memberId,
      seasonId,
      adjustment: 50,
    });
    await advanceToS3(t);

    const created = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.create, {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        points: 10,
        season: { kind: "season", seasonId },
        assignmentId: round.assignmentId,
        notes: " Note ",
        createdAt: 100,
      });
    expect(created).toMatchObject({
      user: { id: memberId },
      gamblingType: { id: defaultTypeId },
      notes: "Note",
      points: 10,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.create, {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        points: 10,
        season: { kind: "season", seasonId },
        assignmentId: round.assignmentId,
      }),
      "CONFLICT",
    );
    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.gambling.getById, { id: created.id }),
      "FORBIDDEN",
    );
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.gambling.getById, { id: created.id }),
    ).resolves.toMatchObject({ id: created.id });
    const assignmentEntries = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.gambling.listForAssignment, {
        assignmentId: round.assignmentId,
      });
    expect(assignmentEntries).toMatchObject([{ id: created.id }]);
    const typePage = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.gambling.listForTypePage, {
        gamblingTypeId: defaultTypeId,
        paginationOpts: { numItems: 10, cursor: null },
      });
    expect(typePage.page).toMatchObject([{ id: created.id }]);
    const userPage = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.gambling.listForUserPage, {
        userId: memberId,
        season: { kind: "season", seasonId },
        paginationOpts: { numItems: 10, cursor: null },
      });
    expect(userPage.page).toMatchObject([{ id: created.id }]);
    const seasonPage = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.gambling.listForSeasonPage, {
        seasonId,
        paginationOpts: { numItems: 10, cursor: null },
      });
    expect(seasonPage.page).toMatchObject([{ id: created.id }]);
    const seasonPerformance = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.seasons.getPerformance, { seasonId });
    expect(
      seasonPerformance.userSummary.find(
        (summary) => summary.user.id === memberId,
      ),
    ).toMatchObject({ user: { id: memberId }, gamblingCount: 1 });
    const allPage = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.gambling.listForUserPage, {
        userId: memberId,
        season: { kind: "all" },
        paginationOpts: { numItems: 10, cursor: null },
      });
    expect(allPage.page).toHaveLength(1);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(api.games.gambling.listForUserPage, {
        userId: memberId,
        season: { kind: "all" },
        paginationOpts: { numItems: 0, cursor: null },
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.gambling.listForSeasonPage, {
          seasonId,
          paginationOpts: { numItems: 0, cursor: null },
        }),
      "VALIDATION_FAILED",
    );
    const updated = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.updatePoints, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        points: 25,
      });
    expect(updated.points).toBe(25);
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
      }),
    ).resolves.toEqual({ id: created.id });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.gambling.getById, { id: created.id }),
    ).resolves.toBeNull();
  });

  test("creates and recalculates win/loss awards across status transitions", async () => {
    const t = createTestBackend();
    const { adminId, memberId, hostId } = await seedActors(t);
    const { seasonId, ratingId, alternateTypeId } = await seedFoundation(t);
    const round = await seedRound(t, {
      ownerId: adminId,
      hostId,
      ratingId,
      suffix: "5",
    });
    await seedBalance(t, {
      userId: memberId,
      seasonId,
      adjustment: 100,
    });
    await advanceToS3(t);
    const entry = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.create, {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        points: 5,
        season: { kind: "season", seasonId },
        assignmentId: round.assignmentId,
      });

    const won = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.confirm, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        earnedAt: 200,
      });
    expect(won).toMatchObject({
      status: "won",
      awardPoint: {
        adjustment: 7,
        reason: "Gamble win: Default wager",
        earnedAt: 200,
      },
    });
    const firstAwardId = requirePresent(won.awardPoint, "win award").id;
    const sameWin = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.confirm, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
      });
    expect(sameWin.awardPoint?.id).toBe(firstAwardId);
    const resizedWin = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.updatePoints, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        points: 7,
      });
    expect(resizedWin.awardPoint).toMatchObject({
      id: firstAwardId,
      adjustment: 10,
    });

    const lost = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.updateStatus, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        status: "lost",
        expectedStatus: "won",
        earnedAt: 300,
      });
    expect(lost).toMatchObject({
      status: "lost",
      awardPoint: {
        adjustment: -7,
        reason: "Gamble loss: Default wager",
        earnedAt: 300,
      },
    });
    const lossAwardId = requirePresent(lost.awardPoint, "loss award").id;
    expect(lossAwardId).not.toBe(firstAwardId);
    await t.run(async (ctx) => {
      expect(await ctx.db.get("points", firstAwardId)).toBeNull();
    });
    const resizedLoss = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.updatePoints, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        points: 8,
      });
    expect(resizedLoss.awardPoint).toMatchObject({
      id: lossAwardId,
      adjustment: -8,
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .mutation(api.games.gambling.updateStatus, {
          clientApiVersion: BBPC_API_VERSION,
          id: entry.id,
          status: "pending",
          expectedStatus: "won",
        }),
      "CONFLICT",
    );
    const pending = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.updateStatus, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        status: "pending",
        expectedStatus: "lost",
      });
    expect(pending).toMatchObject({
      status: "pending",
      awardPoint: null,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("points", lossAwardId)).toBeNull();
    });
    const rejected = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.updateStatus, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        status: "rejected",
      });
    expect(rejected.status).toBe("rejected");
    const alternateEntry = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.create, {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        gamblingTypeId: alternateTypeId,
        points: 3,
        season: { kind: "season", seasonId },
        assignmentId: round.assignmentId,
      });
    const rejectedAsLoss = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.reject, {
        clientApiVersion: BBPC_API_VERSION,
        id: alternateEntry.id,
      });
    expect(rejectedAsLoss).toMatchObject({
      status: "lost",
      awardPoint: { adjustment: -3 },
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
      }),
      "CONFLICT",
    );
  });

  test("validates manual award links and fails closed on shared award deletion", async () => {
    const t = createTestBackend();
    const { adminId, memberId, otherId, hostId } = await seedActors(t);
    const { seasonId, pastSeasonId, ratingId, alternateTypeId } =
      await seedFoundation(t);
    const round = await seedRound(t, {
      ownerId: adminId,
      hostId,
      ratingId,
      suffix: "6",
    });
    await seedBalance(t, {
      userId: memberId,
      seasonId,
      adjustment: 100,
    });
    await advanceToS3(t);
    const entry = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.create, {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        points: 5,
        season: { kind: "season", seasonId },
        assignmentId: round.assignmentId,
      });
    const wrongUserPoint = await seedBalance(t, {
      userId: otherId,
      seasonId,
      adjustment: 1,
    });
    const wrongSeasonPoint = await seedBalance(t, {
      userId: memberId,
      seasonId: pastSeasonId,
      adjustment: 1,
    });
    for (const pointId of [wrongUserPoint, wrongSeasonPoint]) {
      await expectDomainError(
        t
          .withIdentity(ADMIN_IDENTITY)
          .mutation(api.games.gambling.setAwardPoint, {
            clientApiVersion: BBPC_API_VERSION,
            id: entry.id,
            pointId,
          }),
        "VALIDATION_FAILED",
      );
    }
    const ownPoint = await seedBalance(t, {
      userId: memberId,
      seasonId,
      adjustment: 1,
    });
    const linked = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.setAwardPoint, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        pointId: ownPoint,
      });
    expect(linked.awardPoint?.id).toBe(ownPoint);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
      }),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("gamblingEntries", {
        userId: memberId,
        points: 1,
        createdAt: 2,
        seasonId,
        gamblingTypeId: alternateTypeId,
        status: "pending",
        awardPointId: ownPoint,
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.updateStatus, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        status: "won",
      }),
      "CONFLICT",
    );
    const cleared = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.setAwardPoint, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
        pointId: null,
      });
    expect(cleared.awardPoint).toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.remove, {
        clientApiVersion: BBPC_API_VERSION,
        id: entry.id,
      }),
    ).resolves.toEqual({ id: entry.id });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("points", ownPoint)).not.toBeNull();
    });
  });

  test("resolves a migrated seasonless wager only with an explicit season and rejects broken rows", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const { seasonId, defaultTypeId } = await seedFoundation(t);
    await advanceToS3(t);
    const entryId = await t.run(async (ctx) => {
      return await ctx.db.insert("gamblingEntries", {
        userId: memberId,
        points: 4,
        createdAt: 1,
        gamblingTypeId: defaultTypeId,
        status: "pending",
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.updatePoints, {
        clientApiVersion: BBPC_API_VERSION,
        id: entryId,
        points: 3,
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.confirm, {
        clientApiVersion: BBPC_API_VERSION,
        id: entryId,
      }),
      "VALIDATION_FAILED",
    );
    const won = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.confirm, {
        clientApiVersion: BBPC_API_VERSION,
        id: entryId,
        season: { kind: "season", seasonId },
      });
    expect(won).toMatchObject({
      status: "won",
      season: { id: seasonId },
      awardPoint: { adjustment: 6 },
    });
    const awardPointId = requirePresent(
      won.awardPoint,
      "migrated wager award",
    ).id;
    await t.run(async (ctx) => {
      await ctx.db.delete("points", awardPointId);
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.gambling.getById, { id: entryId }),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("gamblingEntries", entryId, {
        awardPointId: undefined,
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.updatePoints, {
        clientApiVersion: BBPC_API_VERSION,
        id: entryId,
        points: 5,
      }),
      "CONFLICT",
    );
    const repaired = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.games.gambling.updateStatus, {
        clientApiVersion: BBPC_API_VERSION,
        id: entryId,
        status: "won",
      });
    expect(repaired.awardPoint).toMatchObject({ adjustment: 6 });
    await t.run(async (ctx) => {
      await ctx.db.patch("gamblingEntries", entryId, {
        awardPointId: undefined,
        status: "unsupported",
      });
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.gambling.getById, { id: entryId }),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("users", memberId);
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.gambling.getById, { id: entryId }),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("gamblingEntries", entryId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.games.gambling.updatePoints, {
        clientApiVersion: BBPC_API_VERSION,
        id: entryId,
        points: 1,
      }),
      "NOT_FOUND",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("gamblingTypes", defaultTypeId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(api.games.gambling.listForTypePage, {
        gamblingTypeId: defaultTypeId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
      "NOT_FOUND",
    );
  });
});
