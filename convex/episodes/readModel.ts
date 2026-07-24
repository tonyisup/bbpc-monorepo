import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import type { episodeDetailValidator } from "./validators.js";

type EpisodeDetail = Infer<typeof episodeDetailValidator>;

const RELATION_LIMIT = 50;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function assertWithinRelationLimit<T>(
  rows: T[],
  relationship: string,
): asserts rows is T[] {
  if (rows.length > RELATION_LIMIT) {
    domainError(
      "CONFLICT",
      `${relationship} exceeds the public episode read limit.`,
      {
        details: {
          relationship,
          limit: RELATION_LIMIT,
        },
      },
    );
  }
}

async function requireRelatedDocument<TableName extends
  | "users"
  | "movies"
  | "shows"
  | "reviews">(
  ctx: QueryCtx,
  table: TableName,
  id: Id<TableName>,
): Promise<Doc<TableName>> {
  const document = await ctx.db.get(table, id);
  if (document === null) {
    domainError(
      "CONFLICT",
      `Episode read model found a missing ${table} relationship.`,
      { details: { table, id } },
    );
  }
  return document;
}

function toUser(user: Doc<"users">) {
  return {
    id: user._id,
    name: nullable(user.name),
    image: nullable(user.image),
  };
}

function toMovie(movie: Doc<"movies">) {
  return {
    id: movie._id,
    title: movie.title,
    year: movie.year,
    poster: nullable(movie.poster),
    url: movie.url,
    tmdbId: nullable(movie.tmdbId),
  };
}

function toShow(show: Doc<"shows">) {
  return {
    id: show._id,
    title: show.title,
    year: show.year,
    poster: nullable(show.poster),
    url: show.url,
  };
}

async function hydrateAssignments(
  ctx: QueryCtx,
  episodeId: Id<"episodes">,
): Promise<EpisodeDetail["assignments"]> {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_episodeId", (query) =>
      query.eq("episodeId", episodeId),
    )
    .take(RELATION_LIMIT + 1);
  assertWithinRelationLimit(assignments, "assignments");
  return await Promise.all(
    assignments.map(async (assignment) => {
      const [user, movie] = await Promise.all([
        requireRelatedDocument(ctx, "users", assignment.userId),
        requireRelatedDocument(ctx, "movies", assignment.movieId),
      ]);
      return {
        id: assignment._id,
        type: assignment.type,
        playable: assignment.playable,
        slug: nullable(assignment.slug),
        user: toUser(user),
        movie: toMovie(movie),
      };
    }),
  );
}

async function hydrateExtras(
  ctx: QueryCtx,
  episodeId: Id<"episodes">,
): Promise<EpisodeDetail["extras"]> {
  const extras = await ctx.db
    .query("extraReviews")
    .withIndex("by_episodeId", (query) =>
      query.eq("episodeId", episodeId),
    )
    .take(RELATION_LIMIT + 1);
  assertWithinRelationLimit(extras, "extras");
  return await Promise.all(
    extras.map(async (extra) => {
      const review = await requireRelatedDocument(
        ctx,
        "reviews",
        extra.reviewId,
      );
      const [movie, show] = await Promise.all([
        review.movieId === undefined
          ? null
          : requireRelatedDocument(ctx, "movies", review.movieId),
        review.showId === undefined
          ? null
          : requireRelatedDocument(ctx, "shows", review.showId),
      ]);
      return {
        id: extra._id,
        review: {
          id: review._id,
          movie: movie === null ? null : toMovie(movie),
          show: show === null ? null : toShow(show),
        },
      };
    }),
  );
}

async function hydrateLinks(
  ctx: QueryCtx,
  episodeId: Id<"episodes">,
): Promise<EpisodeDetail["links"]> {
  const links = await ctx.db
    .query("episodeLinks")
    .withIndex("by_episodeId", (query) =>
      query.eq("episodeId", episodeId),
    )
    .take(RELATION_LIMIT + 1);
  assertWithinRelationLimit(links, "links");
  return links.map((link) => ({
    id: link._id,
    url: link.url,
    text: link.text,
  }));
}

export async function hydrateEpisode(
  ctx: QueryCtx,
  episode: Doc<"episodes">,
): Promise<EpisodeDetail> {
  const [assignments, extras, links] = await Promise.all([
    hydrateAssignments(ctx, episode._id),
    hydrateExtras(ctx, episode._id),
    hydrateLinks(ctx, episode._id),
  ]);
  return {
    id: episode._id,
    number: episode.number,
    title: episode.title,
    recording: nullable(episode.recording),
    date: nullable(episode.date),
    description: nullable(episode.description),
    status: nullable(episode.status),
    slug: nullable(episode.slug),
    assignments,
    extras,
    links,
  };
}
