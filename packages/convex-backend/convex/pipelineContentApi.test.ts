/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "pipeline-content-test";
const SERVICE_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|pipeline-content",
  issuer: "https://issuer.example.test",
  subject: "pipeline-content",
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

async function seedService(
  t: TestBackend,
  permissions: string[] = ["pipeline:publish"],
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("servicePrincipals", {
      ...SERVICE_IDENTITY,
      name: "Content Pipeline",
      status: "active",
      permissions,
      cutoverRunId: CUTOVER_RUN_ID,
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "pipeline-content-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "pipeline-content-test",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "pipeline-content-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "pipeline-content-test",
    approvedBackupId: "pipeline-content-backup",
    approvedBackupChecksum: "sha256:pipeline-content",
  });
}

async function seedMovie(
  t: TestBackend,
  input: {
    title: string;
    year: number;
    poster?: string;
  },
): Promise<Id<"movies">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("movies", {
      title: input.title,
      normalizedTitle: input.title.toLowerCase(),
      year: input.year,
      url: `https://example.test/${input.title.toLowerCase()}`,
      ...(input.poster === undefined ? {} : { poster: input.poster }),
    });
  });
}

async function seedEpisode(
  t: TestBackend,
  input: {
    number: number;
    title: string;
    date: string;
    seoTitle?: string;
  },
): Promise<Id<"episodes">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("episodes", {
      number: input.number,
      title: input.title,
      date: input.date,
      status: "published",
      slug: `episode-${String(input.number)}`,
      normalizedSlug: `episode-${String(input.number)}`,
      ...(input.seoTitle === undefined
        ? {}
        : { seoTitle: input.seoTitle }),
    });
  });
}

async function seedUser(t: TestBackend): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: "Host",
      email: "host@example.test",
      normalizedEmail: "host@example.test",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

