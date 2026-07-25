import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import {
  pipelineMutation,
  pipelineQuery,
} from "../functions.js";
import {
  allocateEpisodeSlug,
  episodeShortTextLimit,
  validateEpisodeNumber,
  validateEpisodeTitle,
  validateOptionalEpisodeText,
  validatePlainDate,
} from "../episodes/adminWriteModel.js";
import { writeAuditEvent } from "../lib/audit.js";
import { requireServicePermission } from "../lib/actors.js";
import { domainError } from "../lib/errors.js";

const MAX_PIPELINE_PAGE_SIZE = 100;
const MAX_PIPELINE_MOVIE_IDS = 50;
const MAX_PIPELINE_EPISODE_RELATIONSHIPS = 50;
const MAX_PIPELINE_OPERATION_ID_LENGTH = 200;
const PIPELINE_PERMISSION = "pipeline:publish";

const nullableString = v.union(v.string(), v.null());

const pipelineEpisodeValidator = v.object({
  id: v.id("episodes"),
  number: v.number(),
  title: v.string(),
  date: nullableString,
  slug: nullableString,
  status: nullableString,
  description: nullableString,
  notes: nullableString,
  seoTitle: nullableString,
  seoDescription: nullableString,
  seoKeywords: nullableString,
});

const pipelineEpisodeMovieValidator = v.object({
  id: v.id("movies"),
  title: v.string(),
  year: v.number(),
  poster: nullableString,
  source: v.union(
    v.literal("assignment"),
    v.literal("extra_review"),
  ),
  assignmentType: nullableString,
});

const pipelineEpisodeContextValidator = v.object({
  episode: pipelineEpisodeValidator,
  movies: v.array(pipelineEpisodeMovieValidator),
});

const pipelineMovieValidator = v.object({
  id: v.id("movies"),
  title: v.string(),
  year: v.number(),
  poster: nullableString,
});

const pipelineEpisodeDateValidator = v.object({
  id: v.id("episodes"),
  date: v.string(),
});

const pipelineMoviePosterValidator = v.object({
  id: v.id("movies"),
  poster: v.string(),
});

const pipelineSeoSnapshotValidator = v.object({
  seoTitle: nullableString,
  seoDescription: nullableString,
  seoKeywords: nullableString,
});

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function requirePipelineAccess(
  actor: Parameters<typeof requireServicePermission>[0],
): void {
  requireServicePermission(actor, PIPELINE_PERMISSION);
}

