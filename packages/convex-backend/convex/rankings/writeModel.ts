import type { Doc, Id } from "../_generated/dataModel.js";
import type {
  MutationCtx,
  QueryCtx,
} from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_RANKED_ITEMS_PER_LIST,
  MAX_RANKED_LIST_PAGE_SIZE,
  MAX_RANKED_LIST_TYPES,
  MAX_RANKED_LISTS_PER_TYPE,
  MAX_RANKED_LISTS_PER_USER,
} from "../games/limits.js";
import {
  listValidatedRankingItems,
  requireRankingUser,
} from "./readModel.js";

const MAX_RANKING_TEXT_LENGTH = 1000;
const MAX_RANKING_COMMENT_LENGTH = 10_000;

type RankingReadContext = Pick<QueryCtx, "db">;
type RankingWriteContext = Pick<MutationCtx, "db">;

export type RankingTargetType = "MOVIE" | "SHOW" | "EPISODE";
export type RankingStatus = "DRAFT" | "PUBLISHED";
export type RankingTarget =
  | {
      targetType: "movie";
      movieId: Id<"movies">;
    }
  | {
      targetType: "show";
      showId: Id<"shows">;
    }
  | {
      targetType: "episode";
      episodeId: Id<"episodes">;
    };

function validateRequiredText(
  rawValue: string,
  label: string,
): string {
  const value = rawValue.trim().normalize("NFKC");
  if (
    value.length < 1 ||
    value.length > MAX_RANKING_TEXT_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(MAX_RANKING_TEXT_LENGTH)} characters.`,
    );
  }
  return value;
}

function validateOptionalText(
  rawValue: string | null,
  label: string,
  maxLength: number,
): string | undefined {
  if (rawValue === null) {
    return undefined;
  }
  const value = rawValue.trim().normalize("NFKC");
  if (value.length > maxLength) {
    domainError(
      "VALIDATION_FAILED",
      `${label} cannot exceed ${String(maxLength)} characters.`,
    );
  }
  return value.length === 0 ? undefined : value;
}

export function validateRankingTypeName(value: string): string {
  return validateRequiredText(value, "Ranked-list type name");
}

export function validateRankingDescription(
  value: string | null,
): string | undefined {
  return validateOptionalText(
    value,
    "Ranked-list type description",
    MAX_RANKING_TEXT_LENGTH,
  );
}

export function validateRankingTitle(
  value: string | null,
): string | undefined {
  return validateOptionalText(
    value,
    "Ranked-list title",
    MAX_RANKING_TEXT_LENGTH,
  );
}

export function validateRankingComment(
  value: string | null,
): string | undefined {
  return validateOptionalText(
    value,
    "Ranked-item comment",
    MAX_RANKING_COMMENT_LENGTH,
  );
}

export function validateRankingTargetType(
  value: string,
): RankingTargetType {
  if (
    value !== "MOVIE" &&
    value !== "SHOW" &&
    value !== "EPISODE"
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Ranking target type must be MOVIE, SHOW, or EPISODE.",
    );
  }
  return value;
}

export function validateRankingStatus(
  value: string,
): RankingStatus {
  if (value !== "DRAFT" && value !== "PUBLISHED") {
    domainError(
      "VALIDATION_FAILED",
      "Ranked-list status must be DRAFT or PUBLISHED.",
    );
  }
  return value;
}

export function validateRankingMaxItems(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_RANKED_ITEMS_PER_LIST
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Ranked-list capacity must be an integer from 1 through ${String(MAX_RANKED_ITEMS_PER_LIST)}.`,
    );
  }
  return value;
}

export function validateRankingRank(
  value: number,
  maxItems: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maxItems
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Rank must be an integer from 1 through ${String(maxItems)}.`,
    );
  }
  return value;
}

export function validateRankingTimestamp(
  value: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value)) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be an integer epoch-millisecond value.`,
    );
  }
  return value;
}

