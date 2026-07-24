/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "review-rating-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|review-admin",
  issuer: "https://issuer.example.test",
  subject: "review-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|review-member",
  issuer: "https://issuer.example.test",
  subject: "review-member",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|review-other",
  issuer: "https://issuer.example.test",
  subject: "review-other",
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
    name: "Review Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Review Member",
  });
  const otherId = await seedUser(t, {
    identity: OTHER_IDENTITY,
    name: "Review Other",
  });
  return { adminId, memberId, otherId };
}

async function seedMovie(
  t: TestBackend,
  suffix: string,
): Promise<Id<"movies">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("movies", {
      title: `Movie ${suffix}`,
      normalizedTitle: `movie ${suffix}`.toLowerCase(),
      year: 2000,
      poster: `https://images.example.test/movie-${suffix}.jpg`,
      url: `https://catalog.example.test/movie-${suffix}`,
    });
  });
}

async function seedShow(
  t: TestBackend,
  suffix: string,
): Promise<Id<"shows">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("shows", {
      title: `Show ${suffix}`,
      normalizedTitle: `show ${suffix}`.toLowerCase(),
      year: 2001,
      poster: `https://images.example.test/show-${suffix}.jpg`,
      url: `https://catalog.example.test/show-${suffix}`,
    });
  });
}

async function seedEpisode(
  t: TestBackend,
  number: number,
): Promise<Id<"episodes">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("episodes", {
      number,
      title: `Episode ${String(number)}`,
      status: "pending",
      slug: `episode-${String(number)}`,
      normalizedSlug: `episode-${String(number)}`,
    });
  });
}

async function seedRating(
  t: TestBackend,
  input: { name?: string; value?: number } = {},
): Promise<Id<"ratings">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("ratings", {
      name: input.name ?? "Excellent",
      value: input.value ?? 5,
      sound: "sound",
      icon: "icon",
      category: "positive",
    });
  });
}

async function seedAssignment(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    movieId: Id<"movies">;
    episodeId: Id<"episodes">;
  },
): Promise<Id<"assignments">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("assignments", {
      ...input,
      type: "HOMEWORK",
      playable: false,
    });
  });
}

async function seedReview(
  t: TestBackend,
  input: {
    userId?: Id<"users">;
    movieId?: Id<"movies">;
    showId?: Id<"shows">;
    ratingId?: Id<"ratings">;
    reviewedAt?: number;
  },
): Promise<Id<"reviews">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("reviews", {
      ...(input.userId === undefined
        ? {}
        : { userId: input.userId }),
      ...(input.movieId === undefined
        ? {}
        : { movieId: input.movieId }),
      ...(input.showId === undefined
        ? {}
        : { showId: input.showId }),
      ...(input.ratingId === undefined
        ? {}
        : { ratingId: input.ratingId }),
      reviewedAt: input.reviewedAt ?? 1,
    });
  });
}

async function seedAssignmentReview(
  t: TestBackend,
  input: {
    assignmentId: Id<"assignments">;
    reviewId: Id<"reviews">;
  },
): Promise<Id<"assignmentReviews">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("assignmentReviews", input);
  });
}

async function seedSeason(
  t: TestBackend,
): Promise<Id<"seasons">> {
  return await t.run(async (ctx) => {
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title: "Predictions",
      lookupId: "predictions",
      normalizedLookupId: "predictions",
    });
    return await ctx.db.insert("seasons", {
      title: "Season",
      gameTypeId,
      startedOn: "2026-01-01",
    });
  });
}

async function seedGuess(
  t: TestBackend,
  input: {
    ratingId: Id<"ratings">;
    userId: Id<"users">;
    assignmentReviewId: Id<"assignmentReviews">;
    seasonId: Id<"seasons">;
  },
): Promise<Id<"guesses">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("guesses", {
      ...input,
      createdAt: 1,
    });
  });
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "review-rating-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "review-rating-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "review-rating-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "review-rating-test",
    approvedBackupId: "review-rating-backup",
    approvedBackupChecksum: "sha256:review-rating",
  });
}