function requirePipelinePageSize(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_PIPELINE_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Pipeline pages must request 1 through ${String(MAX_PIPELINE_PAGE_SIZE)} rows.`,
    );
  }
}

function requireOperationId(value: string): string {
  const operationId = value.trim().normalize("NFKC");
  if (
    operationId.length < 1 ||
    operationId.length > MAX_PIPELINE_OPERATION_ID_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(operationId)
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Pipeline operation IDs must be bounded portable identifiers.",
    );
  }
  return operationId;
}

function toPipelineEpisode(episode: Doc<"episodes">) {
  return {
    id: episode._id,
    number: episode.number,
    title: episode.title,
    date: nullable(episode.date),
    slug: nullable(episode.slug),
    status: nullable(episode.status),
    description: nullable(episode.description),
    notes: nullable(episode.notes),
    seoTitle: nullable(episode.seoTitle),
    seoDescription: nullable(episode.seoDescription),
    seoKeywords: nullable(episode.seoKeywords),
  };
}

function toPipelineMovie(movie: Doc<"movies">) {
  return {
    id: movie._id,
    title: movie.title,
    year: movie.year,
    poster: nullable(movie.poster),
  };
}

async function findEpisodeByDate(
  ctx: Pick<QueryCtx, "db">,
  date: string,
): Promise<Doc<"episodes"> | null> {
  const matches = await ctx.db
    .query("episodes")
    .withIndex("by_date_and_status", (index) =>
      index.eq("date", date),
    )
    .take(2);
  if (matches.length > 1) {
    domainError(
      "CONFLICT",
      "Multiple episodes share the requested date.",
    );
  }
  return matches.at(0) ?? null;
}

async function requireEpisodeByDate(
  ctx: Pick<QueryCtx, "db">,
  date: string,
): Promise<Doc<"episodes">> {
  const episode = await findEpisodeByDate(ctx, date);
  if (episode === null) {
    domainError("NOT_FOUND", "The pipeline episode is unavailable.");
  }
  return episode;
}

async function readEpisodeMovies(
  ctx: Pick<QueryCtx, "db">,
  episodeId: Id<"episodes">,
) {
  const [assignments, extraReviews] = await Promise.all([
    ctx.db
      .query("assignments")
      .withIndex("by_episodeId", (index) =>
        index.eq("episodeId", episodeId),
      )
      .take(MAX_PIPELINE_EPISODE_RELATIONSHIPS + 1),
    ctx.db
      .query("extraReviews")
      .withIndex("by_episodeId", (index) =>
        index.eq("episodeId", episodeId),
      )
      .take(MAX_PIPELINE_EPISODE_RELATIONSHIPS + 1),
  ]);
  if (
    assignments.length > MAX_PIPELINE_EPISODE_RELATIONSHIPS ||
    extraReviews.length > MAX_PIPELINE_EPISODE_RELATIONSHIPS
  ) {
    domainError(
      "CONFLICT",
      "The episode exceeds the pipeline relationship limit.",
      {
        details: {
          limit: MAX_PIPELINE_EPISODE_RELATIONSHIPS,
        },
      },
    );
  }

  const movies = new Map<
    Id<"movies">,
    {
      id: Id<"movies">;
      title: string;
      year: number;
      poster: string | null;
      source: "assignment" | "extra_review";
      assignmentType: string | null;
    }
  >();
  for (const assignment of assignments) {
    const movie = await ctx.db.get("movies", assignment.movieId);
    if (movie === null) {
      domainError(
        "CONFLICT",
        "A pipeline assignment references a missing movie.",
      );
    }
    if (!movies.has(movie._id)) {
      movies.set(movie._id, {
        ...toPipelineMovie(movie),
        source: "assignment",
        assignmentType: assignment.type,
      });
    }
  }
  for (const extraReview of extraReviews) {
    const review = await ctx.db.get("reviews", extraReview.reviewId);
    if (
      review?.movieId === undefined ||
      review.showId !== undefined
    ) {
      domainError(
        "CONFLICT",
        "A pipeline extra review has an invalid movie relationship.",
      );
    }
    const movie = await ctx.db.get("movies", review.movieId);
    if (movie === null) {
      domainError(
        "CONFLICT",
        "A pipeline extra review references a missing movie.",
      );
    }
    if (!movies.has(movie._id)) {
      movies.set(movie._id, {
        ...toPipelineMovie(movie),
        source: "extra_review",
        assignmentType: null,
      });
    }
  }
  return [...movies.values()].sort(
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.year - right.year ||
      left.id.localeCompare(right.id),
  );
}

export const getEpisodeByDate = pipelineQuery({
  args: { date: v.string() },
  returns: v.union(pipelineEpisodeValidator, v.null()),
  handler: async (ctx, args) => {
    requirePipelineAccess(ctx.actor);
    const date = validatePlainDate(args.date);
    if (date === undefined) {
      throw new Error("Validated pipeline date is unavailable.");
    }
    const episode = await findEpisodeByDate(ctx, date);
    return episode === null ? null : toPipelineEpisode(episode);
  },
});

export const getEpisodeContextByDate = pipelineQuery({
  args: { date: v.string() },
  returns: v.union(pipelineEpisodeContextValidator, v.null()),
  handler: async (ctx, args) => {
    requirePipelineAccess(ctx.actor);
    const date = validatePlainDate(args.date);
    if (date === undefined) {
      throw new Error("Validated pipeline date is unavailable.");
    }
    const episode = await findEpisodeByDate(ctx, date);
    if (episode === null) {
      return null;
    }
    return {
      episode: toPipelineEpisode(episode),
      movies: await readEpisodeMovies(ctx, episode._id),
    };
  },
});

export const getEpisodeContextById = pipelineQuery({
  args: { id: v.id("episodes") },
  returns: v.union(pipelineEpisodeContextValidator, v.null()),
  handler: async (ctx, args) => {
    requirePipelineAccess(ctx.actor);
    const episode = await ctx.db.get("episodes", args.id);
    if (episode === null) {
      return null;
    }
    return {
      episode: toPipelineEpisode(episode),
      movies: await readEpisodeMovies(ctx, episode._id),
    };
  },
});

export const listMovieCatalogPage = pipelineQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(pipelineMovieValidator),
  handler: async (ctx, args) => {
    requirePipelineAccess(ctx.actor);
    requirePipelinePageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("movies")
      .withIndex("by_normalizedTitle_and_year")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(toPipelineMovie),
    };
  },
});

export const listEpisodeDatesPage = pipelineQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    pipelineEpisodeDateValidator,
  ),
  handler: async (ctx, args) => {
    requirePipelineAccess(ctx.actor);
    requirePipelinePageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("episodes")
      .withIndex("by_date_and_status", (index) =>
        index.gte("date", "0000-01-01"),
      )
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((episode) => {
        if (episode.date === undefined) {
          throw new Error(
            "The pipeline date index returned an undated episode.",
          );
        }
        return { id: episode._id, date: episode.date };
      }),
    };
  },
});

export const getMoviePosters = pipelineQuery({
  args: { movieIds: v.array(v.id("movies")) },
  returns: v.array(pipelineMoviePosterValidator),
  handler: async (ctx, args) => {
    requirePipelineAccess(ctx.actor);
    if (
      args.movieIds.length > MAX_PIPELINE_MOVIE_IDS ||
      new Set(args.movieIds).size !== args.movieIds.length
    ) {
      domainError(
        "VALIDATION_FAILED",
        "Pipeline poster lookups require at most 50 distinct movie IDs.",
      );
    }
    const movies = await Promise.all(
      args.movieIds.map((id) => ctx.db.get("movies", id)),
    );
    return movies.flatMap((movie) =>
      movie?.poster === undefined || movie.poster.length === 0
        ? []
        : [{ id: movie._id, poster: movie.poster }],
    );
  },
});

export const publishEpisodeSeo = pipelineMutation({
  args: {
    operationId: v.string(),
    date: v.string(),
    expected: pipelineSeoSnapshotValidator,
    seoTitle: nullableString,
    seoDescription: nullableString,
    seoKeywords: nullableString,
  },
  returns: v.object({
    episode: pipelineEpisodeValidator,
    changed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requirePipelineAccess(ctx.actor);
    const operationId = requireOperationId(args.operationId);
    const date = validatePlainDate(args.date);
    if (date === undefined) {
      throw new Error("Validated pipeline date is unavailable.");
    }
    const episode = await requireEpisodeByDate(ctx, date);
    const desired = {
      seoTitle: validateOptionalEpisodeText(
        args.seoTitle,
        "SEO title",
        episodeShortTextLimit,
      ),
      seoDescription: validateOptionalEpisodeText(
        args.seoDescription,
        "SEO description",
      ),
      seoKeywords: validateOptionalEpisodeText(
        args.seoKeywords,
        "SEO keywords",
      ),
    };
    const alreadyApplied =
      episode.seoTitle === desired.seoTitle &&
      episode.seoDescription === desired.seoDescription &&
      episode.seoKeywords === desired.seoKeywords;
    if (alreadyApplied) {
      return {
        episode: toPipelineEpisode(episode),
        changed: false,
      };
    }
    if (
      nullable(episode.seoTitle) !== args.expected.seoTitle ||
      nullable(episode.seoDescription) !==
        args.expected.seoDescription ||
      nullable(episode.seoKeywords) !== args.expected.seoKeywords
    ) {
      domainError(
        "CONFLICT",
        "Episode SEO changed after the pipeline loaded it.",
      );
    }
    await ctx.db.patch("episodes", episode._id, desired);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "pipeline.episodeSeoPublished",
      targetType: "episode",
      targetId: episode._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { operationId },
    });
    const updated = await ctx.db.get("episodes", episode._id);
    if (updated === null) {
      throw new Error("Published pipeline episode is unavailable.");
    }
    return {
      episode: toPipelineEpisode(updated),
      changed: true,
    };
  },
});

export const upsertEpisodeFromAudio = pipelineMutation({
  args: {
    operationId: v.string(),
    date: v.string(),
    number: v.number(),
    title: v.string(),
  },
  returns: v.object({
    episode: pipelineEpisodeValidator,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requirePipelineAccess(ctx.actor);
    const operationId = requireOperationId(args.operationId);
    const date = validatePlainDate(args.date);
    if (date === undefined) {
      throw new Error("Validated pipeline date is unavailable.");
    }
    const number = validateEpisodeNumber(args.number);
    const title = validateEpisodeTitle(args.title);
    const existing = await findEpisodeByDate(ctx, date);
    if (existing !== null) {
      if (
        existing.number !== number ||
        existing.title !== title
      ) {
        domainError(
          "CONFLICT",
          "The episode date already belongs to different audio metadata.",
        );
      }
      return {
        episode: toPipelineEpisode(existing),
        created: false,
      };
    }
    const slug = await allocateEpisodeSlug(ctx, { number, title });
    const episodeId = await ctx.db.insert("episodes", {
      number,
      title,
      date,
      status: "published",
      ...slug,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "pipeline.episodeCreatedFromAudio",
      targetType: "episode",
      targetId: episodeId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { operationId, number },
    });
    const episode = await ctx.db.get("episodes", episodeId);
    if (episode === null) {
      throw new Error("Created pipeline episode is unavailable.");
    }
    return {
      episode: toPipelineEpisode(episode),
      created: true,
    };
  },
});
