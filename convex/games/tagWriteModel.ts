import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx, QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { normalizeLookupKey } from "../lib/normalize.js";

const MAX_TAG_TEXT_LENGTH = 1000;
const MAX_SQL_INT = 2_147_483_647;
const MAX_POINT_REASON_LENGTH = 1000;

type TagReadContext = Pick<QueryCtx, "db">;
type TagWriteContext = Pick<MutationCtx, "db">;

export function validateTagName(rawName: string): {
  name: string;
  normalizedName: string;
} {
  const name = rawName.trim().normalize("NFKC");
  if (name.length < 1 || name.length > MAX_TAG_TEXT_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Tag name must contain 1 through ${String(MAX_TAG_TEXT_LENGTH)} characters.`,
    );
  }
  return {
    name,
    normalizedName: normalizeLookupKey(name, "Tag name"),
  };
}

export function validateTagDescription(
  rawDescription: string | null,
): string | undefined {
  if (rawDescription === null) {
    return undefined;
  }
  const description = rawDescription.trim().normalize("NFKC");
  if (description.length > MAX_TAG_TEXT_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Tag description cannot exceed ${String(MAX_TAG_TEXT_LENGTH)} characters.`,
    );
  }
  return description.length === 0 ? undefined : description;
}

export function validateTagVoteTmdbId(tmdbId: number): number {
  if (
    !Number.isSafeInteger(tmdbId) ||
    tmdbId < 1 ||
    tmdbId > MAX_SQL_INT
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Tag-vote TMDB ID must be a positive integer in the SQL INT range.",
    );
  }
  return tmdbId;
}

export async function assertTagNameAvailable(
  ctx: TagReadContext,
  normalizedName: string,
  excludedId?: Id<"tags">,
): Promise<void> {
  const existing = await ctx.db
    .query("tags")
    .withIndex("by_normalizedName", (index) =>
      index.eq("normalizedName", normalizedName),
    )
    .unique();
  if (existing !== null && existing._id !== excludedId) {
    domainError("CONFLICT", "A tag with this name already exists.");
  }
}

export async function countTagCatalog(
  ctx: TagReadContext,
  limit: number,
): Promise<number> {
  return (
    await ctx.db
      .query("tags")
      .withIndex("by_normalizedName")
      .take(limit + 1)
  ).length;
}

export async function createTag(
  ctx: TagWriteContext,
  input: {
    name: string;
    normalizedName: string;
    description?: string;
    createdAt: number;
  },
): Promise<Doc<"tags">> {
  const id = await ctx.db.insert("tags", {
    name: input.name,
    normalizedName: input.normalizedName,
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    createdAt: input.createdAt,
  });
  const tag = await ctx.db.get("tags", id);
  if (tag === null) {
    throw new Error("Created tag could not be reloaded");
  }
  return tag;
}

export function buildTagVotePointReason(
  vote: Doc<"tagVotes">,
): string {
  const prefix = "Voted on tag: ";
  const suffix = ` for TMDB movie ${String(vote.tmdbId)}`;
  const tagLength = Math.max(
    0,
    MAX_POINT_REASON_LENGTH - prefix.length - suffix.length,
  );
  return `${prefix}${vote.tag.slice(0, tagLength)}${suffix}`;
}
