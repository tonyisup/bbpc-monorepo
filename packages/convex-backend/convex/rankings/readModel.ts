import type { Infer } from "convex/values";

import { toCatalogMovie, toCatalogShow } from "../catalog/readModel.js";
import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import type { UserActor } from "../lib/actors.js";
import { domainError } from "../lib/errors.js";
import { MAX_RANKED_ITEMS_PER_LIST } from "../games/limits.js";
import type {
  rankingItemValidator,
  rankingListDetailValidator,
  rankingListSummaryValidator,
  rankingListTypeValidator,
} from "./validators.js";

type RankingReadContext = Pick<QueryCtx, "db">;
type RankingItem = Infer<typeof rankingItemValidator>;
type RankingListDetail = Infer<typeof rankingListDetailValidator>;
type RankingListSummary = Infer<typeof rankingListSummaryValidator>;
type RankingListType = Infer<typeof rankingListTypeValidator>;

export function toRankingListType(
  type: Doc<"rankedListTypes">,
): RankingListType {
  return {
    id: type._id,
    name: type.name,
    description: type.description ?? null,
    maxItems: type.maxItems,
    targetType: type.targetType,
    createdAt: type.createdAt,
    updatedAt: type.updatedAt,
  };
}

export function toRankingOwner(user: Doc<"users">) {
  return {
    id: user._id,
    name: user.name ?? null,
    image: user.image ?? null,
  };
}

export async function requireRankingListType(
  ctx: RankingReadContext,
  id: Id<"rankedListTypes">,
): Promise<Doc<"rankedListTypes">> {
  const type = await ctx.db.get("rankedListTypes", id);
  if (type === null) {
    domainError("NOT_FOUND", "The ranked-list type is unavailable.");
  }
  if (
    !Number.isSafeInteger(type.maxItems) ||
    type.maxItems < 1 ||
    type.maxItems > MAX_RANKED_ITEMS_PER_LIST
  ) {
    domainError(
      "CONFLICT",
      "The ranked-list type has invalid item bounds.",
      { details: { rankedListTypeId: type._id } },
    );
  }
  return type;
}

export async function requireRankingList(
  ctx: RankingReadContext,
  id: Id<"rankedLists">,
): Promise<Doc<"rankedLists">> {
  const list = await ctx.db.get("rankedLists", id);
  if (list === null) {
    domainError("NOT_FOUND", "The ranked list is unavailable.");
  }
  return list;
}

export async function requireRankingItem(
  ctx: RankingReadContext,
  id: Id<"rankedItems">,
): Promise<Doc<"rankedItems">> {
  const item = await ctx.db.get("rankedItems", id);
  if (item === null) {
    domainError("NOT_FOUND", "The ranked item is unavailable.");
  }
  return item;
}

export async function requireRankingUser(
  ctx: RankingReadContext,
  id: Id<"users">,
): Promise<Doc<"users">> {
  const user = await ctx.db.get("users", id);
  if (user === null) {
    domainError("NOT_FOUND", "The ranked-list owner is unavailable.");
  }
  return user;
}

export function assertRankingListAccess(
  actor: UserActor,
  list: Doc<"rankedLists">,
): void {
  if (list.userId !== actor.user._id && !actor.isAdmin) {
    domainError(
      "FORBIDDEN",
      "You cannot access another user's ranked list.",
    );
  }
}

function itemTargetKey(
  item: Doc<"rankedItems">,
  listType: Doc<"rankedListTypes">,
): string {
  if (
    listType.targetType === "MOVIE" &&
    item.targetType === "movie" &&
    item.movieId !== undefined &&
    item.showId === undefined &&
    item.episodeId === undefined
  ) {
    return `movie:${String(item.movieId)}`;
  }
  if (
    listType.targetType === "SHOW" &&
    item.targetType === "show" &&
    item.movieId === undefined &&
    item.showId !== undefined &&
    item.episodeId === undefined
  ) {
    return `show:${String(item.showId)}`;
  }
  if (
    listType.targetType === "EPISODE" &&
    item.targetType === "episode" &&
    item.movieId === undefined &&
    item.showId === undefined &&
    item.episodeId !== undefined
  ) {
    return `episode:${String(item.episodeId)}`;
  }
  domainError(
    "CONFLICT",
    "A ranked item target does not match its owning list type.",
    { details: { rankedItemId: item._id } },
  );
}