describe("pipeline content API", () => {
  test("requires the registered publish capability", async () => {
    const missing = createTestBackend();
    await expectDomainError(
      missing
        .withIdentity(SERVICE_IDENTITY)
        .query(api.pipeline.content.getEpisodeByDate, {
          date: "2026-07-24",
        }),
      "FORBIDDEN",
    );

    const insufficient = createTestBackend();
    await seedService(insufficient, ["pipeline:heartbeat"]);
    await expectDomainError(
      insufficient
        .withIdentity(SERVICE_IDENTITY)
        .query(api.pipeline.content.getEpisodeByDate, {
          date: "2026-07-24",
        }),
      "FORBIDDEN",
    );

    const writesDisabled = createTestBackend();
    await seedService(writesDisabled);
    await initializeS1(writesDisabled);
    await expectDomainError(
      writesDisabled
        .withIdentity(SERVICE_IDENTITY)
        .mutation(api.pipeline.content.upsertEpisodeFromAudio, {
          clientApiVersion: BBPC_API_VERSION,
          operationId: "episode:20260724",
          date: "2026-07-24",
          number: 1,
          title: "Episode One",
        }),
      "WRITE_DISABLED",
    );
  });

  test("returns bounded episode context, catalogs, dates, and posters", async () => {
    const t = createTestBackend();
    await seedService(t);
    const episodeId = await seedEpisode(t, {
      number: 1,
      title: "Episode One",
      date: "2026-07-24",
    });
    const assignmentMovieId = await seedMovie(t, {
      title: "Arrival",
      year: 2016,
      poster: "https://example.test/arrival.jpg",
    });
    const extraMovieId = await seedMovie(t, {
      title: "Moon",
      year: 2009,
    });
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Host",
        email: "host@example.test",
        normalizedEmail: "host@example.test",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("assignments", {
        userId,
        episodeId,
        movieId: assignmentMovieId,
        type: "HOMEWORK",
        playable: true,
      });
      await ctx.db.insert("assignments", {
        userId,
        episodeId,
        movieId: assignmentMovieId,
        type: "BONUS",
        playable: true,
      });
      const reviewId = await ctx.db.insert("reviews", {
        userId,
        movieId: extraMovieId,
      });
      await ctx.db.insert("extraReviews", {
        reviewId,
        episodeId,
      });
      const duplicateReviewId = await ctx.db.insert("reviews", {
        userId,
        movieId: assignmentMovieId,
      });
      await ctx.db.insert("extraReviews", {
        reviewId: duplicateReviewId,
        episodeId,
      });
    });
    const service = t.withIdentity(SERVICE_IDENTITY);

    await expect(
      service.query(api.pipeline.content.getEpisodeByDate, {
        date: "2026-07-24",
      }),
    ).resolves.toMatchObject({ id: episodeId });
    await expect(
      service.query(api.pipeline.content.getEpisodeContextByDate, {
        date: "2026-07-24",
      }),
    ).resolves.toMatchObject({
      episode: { id: episodeId, number: 1 },
      movies: [
        {
          id: assignmentMovieId,
          source: "assignment",
          assignmentType: "HOMEWORK",
        },
        {
          id: extraMovieId,
          source: "extra_review",
          assignmentType: null,
        },
      ],
    });
    await expect(
      service.query(api.pipeline.content.getEpisodeContextById, {
        id: episodeId,
      }),
    ).resolves.toMatchObject({
      episode: { id: episodeId },
      movies: [{ id: assignmentMovieId }, { id: extraMovieId }],
    });
    await expect(
      service.query(api.pipeline.content.listMovieCatalogPage, {
        paginationOpts: { cursor: null, numItems: 100 },
      }),
    ).resolves.toMatchObject({
      page: [
        { id: assignmentMovieId, title: "Arrival" },
        { id: extraMovieId, title: "Moon" },
      ],
      isDone: true,
    });
    await expect(
      service.query(api.pipeline.content.listEpisodeDatesPage, {
        paginationOpts: { cursor: null, numItems: 100 },
      }),
    ).resolves.toMatchObject({
      page: [{ id: episodeId, date: "2026-07-24" }],
      isDone: true,
    });
    await expect(
      service.query(api.pipeline.content.getMoviePosters, {
        movieIds: [assignmentMovieId, extraMovieId],
      }),
    ).resolves.toEqual([
      {
        id: assignmentMovieId,
        poster: "https://example.test/arrival.jpg",
      },
    ]);
    await expect(
      service.query(api.pipeline.content.getEpisodeByDate, {
        date: "2026-07-31",
      }),
    ).resolves.toBeNull();
    await expect(
      service.query(api.pipeline.content.getEpisodeContextByDate, {
        date: "2026-07-31",
      }),
    ).resolves.toBeNull();
    const deletedEpisodeId = await seedEpisode(t, {
      number: 2,
      title: "Deleted Episode",
      date: "2026-07-31",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("episodes", deletedEpisodeId);
    });
    await expect(
      service.query(api.pipeline.content.getEpisodeContextById, {
        id: deletedEpisodeId,
      }),
    ).resolves.toBeNull();
  });

  test("fails closed on duplicate dates and malformed bounded requests", async () => {
    const t = createTestBackend();
    await seedService(t);
    await seedEpisode(t, {
      number: 1,
      title: "Episode One",
      date: "2026-07-24",
    });
    await seedEpisode(t, {
      number: 2,
      title: "Episode Two",
      date: "2026-07-24",
    });
    const movieId = await seedMovie(t, {
      title: "Arrival",
      year: 2016,
    });
    const emptyPosterMovieId = await seedMovie(t, {
      title: "Moon",
      year: 2009,
      poster: "",
    });
    const deletedMovieId = await seedMovie(t, {
      title: "Heat",
      year: 1995,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("movies", deletedMovieId);
    });
    const service = t.withIdentity(SERVICE_IDENTITY);

    await expectDomainError(
      service.query(api.pipeline.content.getEpisodeByDate, {
        date: "2026-07-24",
      }),
      "CONFLICT",
    );
    for (const numItems of [0, 1.5, 101]) {
      await expectDomainError(
        service.query(api.pipeline.content.listMovieCatalogPage, {
          paginationOpts: { cursor: null, numItems },
        }),
        "VALIDATION_FAILED",
      );
    }
    await expectDomainError(
      service.query(api.pipeline.content.getMoviePosters, {
        movieIds: [movieId, movieId],
      }),
      "VALIDATION_FAILED",
    );
    await expectDomainError(
      service.query(api.pipeline.content.getMoviePosters, {
        movieIds: Array.from({ length: 51 }, () => movieId),
      }),
      "VALIDATION_FAILED",
    );
    await expect(
      service.query(api.pipeline.content.getMoviePosters, {
        movieIds: [emptyPosterMovieId, deletedMovieId],
      }),
    ).resolves.toEqual([]);
  });

  test("fails closed on corrupt episode relationships", async () => {
    const missingAssignmentMovie = createTestBackend();
    await seedService(missingAssignmentMovie);
    const assignmentEpisodeId = await seedEpisode(
      missingAssignmentMovie,
      {
        number: 1,
        title: "Assignment Corruption",
        date: "2026-07-24",
      },
    );
    const assignmentMovieId = await seedMovie(
      missingAssignmentMovie,
      {
        title: "Arrival",
        year: 2016,
      },
    );
    const assignmentUserId = await seedUser(
      missingAssignmentMovie,
    );
    await missingAssignmentMovie.run(async (ctx) => {
      await ctx.db.insert("assignments", {
        userId: assignmentUserId,
        episodeId: assignmentEpisodeId,
        movieId: assignmentMovieId,
        type: "HOMEWORK",
        playable: true,
      });
      await ctx.db.delete("movies", assignmentMovieId);
    });
    await expectDomainError(
      missingAssignmentMovie
        .withIdentity(SERVICE_IDENTITY)
        .query(api.pipeline.content.getEpisodeContextById, {
          id: assignmentEpisodeId,
        }),
      "CONFLICT",
    );

    const invalidExtraReview = createTestBackend();
    await seedService(invalidExtraReview);
    const invalidExtraEpisodeId = await seedEpisode(
      invalidExtraReview,
      {
        number: 2,
        title: "Extra Review Corruption",
        date: "2026-07-31",
      },
    );
    await invalidExtraReview.run(async (ctx) => {
      const showId = await ctx.db.insert("shows", {
        title: "Severance",
        normalizedTitle: "severance",
        year: 2022,
        url: "https://example.test/severance",
      });
      const reviewId = await ctx.db.insert("reviews", { showId });
      await ctx.db.insert("extraReviews", {
        reviewId,
        episodeId: invalidExtraEpisodeId,
      });
    });
    await expectDomainError(
      invalidExtraReview
        .withIdentity(SERVICE_IDENTITY)
        .query(api.pipeline.content.getEpisodeContextById, {
          id: invalidExtraEpisodeId,
        }),
      "CONFLICT",
    );

    const missingExtraMovie = createTestBackend();
    await seedService(missingExtraMovie);
    const missingExtraEpisodeId = await seedEpisode(
      missingExtraMovie,
      {
        number: 3,
        title: "Missing Extra Movie",
        date: "2026-08-07",
      },
    );
    const extraMovieId = await seedMovie(missingExtraMovie, {
      title: "Moon",
      year: 2009,
    });
    await missingExtraMovie.run(async (ctx) => {
      const reviewId = await ctx.db.insert("reviews", {
        movieId: extraMovieId,
      });
      await ctx.db.insert("extraReviews", {
        reviewId,
        episodeId: missingExtraEpisodeId,
      });
      await ctx.db.delete("movies", extraMovieId);
    });
    await expectDomainError(
      missingExtraMovie
        .withIdentity(SERVICE_IDENTITY)
        .query(api.pipeline.content.getEpisodeContextById, {
          id: missingExtraEpisodeId,
        }),
      "CONFLICT",
    );
  });

  test("publishes SEO with exact-state idempotency", async () => {
    const t = createTestBackend();
    const servicePrincipalId = await seedService(t);
    await advanceToS3(t);
    const episodeId = await seedEpisode(t, {
      number: 1,
      title: "Episode One",
      date: "2026-07-24",
      seoTitle: "Old title",
    });
    const service = t.withIdentity(SERVICE_IDENTITY);
    const args = {
      clientApiVersion: BBPC_API_VERSION,
      operationId: "seo:20260724:abc123",
      date: "2026-07-24",
      expected: {
        seoTitle: "Old title",
        seoDescription: null,
        seoKeywords: null,
      },
      seoTitle: "New title",
      seoDescription: "New description",
      seoKeywords: "movie, podcast",
    };

    await expect(
      service.mutation(api.pipeline.content.publishEpisodeSeo, args),
    ).resolves.toMatchObject({
      changed: true,
      episode: {
        id: episodeId,
        seoTitle: "New title",
        seoDescription: "New description",
      },
    });
    await expect(
      service.mutation(api.pipeline.content.publishEpisodeSeo, args),
    ).resolves.toMatchObject({ changed: false });
    await expectDomainError(
      service.mutation(api.pipeline.content.publishEpisodeSeo, {
        ...args,
        operationId: "seo:20260724:different",
        seoTitle: "Conflicting title",
      }),
      "CONFLICT",
    );
    await expectDomainError(
      service.mutation(api.pipeline.content.publishEpisodeSeo, {
        ...args,
        operationId: "seo:20260724:description-drift",
        expected: {
          seoTitle: "New title",
          seoDescription: null,
          seoKeywords: "movie, podcast",
        },
        seoTitle: "Another title",
      }),
      "CONFLICT",
    );
    await expectDomainError(
      service.mutation(api.pipeline.content.publishEpisodeSeo, {
        ...args,
        operationId: "seo:20260724:keyword-drift",
        expected: {
          seoTitle: "New title",
          seoDescription: "New description",
          seoKeywords: null,
        },
        seoTitle: "Another title",
      }),
      "CONFLICT",
    );
    const audits = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditEvents")
        .withIndex(
          "by_servicePrincipalId_and_createdAt",
          (index) =>
            index.eq("servicePrincipalId", servicePrincipalId),
        )
        .take(10);
    });
    expect(
      audits.filter(
        (audit) =>
          audit.action === "pipeline.episodeSeoPublished",
      ),
    ).toHaveLength(1);
  });

  test("creates an audio episode once and rejects metadata drift", async () => {
    const t = createTestBackend();
    await seedService(t);
    await advanceToS3(t);
    const service = t.withIdentity(SERVICE_IDENTITY);
    const args = {
      clientApiVersion: BBPC_API_VERSION,
      operationId: "episode:20260724",
      date: "2026-07-24",
      number: 42,
      title: "The Answer",
    };

    const created = await service.mutation(
      api.pipeline.content.upsertEpisodeFromAudio,
      args,
    );
    expect(created).toMatchObject({
      created: true,
      episode: {
        number: 42,
        date: "2026-07-24",
        status: "published",
      },
    });
    await expect(
      service.mutation(
        api.pipeline.content.upsertEpisodeFromAudio,
        args,
      ),
    ).resolves.toMatchObject({
      created: false,
      episode: { id: created.episode.id },
    });
    await expectDomainError(
      service.mutation(
        api.pipeline.content.upsertEpisodeFromAudio,
        {
          ...args,
          operationId: "episode:20260724:drift",
          title: "A Different Episode",
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      service.mutation(
        api.pipeline.content.upsertEpisodeFromAudio,
        {
          ...args,
          operationId: "episode:20260724:number-drift",
          number: 43,
        },
      ),
      "CONFLICT",
    );
  });

  test("rejects non-portable pipeline operation IDs", async () => {
    const t = createTestBackend();
    await seedService(t);
    await advanceToS3(t);
    const service = t.withIdentity(SERVICE_IDENTITY);

    for (const operationId of [
      "",
      "a".repeat(201),
      "contains spaces",
    ]) {
      await expectDomainError(
        service.mutation(
          api.pipeline.content.upsertEpisodeFromAudio,
          {
            clientApiVersion: BBPC_API_VERSION,
            operationId,
            date: "2026-07-24",
            number: 42,
            title: "The Answer",
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    await expectDomainError(
      service.mutation(api.pipeline.content.publishEpisodeSeo, {
        clientApiVersion: BBPC_API_VERSION,
        operationId: "seo:20260724:missing",
        date: "2026-07-24",
        expected: {
          seoTitle: null,
          seoDescription: null,
          seoKeywords: null,
        },
        seoTitle: null,
        seoDescription: null,
        seoKeywords: null,
      }),
      "NOT_FOUND",
    );
  });
});