export function validateRankingPageSize(numItems: number): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_RANKED_LIST_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Ranking page size must be an integer from 1 through ${String(MAX_RANKED_LIST_PAGE_SIZE)}.`,
    );
  }
}

export async function assertRankingTypeCatalogCapacity(
  ctx: RankingReadContext,
): Promise<void> {
  const types = await ctx.db
    .query("rankedListTypes")
    .withIndex("by_createdAt")
    .take(MAX_RANKED_LIST_TYPES);
  if (types.length >= MAX_RANKED_LIST_TYPES) {
    domainError(
      "CONFLICT",
      "The ranked-list type catalog is at capacity.",
      { details: { limit: MAX_RANKED_LIST_TYPES } },
    );
  }
}

export async function assertRankingOwnerCapacity(
  ctx: RankingReadContext,
  userId: Id<"users">,
  excludingListId?: Id<"rankedLists">,
): Promise<void> {
  const lists = await ctx.db
    .query("rankedLists")
    .withIndex("by_userId_and_updatedAt", (index) =>
      index.eq("userId", userId),
    )
    .take(MAX_RANKED_LISTS_PER_USER + 1);
  let count = 0;
  for (const list of lists) {
    if (list._id !== excludingListId) {
      count += 1;
    }
  }
  if (count >= MAX_RANKED_LISTS_PER_USER) {
    domainError(
      "CONFLICT",
      "The ranked-list owner is at capacity.",
      { details: { limit: MAX_RANKED_LISTS_PER_USER } },
    );
  }
}

export async function assertRankingTypeUpdateSafe(
  ctx: RankingReadContext,
  type: Doc<"rankedListTypes">,
  targetType: RankingTargetType,
  maxItems: number,
): Promise<void> {
  const lists = await ctx.db
    .query("rankedLists")
    .withIndex("by_rankedListTypeId", (index) =>
      index.eq("rankedListTypeId", type._id),
    )
    .take(MAX_RANKED_LISTS_PER_TYPE + 1);
  if (lists.length > MAX_RANKED_LISTS_PER_TYPE) {
    domainError(
      "CONFLICT",
      "Ranked-list type dependencies exceed the supported limit.",
      { details: { limit: MAX_RANKED_LISTS_PER_TYPE } },
    );
  }
  if (targetType !== type.targetType && lists.length > 0) {
    domainError(
      "CONFLICT",
      "A referenced ranked-list type cannot change target kind.",
    );
  }
  if (maxItems >= type.maxItems) {
    return;
  }
  for (const list of lists) {
    const items = await listValidatedRankingItems(ctx, list, type);
    if (
      items.length > maxItems ||
      items.some((item) => item.rank > maxItems)
    ) {
      domainError(
        "CONFLICT",
        "The ranked-list capacity cannot exclude existing items.",
        { details: { rankedListId: list._id } },
      );
    }
  }
}

export async function assertRankingTypeUnreferenced(
  ctx: RankingReadContext,
  typeId: Id<"rankedListTypes">,
): Promise<void> {
  const list = await ctx.db
    .query("rankedLists")
    .withIndex("by_rankedListTypeId", (index) =>
      index.eq("rankedListTypeId", typeId),
    )
    .first();
  if (list !== null) {
    domainError(
      "CONFLICT",
      "The ranked-list type is still referenced by a list.",
    );
  }
}

export async function resolveRankingTarget(
  ctx: RankingReadContext,
  listType: Doc<"rankedListTypes">,
  target:
    | { kind: "movie"; id: Id<"movies"> }
    | { kind: "show"; id: Id<"shows"> }
    | { kind: "episode"; id: Id<"episodes"> },
): Promise<RankingTarget> {
  const expectedKind =
    listType.targetType === "MOVIE"
      ? "movie"
      : listType.targetType === "SHOW"
        ? "show"
        : "episode";
  if (target.kind !== expectedKind) {
    domainError(
      "VALIDATION_FAILED",
      "The ranked-item target must match its list type.",
    );
  }
  if (target.kind === "movie") {
    const movie = await ctx.db.get("movies", target.id);
    if (movie === null) {
      domainError("NOT_FOUND", "The ranked movie is unavailable.");
    }
    return { targetType: "movie", movieId: movie._id };
  }
  if (target.kind === "show") {
    const show = await ctx.db.get("shows", target.id);
    if (show === null) {
      domainError("NOT_FOUND", "The ranked show is unavailable.");
    }
    return { targetType: "show", showId: show._id };
  }
  const episode = await ctx.db.get("episodes", target.id);
  if (episode === null) {
    domainError("NOT_FOUND", "The ranked episode is unavailable.");
  }
  return { targetType: "episode", episodeId: episode._id };
}

export function rankingTargetPatch(target: RankingTarget): {
  targetType: "movie" | "show" | "episode";
  movieId: Id<"movies"> | undefined;
  showId: Id<"shows"> | undefined;
  episodeId: Id<"episodes"> | undefined;
} {
  return {
    targetType: target.targetType,
    movieId: "movieId" in target ? target.movieId : undefined,
    showId: "showId" in target ? target.showId : undefined,
    episodeId:
      "episodeId" in target ? target.episodeId : undefined,
  };
}

export function rankingItemMatchesTarget(
  item: Doc<"rankedItems">,
  target: RankingTarget,
): boolean {
  return (
    item.targetType === target.targetType &&
    item.movieId ===
      ("movieId" in target ? target.movieId : undefined) &&
    item.showId ===
      ("showId" in target ? target.showId : undefined) &&
    item.episodeId ===
      ("episodeId" in target ? target.episodeId : undefined)
  );
}

export async function deleteRankingListItems(
  ctx: RankingWriteContext,
  list: Doc<"rankedLists">,
  type: Doc<"rankedListTypes">,
): Promise<number> {
  const items = await listValidatedRankingItems(ctx, list, type);
  for (const item of items) {
    await ctx.db.delete("rankedItems", item._id);
  }
  return items.length;
}

export async function requireRankingOwner(
  ctx: RankingReadContext,
  id: Id<"users">,
): Promise<Doc<"users">> {
  return await requireRankingUser(ctx, id);
}
