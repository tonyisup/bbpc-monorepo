import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { toCatalogMovie } from "../catalog/readModel.js";
import { domainError } from "../lib/errors.js";
import type { assignmentDetailValidator } from "./validators.js";

type AssignmentDetail = Infer<typeof assignmentDetailValidator>;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

async function requireRelatedDocument<
  TableName extends "users" | "movies" | "episodes",
>(
  ctx: QueryCtx,
  table: TableName,
  id: Id<TableName>,
): Promise<Doc<TableName>> {
  const document = await ctx.db.get(table, id);
  if (document === null) {
    domainError(
      "CONFLICT",
      `Assignment read model found a missing ${table} relationship.`,
      { details: { table, id } },
    );
  }
  return document;
}

export async function hydrateAssignment(
  ctx: QueryCtx,
  assignment: Doc<"assignments">,
): Promise<AssignmentDetail> {
  const [user, movie, episode] = await Promise.all([
    requireRelatedDocument(ctx, "users", assignment.userId),
    requireRelatedDocument(ctx, "movies", assignment.movieId),
    requireRelatedDocument(ctx, "episodes", assignment.episodeId),
  ]);
  if (
    assignment.type !== "HOMEWORK" &&
    assignment.type !== "EXTRA_CREDIT" &&
    assignment.type !== "BONUS"
  ) {
    domainError("CONFLICT", "Assignment has an unsupported type.", {
      details: { assignmentId: assignment._id },
    });
  }
  return {
    id: assignment._id,
    type: assignment.type,
    playable: assignment.playable,
    slug: nullable(assignment.slug),
    user: {
      id: user._id,
      name: nullable(user.name),
      image: nullable(user.image),
      status: user.status,
    },
    movie: toCatalogMovie(movie),
    episode: {
      id: episode._id,
      number: episode.number,
      title: episode.title,
      status: nullable(episode.status),
      slug: nullable(episode.slug),
    },
  };
}