export async function listValidatedRankingItems(
  ctx: RankingReadContext,
  list: Doc<"rankedLists">,
  listType: Doc<"rankedListTypes">,
): Promise<Array<Doc<"rankedItems">>> {
  const items = await ctx.db
    .query("rankedItems")
    .withIndex("by_rankedListId_and_rank", (index) =>
      index.eq("rankedListId", list._id),
    )
    .take(MAX_RANKED_ITEMS_PER_LIST + 1);
  if (
    items.length > MAX_RANKED_ITEMS_PER_LIST ||
    items.length > listType.maxItems
  ) {
    domainError(
      "CONFLICT",
      "The ranked list exceeds its supported item capacity.",
      {
        details: {
          limit: Math.min(
            MAX_RANKED_ITEMS_PER_LIST,
            listType.maxItems,
          ),
        },
      },
    );
  }
  const ranks = new Set<number>();
  const targets = new Set<string>();
  for (const item of items) {
    if (
      !Number.isSafeInteger(item.rank) ||
      item.rank < 1 ||
      item.rank > listType.maxItems
    ) {
      domainError(
        "CONFLICT",
        "A ranked item has an out-of-bounds rank.",
        { details: { rankedItemId: item._id } },
      );
    }
    if (ranks.has(item.rank)) {
      domainError(
        "CONFLICT",
        "The ranked list contains a duplicate rank.",
        { details: { rank: item.rank } },
      );
    }
    ranks.add(item.rank);
    const targetKey = itemTargetKey(item, listType);
    if (targets.has(targetKey)) {
      domainError(
        "CONFLICT",
        "The ranked list contains a duplicate target.",
      );
    }
    targets.add(targetKey);
  }
  return items;
}

export async function hydrateRankingItem(
  ctx: RankingReadContext,
  item: Doc<"rankedItems">,
  listType: Doc<"rankedListTypes">,
): Promise<RankingItem> {
  itemTargetKey(item, listType);
  const [movie, show, episode] = await Promise.all([
    item.movieId === undefined
      ? null
      : ctx.db.get("movies", item.movieId),
    item.showId === undefined
      ? null
      : ctx.db.get("shows", item.showId),
    item.episodeId === undefined
      ? null
      : ctx.db.get("episodes", item.episodeId),
  ]);
  if (
    (item.movieId !== undefined && movie === null) ||
    (item.showId !== undefined && show === null) ||
    (item.episodeId !== undefined && episode === null)
  ) {
    domainError(
      "CONFLICT",
      "A ranked item references a missing target.",
      { details: { rankedItemId: item._id } },
    );
  }
  return {
    id: item._id,
    rankedListId: item.rankedListId,
    targetType: item.targetType,
    movieId: item.movieId ?? null,
    showId: item.showId ?? null,
    episodeId: item.episodeId ?? null,
    movie: movie === null ? null : toCatalogMovie(movie),
    show: show === null ? null : toCatalogShow(show),
    episode:
      episode === null
        ? null
        : {
            id: episode._id,
            number: episode.number,
            title: episode.title,
            date: episode.date ?? null,
            status: episode.status ?? null,
          },
    rank: item.rank,
    comment: item.comment ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export async function hydrateRankingListSummary(
  ctx: RankingReadContext,
  list: Doc<"rankedLists">,
): Promise<RankingListSummary> {
  const [user, type] = await Promise.all([
    ctx.db.get("users", list.userId),
    ctx.db.get("rankedListTypes", list.rankedListTypeId),
  ]);
  if (user === null || type === null) {
    domainError(
      "CONFLICT",
      "The ranked list has a missing canonical relationship.",
      { details: { rankedListId: list._id } },
    );
  }
  const checkedType = await requireRankingListType(ctx, type._id);
  const items = await listValidatedRankingItems(ctx, list, checkedType);
  return {
    id: list._id,
    userId: list.userId,
    rankedListTypeId: list.rankedListTypeId,
    status: list.status,
    title: list.title ?? null,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    user: toRankingOwner(user),
    type: toRankingListType(checkedType),
    itemCount: items.length,
  };
}

export async function hydrateRankingListDetail(
  ctx: RankingReadContext,
  list: Doc<"rankedLists">,
): Promise<RankingListDetail> {
  const summary = await hydrateRankingListSummary(ctx, list);
  const type = await requireRankingListType(
    ctx,
    list.rankedListTypeId,
  );
  const items = await listValidatedRankingItems(ctx, list, type);
  return {
    ...summary,
    items: await Promise.all(
      items.map((item) => hydrateRankingItem(ctx, item, type)),
    ),
  };
}
