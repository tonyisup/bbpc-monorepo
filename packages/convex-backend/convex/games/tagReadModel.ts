import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { hydratePointCore } from "./pointReadModel.js";
import type {
  tagValidator,
  tagVoteValidator,
} from "./validators.js";

type Tag = Infer<typeof tagValidator>;
type TagVote = Infer<typeof tagVoteValidator>;
type TagReadContext = Pick<QueryCtx, "db">;

export function toTag(tag: Doc<"tags">): Tag {
  return {
    id: tag._id,
    name: tag.name,
    description: tag.description ?? null,
    createdAt: tag.createdAt,
  };
}

export async function requireTag(
  ctx: TagReadContext,
  id: Id<"tags">,
): Promise<Doc<"tags">> {
  const tag = await ctx.db.get("tags", id);
  if (tag === null) {
    domainError("NOT_FOUND", "The tag is unavailable.");
  }
  return tag;
}

export async function requireTagVote(
  ctx: TagReadContext,
  id: Id<"tagVotes">,
): Promise<Doc<"tagVotes">> {
  const vote = await ctx.db.get("tagVotes", id);
  if (vote === null) {
    domainError("NOT_FOUND", "The tag vote is unavailable.");
  }
  return vote;
}

export async function hydrateTagVote(
  ctx: QueryCtx,
  vote: Doc<"tagVotes">,
): Promise<TagVote> {
  const [user, point] = await Promise.all([
    vote.userId === undefined
      ? null
      : ctx.db.get("users", vote.userId),
    vote.award.kind === "point"
      ? ctx.db.get("points", vote.award.pointId)
      : null,
  ]);
  if (vote.userId !== undefined && user === null) {
    domainError(
      "CONFLICT",
      "Tag vote has a missing canonical user.",
      { details: { tagVoteId: vote._id } },
    );
  }
  if (vote.award.kind === "point") {
    if (point === null) {
      domainError(
        "CONFLICT",
        "Tag vote has a missing award point.",
        { details: { tagVoteId: vote._id } },
      );
    }
    if (
      vote.userId === undefined ||
      point.userId !== vote.userId
    ) {
      domainError(
        "CONFLICT",
        "Tag-vote award point belongs to a different user.",
        { details: { tagVoteId: vote._id } },
      );
    }
  }
  const award: TagVote["award"] =
    vote.award.kind === "point" && point !== null
      ? {
          kind: "point",
          point: await hydratePointCore(ctx, point),
        }
      : vote.award.kind === "legacyAwardTombstone"
        ? { kind: "legacyAwardTombstone" }
        : { kind: "unawarded" };
  return {
    id: vote._id,
    tag: vote.tag,
    tmdbId: vote.tmdbId,
    isTag: vote.isTag ?? null,
    createdAt: vote.createdAt,
    user:
      user === null
        ? null
        : {
            id: user._id,
            name: user.name ?? null,
            image: user.image ?? null,
          },
    award,
  };
}