describe("rating and review API", () => {
  test("keeps rating reads public while administrator and owner writes remain gated", async () => {
    const t = createTestBackend();
    await seedActors(t);
    const ratingId = await seedRating(t);
    const movieId = await seedMovie(t, "access");
    const episodeId = await seedEpisode(t, 1);

    await expect(
      t.query(api.ratings.public.getById, { id: ratingId }),
    ).resolves.toMatchObject({ id: ratingId, value: 5 });
    await expect(
      t.query(api.ratings.public.list, {}),
    ).resolves.toHaveLength(1);
    await expectDomainError(
      t.query(api.ratings.admin.getById, { id: ratingId }),
      "AUTHENTICATION_REQUIRED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.ratings.admin.list,
        {},
      ),
      "FORBIDDEN",
    );
    await initializeS1(t);
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.ratings.admin.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Blocked",
          value: 1,
        },
      ),
      "WRITE_DISABLED",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.reviews.mine.addMovieExtra,
        {
          clientApiVersion: BBPC_API_VERSION,
          movieId,
          episodeId,
        },
      ),
      "WRITE_DISABLED",
    );
  });

  test("creates, updates, clears, orders, and safely deletes ratings", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);

    const high = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.ratings.admin.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        name: "  Great  ",
        value: 9,
        sound: " sound ",
        icon: " star ",
        category: " positive ",
      },
    );
    const duplicate = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.ratings.admin.create,
      {
        clientApiVersion: BBPC_API_VERSION,
        name: "Also Great",
        value: 9,
      },
    );
    expect(high).toMatchObject({
      name: "Great",
      value: 9,
      sound: "sound",
      icon: "star",
      category: "positive",
    });
    expect(duplicate.id).not.toBe(high.id);
    await expect(
      t.query(api.ratings.public.getByValue, { value: 9 }),
    ).resolves.not.toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.ratings.admin.getById,
        { id: high.id },
      ),
    ).resolves.toMatchObject({ id: high.id });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.ratings.admin.list,
        {},
      ),
    ).resolves.toHaveLength(2);
    await expect(
      t.query(api.ratings.public.getByValue, { value: 8 }),
    ).resolves.toBeNull();

    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.ratings.admin.update,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: high.id,
        name: "Excellent",
        value: 10,
        sound: null,
        icon: "",
        category: null,
      },
    );
    expect(updated).toMatchObject({
      name: "Excellent",
      value: 10,
      sound: null,
      icon: null,
      category: null,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.ratings.admin.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: high.id,
        },
      ),
    ).resolves.toEqual(updated);
    const listed = await t.query(api.ratings.public.list, {});
    expect(listed.map((rating) => rating.value)).toEqual([10, 9]);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.ratings.admin.create,
        {
          clientApiVersion: BBPC_API_VERSION,
          name: "Invalid",
          value: 256,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.ratings.admin.update,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: high.id,
          name: " ",
        },
      ),
      "VALIDATION_FAILED",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.ratings.admin.removeIfUnreferenced,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: duplicate.id,
        },
      ),
    ).resolves.toEqual({ id: duplicate.id });
    await expect(
      t.query(api.ratings.public.getById, { id: duplicate.id }),
    ).resolves.toBeNull();
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.ratings.admin.getById,
        { id: duplicate.id },
      ),
    ).resolves.toBeNull();
  });

  test("refuses rating deletion while reviews or guesses reference it", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const ratingId = await seedRating(t);
    const movieId = await seedMovie(t, "rating-reference");
    const episodeId = await seedEpisode(t, 2);
    const assignmentId = await seedAssignment(t, {
      userId: memberId,
      movieId,
      episodeId,
    });
    const reviewId = await seedReview(t, {
      userId: memberId,
      movieId,
      ratingId,
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.ratings.admin.removeIfUnreferenced,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: ratingId,
        },
      ),
      "CONFLICT",
      { relationship: "review" },
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("reviews", reviewId);
    });
    const guessReviewId = await seedReview(t, {
      userId: memberId,
      movieId,
    });
    const linkId = await seedAssignmentReview(t, {
      assignmentId,
      reviewId: guessReviewId,
    });
    const seasonId = await seedSeason(t);
    const guessId = await seedGuess(t, {
      ratingId,
      userId: memberId,
      assignmentReviewId: linkId,
      seasonId,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.ratings.admin.removeIfUnreferenced,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: ratingId,
        },
      ),
      "CONFLICT",
      { relationship: "guess" },
    );
    await t.run(async (ctx) => {
      await ctx.db.delete("guesses", guessId);
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.ratings.admin.removeIfUnreferenced,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: ratingId,
        },
      ),
    ).resolves.toEqual({ id: ratingId });
  });

  test("derives the self-service reviewer and supports movie and show extras", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const movieId = await seedMovie(t, "mine");
    const showId = await seedShow(t, "mine");
    const episodeId = await seedEpisode(t, 3);
    await advanceToS3(t);

    const movieExtra = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.reviews.mine.addMovieExtra,
      {
        clientApiVersion: BBPC_API_VERSION,
        movieId,
        episodeId,
      },
    );
    const showExtra = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.reviews.mine.addShowExtra,
      {
        clientApiVersion: BBPC_API_VERSION,
        showId,
        episodeId,
      },
    );
    expect(movieExtra.review).toMatchObject({
      user: { id: memberId },
      movie: { id: movieId },
      show: null,
      rating: null,
    });
    expect(showExtra.review).toMatchObject({
      user: { id: memberId },
      movie: null,
      show: { id: showId },
    });

    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.reviews.admin.listExtrasForEpisode,
      {
        episodeId,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(page.page).toHaveLength(2);
    expect(
      page.page.every((extra) => extra.review.user?.id === memberId),
    ).toBe(true);
    const auditEvents = await t.run(async (ctx) => {
      return await ctx.db.query("auditEvents").take(100);
    });
    const ownerEvents = auditEvents.filter(
      (event) => event.action === "reviews.owner.extraCreated",
    );
    expect(ownerEvents).toHaveLength(2);
    expect(ownerEvents.map((event) => event.metadata)).toEqual(
      expect.arrayContaining([
        { targetType: "movie" },
        { targetType: "show" },
      ]),
    );
  });

  test("validates admin review targets and derives assignment movie relationships", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const movieId = await seedMovie(t, "admin");
    const deletedMovieId = await seedMovie(t, "deleted");
    const showId = await seedShow(t, "admin");
    const episodeId = await seedEpisode(t, 4);
    const assignmentId = await seedAssignment(t, {
      userId: memberId,
      movieId,
      episodeId,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("movies", deletedMovieId);
    });
    await advanceToS3(t);

    const common = {
      clientApiVersion: BBPC_API_VERSION,
      userId: otherId,
      episodeId,
    };
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.createExtra,
        {
          ...common,
          movieId,
          showId,
        },
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.createExtra,
        common,
      ),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.createExtra,
        {
          ...common,
          movieId: deletedMovieId,
        },
      ),
      "NOT_FOUND",
    );
    const linked = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.reviews.admin.createForAssignment,
      {
        clientApiVersion: BBPC_API_VERSION,
        assignmentId,
        userId: otherId,
      },
    );
    expect(linked).toMatchObject({
      assignment: { id: assignmentId },
      review: {
        user: { id: otherId },
        movie: { id: movieId },
        show: null,
      },
    });
  });

  test("supports indexed review filters, native relationship pages, exact reads, and rating updates", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const movieId = await seedMovie(t, "filters");
    const showId = await seedShow(t, "filters");
    const episodeId = await seedEpisode(t, 5);
    const assignmentId = await seedAssignment(t, {
      userId: memberId,
      movieId,
      episodeId,
    });
    const ratingA = await seedRating(t, {
      name: "A",
      value: 1,
    });
    const ratingB = await seedRating(t, {
      name: "B",
      value: 2,
    });
    await advanceToS3(t);

    const extraA = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.reviews.admin.createExtra,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: memberId,
        movieId,
        episodeId,
        ratingId: ratingA,
      },
    );
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.reviews.admin.createExtra,
      {
        clientApiVersion: BBPC_API_VERSION,
        userId: otherId,
        showId,
        episodeId,
        ratingId: ratingB,
      },
    );
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.reviews.admin.createForAssignment,
      {
        clientApiVersion: BBPC_API_VERSION,
        assignmentId,
        userId: memberId,
        ratingId: ratingA,
      },
    );

    const paginationOpts = { numItems: 10, cursor: null };
    const all = await t.withIdentity(ADMIN_IDENTITY).query(
      api.reviews.admin.listPage,
      { paginationOpts },
    );
    const byRating = await t.withIdentity(ADMIN_IDENTITY).query(
      api.reviews.admin.listPage,
      { paginationOpts, ratingId: ratingA },
    );
    const byUser = await t.withIdentity(ADMIN_IDENTITY).query(
      api.reviews.admin.listPage,
      { paginationOpts, userId: memberId },
    );
    const byBoth = await t.withIdentity(ADMIN_IDENTITY).query(
      api.reviews.admin.listPage,
      {
        paginationOpts,
        ratingId: ratingA,
        userId: memberId,
      },
    );
    expect(all.page).toHaveLength(3);
    expect(byRating.page).toHaveLength(2);
    expect(byUser.page).toHaveLength(2);
    expect(byBoth.page).toHaveLength(2);

    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.reviews.admin.getById,
        { id: extraA.review.id },
      ),
    ).resolves.toMatchObject({
      id: extraA.review.id,
      extraReviews: [{ id: extraA.id }],
    });
    const assignmentPage = await t.withIdentity(ADMIN_IDENTITY).query(
      api.reviews.admin.listForAssignment,
      {
        assignmentId,
        paginationOpts,
      },
    );
    expect(assignmentPage.page).toHaveLength(1);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.reviews.admin.listPage,
        {
          paginationOpts: { numItems: 101, cursor: null },
        },
      ),
      "VALIDATION_FAILED",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.setRating,
        {
          clientApiVersion: BBPC_API_VERSION,
          reviewId: extraA.review.id,
          ratingId: ratingB,
        },
      ),
    ).resolves.toMatchObject({ rating: { id: ratingB } });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.setRating,
        {
          clientApiVersion: BBPC_API_VERSION,
          reviewId: extraA.review.id,
          ratingId: null,
        },
      ),
    ).resolves.toMatchObject({ rating: null });
  });

  test("deletes review relationships and guesses atomically and safely unlinks assignment reviews", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    const movieId = await seedMovie(t, "cascade");
    const episodeId = await seedEpisode(t, 6);
    const assignmentId = await seedAssignment(t, {
      userId: memberId,
      movieId,
      episodeId,
    });
    const ratingId = await seedRating(t);
    const seasonId = await seedSeason(t);
    const reviewId = await seedReview(t, {
      userId: otherId,
      movieId,
      ratingId,
    });
    const assignmentReviewId = await seedAssignmentReview(t, {
      assignmentId,
      reviewId,
    });
    const extraReviewId = await t.run(async (ctx) => {
      return await ctx.db.insert("extraReviews", {
        reviewId,
        episodeId,
      });
    });
    const guessId = await seedGuess(t, {
      ratingId,
      userId: memberId,
      assignmentReviewId,
      seasonId,
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.removeAssignmentIfNoGuesses,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: assignmentReviewId,
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: reviewId,
        },
      ),
    ).resolves.toEqual({
      id: reviewId,
      assignmentReviewCount: 1,
      extraReviewCount: 1,
      guessCount: 1,
    });
    const deleted = await t.run(async (ctx) => {
      return await Promise.all([
        ctx.db.get("reviews", reviewId),
        ctx.db.get("assignmentReviews", assignmentReviewId),
        ctx.db.get("extraReviews", extraReviewId),
        ctx.db.get("guesses", guessId),
      ]);
    });
    expect(deleted).toEqual([null, null, null, null]);

    const survivingReviewId = await seedReview(t, {
      userId: otherId,
      movieId,
    });
    const survivingLinkId = await seedAssignmentReview(t, {
      assignmentId,
      reviewId: survivingReviewId,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.removeAssignmentIfNoGuesses,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: survivingLinkId,
        },
      ),
    ).resolves.toEqual({ id: survivingLinkId });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.reviews.admin.getById,
        { id: survivingReviewId },
      ),
    ).resolves.toMatchObject({
      id: survivingReviewId,
      assignmentReviews: [],
    });
  });

  test("fails closed when review relationship fanout exceeds its cap", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    const movieId = await seedMovie(t, "fanout");
    const episodeId = await seedEpisode(t, 7);
    const reviewId = await seedReview(t, {
      userId: memberId,
      movieId,
    });
    await t.run(async (ctx) => {
      for (let index = 0; index < 51; index += 1) {
        await ctx.db.insert("extraReviews", {
          reviewId,
          episodeId,
        });
      }
    });
    await advanceToS3(t);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.reviews.admin.getById,
        { id: reviewId },
      ),
      "CONFLICT",
      { relationship: "extra relationships", limit: 50 },
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.reviews.admin.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: reviewId,
        },
      ),
      "CONFLICT",
      { limit: 50 },
    );
  });

  test("serializes concurrent self-service extra creation without losing either review", async () => {
    const t = createTestBackend();
    await seedActors(t);
    const movieId = await seedMovie(t, "concurrent");
    const episodeId = await seedEpisode(t, 8);
    await advanceToS3(t);

    const [first, second] = await Promise.all([
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.reviews.mine.addMovieExtra,
        {
          clientApiVersion: BBPC_API_VERSION,
          movieId,
          episodeId,
        },
      ),
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.reviews.mine.addMovieExtra,
        {
          clientApiVersion: BBPC_API_VERSION,
          movieId,
          episodeId,
        },
      ),
    ]);
    expect(first.review.id).not.toBe(second.review.id);
    const page = await t.withIdentity(ADMIN_IDENTITY).query(
      api.reviews.admin.listExtrasForEpisode,
      {
        episodeId,
        paginationOpts: { numItems: 10, cursor: null },
      },
    );
    expect(page.page).toHaveLength(2);
    expect(new Set(page.page.map((item) => item.review.id))).toEqual(
      new Set([first.review.id, second.review.id]),
    );
  });

  test("fails closed when the rating catalog exceeds its bounded read limit", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("ratings", {
          name: `Rating ${String(index)}`,
          value: index,
        });
      }
    });

    await expectDomainError(
      t.query(api.ratings.public.list, {}),
      "CONFLICT",
      { limit: 100 },
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.ratings.admin.list,
        {},
      ),
      "CONFLICT",
      { limit: 100 },
    );
  });
});
