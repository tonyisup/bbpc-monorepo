import { v } from "convex/values";

import {
  catalogMovieValidator,
  catalogShowValidator,
} from "../catalog/validators.js";

const nullableStringValidator = v.union(v.string(), v.null());
const nullableId = <TableName extends string>(
  tableName: TableName,
) => v.union(v.id(tableName), v.null());

export const rankingTargetTypeValidator = v.union(
  v.literal("MOVIE"),
  v.literal("SHOW"),
  v.literal("EPISODE"),
);

export const rankingStatusValidator = v.union(
  v.literal("DRAFT"),
  v.literal("PUBLISHED"),
);

export const rankingListTypeValidator = v.object({
  id: v.id("rankedListTypes"),
  name: v.string(),
  description: nullableStringValidator,
  maxItems: v.number(),
  targetType: rankingTargetTypeValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const rankingOwnerValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  image: nullableStringValidator,
});

export const rankingEpisodeTargetValidator = v.object({
  id: v.id("episodes"),
  number: v.number(),
  title: v.string(),
  date: nullableStringValidator,
  status: nullableStringValidator,
});

export const rankingItemValidator = v.object({
  id: v.id("rankedItems"),
  rankedListId: v.id("rankedLists"),
  targetType: v.union(
    v.literal("movie"),
    v.literal("show"),
    v.literal("episode"),
  ),
  movieId: nullableId("movies"),
  showId: nullableId("shows"),
  episodeId: nullableId("episodes"),
  movie: v.union(catalogMovieValidator, v.null()),
  show: v.union(catalogShowValidator, v.null()),
  episode: v.union(rankingEpisodeTargetValidator, v.null()),
  rank: v.number(),
  comment: nullableStringValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const rankingListSummaryValidator = v.object({
  id: v.id("rankedLists"),
  userId: v.id("users"),
  rankedListTypeId: v.id("rankedListTypes"),
  status: rankingStatusValidator,
  title: nullableStringValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  user: rankingOwnerValidator,
  type: rankingListTypeValidator,
  itemCount: v.number(),
});

export const rankingListDetailValidator =
  rankingListSummaryValidator.extend({
    items: v.array(rankingItemValidator),
  });

export const rankingTargetInputValidator = v.union(
  v.object({
    kind: v.literal("movie"),
    id: v.id("movies"),
  }),
  v.object({
    kind: v.literal("show"),
    id: v.id("shows"),
  }),
  v.object({
    kind: v.literal("episode"),
    id: v.id("episodes"),
  }),
);
