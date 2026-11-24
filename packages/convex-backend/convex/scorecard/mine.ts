import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import {
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  hydrateRankingListDetail,
  requireRankingList,
  requireRankingListType,
} from "../rankings/readModel.js";
import { rankingListDetailValidator } from "../rankings/validators.js";
import {
  assertRankingOwnerCapacity,
  deleteRankingListItems,
  validateRankingTitle,
} from "../rankings/writeModel.js";
import { requireScorecardOwner } from "./access.js";
import {
  SCORECARD_TOP_COUNT,
  validateScorecardScore,
  validateScorecardYear,
} from "./limits.js";
import {
  createEntryIfMissing,
  findScorecardEntry,
  hydrateScorecardEntry,
  hydrateScorecardRow,
  loadScorecardYear,
} from "./model.js";
import {
  scorecardApplyTargetValidator,
  scorecardCriterionValidator,
  scorecardEntryValidator,
} from "./validators.js";

export const listForYear = authenticatedQuery({
  args: { year: v.number() },
  returns: v.array(scorecardEntryValidator),
  handler: async (ctx, args) => {
    const userId = requireScorecardOwner(ctx.actor);
    const year = validateScorecardYear(args.year);
    const view = await loadScorecardYear(ctx, userId, year);
    return await Promise.all(
      view.rows.map((row) => hydrateScorecardRow(ctx, view, row)),
    );
  },
});

export const setScore = authenticatedMutation({
  args: {
    year: v.number(),
    movieId: v.id("movies"),
    criterion: scorecardCriterionValidator,
    value: v.number(),
  },
  returns: scorecardEntryValidator,
  handler: async (ctx, args) => {
    const userId = requireScorecardOwner(ctx.actor);
    const year = validateScorecardYear(args.year);
    const value = validateScorecardScore(args.value);
    const now = Date.now();
    const entry = await createEntryIfMissing(ctx, {
      userId,
      year,
      movieId: args.movieId,
      now,
    });
    await ctx.db.patch("scorecardEntries", entry._id, {
      [args.criterion]: value,
      unseen: false,
      tieOrder: undefined,
      updatedAt: now,
    });
    return await hydrateScorecardEntry(ctx, userId, year, entry._id);
  },
});

export const add = authenticatedMutation({
  args: { year: v.number(), movieId: v.id("movies") },
  returns: scorecardEntryValidator,
  handler: async (ctx, args) => {
    const userId = requireScorecardOwner(ctx.actor);
    const year = validateScorecardYear(args.year);
    const entry = await createEntryIfMissing(ctx, {
      userId,
      year,
      movieId: args.movieId,
      now: Date.now(),
    });
    return await hydrateScorecardEntry(ctx, userId, year, entry._id);
  },
});

export const setUnseen = authenticatedMutation({
  args: {
    year: v.number(),
    movieId: v.id("movies"),
    unseen: v.boolean(),
  },
  returns: scorecardEntryValidator,
  handler: async (ctx, args) => {
    const userId = requireScorecardOwner(ctx.actor);
    const year = validateScorecardYear(args.year);
    const now = Date.now();
    const entry = await createEntryIfMissing(ctx, {
      userId,
      year,
      movieId: args.movieId,
      now,
    });
    await ctx.db.patch("scorecardEntries", entry._id, {
      unseen: args.unseen,
      tieOrder: undefined,
      updatedAt: now,
    });
    return await hydrateScorecardEntry(ctx, userId, year, entry._id);
  },
});

export const clear = authenticatedMutation({
  args: { year: v.number(), movieId: v.id("movies") },
  returns: v.object({ movieId: v.id("movies") }),
  handler: async (ctx, args) => {
    const userId = requireScorecardOwner(ctx.actor);
    const year = validateScorecardYear(args.year);
    const entry = await findScorecardEntry(ctx, userId, year, args.movieId);
    if (entry !== null) {
      await ctx.db.delete("scorecardEntries", entry._id);
    }
    return { movieId: args.movieId };
  },
});

export const orderTie = authenticatedMutation({
  args: { year: v.number(), movieIds: v.array(v.id("movies")) },
  returns: v.array(scorecardEntryValidator),
  handler: async (ctx, args) => {
    const userId = requireScorecardOwner(ctx.actor);
    const year = validateScorecardYear(args.year);
    if (
      args.movieIds.length < 2 ||
      new Set(args.movieIds).size !== args.movieIds.length
    ) {
      domainError(
        "VALIDATION_FAILED",
        "Order a tie with at least two distinct movies.",
      );
    }
    const view = await loadScorecardYear(ctx, userId, year);
    const first = view.placements.find(
      (placement) => placement.entry.row.doc.movieId === args.movieIds[0],
    );
    const group =
      first === undefined
        ? []
        : view.placements.filter((placement) => placement.sum === first.sum);
    const groupMovieIds = new Set(
      group.map((placement) => placement.entry.row.doc.movieId),
    );
    if (
      group.length !== args.movieIds.length ||
      args.movieIds.some((movieId) => !groupMovieIds.has(movieId))
    ) {
      domainError(
        "VALIDATION_FAILED",
        "A tie order must list every movie in the tied group exactly once.",
      );
    }
    const now = Date.now();
    const ordered: Array<Doc<"scorecardEntries">> = [];
    for (const [index, movieId] of args.movieIds.entries()) {
      const placement = group.find(
        (candidate) => candidate.entry.row.doc.movieId === movieId,
      );
      if (placement === undefined) {
        domainError("INTERNAL_ERROR", "The tied group changed while saving.");
      }
      const doc = placement.entry.row.doc;
      await ctx.db.patch("scorecardEntries", doc._id, {
        tieOrder: index + 1,
        updatedAt: now,
      });
      ordered.push(doc);
    }
    const updated = await loadScorecardYear(ctx, userId, year);
    return await Promise.all(
      ordered.map((doc) => {
        const row = updated.rows.find(
          (candidate) => candidate.doc._id === doc._id,
        );
        if (row === undefined) {
          domainError("INTERNAL_ERROR", "The tied group changed while saving.");
        }
        return hydrateScorecardRow(ctx, updated, row);
      }),
    );
  },
});

export const applyToRankedList = authenticatedMutation({
  args: {
    year: v.number(),
    target: scorecardApplyTargetValidator,
    expectedMovieIds: v.array(v.id("movies")),
  },
  returns: rankingListDetailValidator,
  handler: async (ctx, args) => {
    const userId = requireScorecardOwner(ctx.actor);
    const year = validateScorecardYear(args.year);

    let existingList: Doc<"rankedLists"> | null = null;
    let typeId: Id<"rankedListTypes">;
    let createTitle: string | undefined;
    if (args.target.kind === "existing") {
      existingList = await requireRankingList(ctx, args.target.rankedListId);
      // Owner only: unlike other ranked-list writes there is no admin bypass.
      if (existingList.userId !== userId) {
        domainError(
          "FORBIDDEN",
          "You can only fill your own ranked lists from your scorecard.",
        );
      }
      typeId = existingList.rankedListTypeId;
    } else {
      typeId = args.target.rankedListTypeId;
      createTitle = validateRankingTitle(args.target.title) ?? undefined;
    }
    const type = await requireRankingListType(ctx, typeId);
    if (type.targetType !== "MOVIE") {
      domainError(
        "VALIDATION_FAILED",
        "Scorecard results can only fill a movie ranked list.",
      );
    }

    const view = await loadScorecardYear(ctx, userId, year);
    const count = Math.min(
      SCORECARD_TOP_COUNT,
      type.maxItems,
      view.placements.length,
    );
    if (count === 0) {
      domainError(
        "VALIDATION_FAILED",
        "Score at least one movie completely before using it as a list.",
      );
    }
    const top = view.placements
      .slice(0, count)
      .map((placement) => placement.entry.row.doc.movieId);
    if (
      top.length !== args.expectedMovieIds.length ||
      top.some((movieId, index) => movieId !== args.expectedMovieIds[index])
    ) {
      domainError(
        "CONFLICT",
        "Your scorecard changed. Review the new top movies and try again.",
      );
    }

    const now = Date.now();
    let list: Doc<"rankedLists">;
    if (existingList !== null) {
      await deleteRankingListItems(ctx, existingList, type);
      list = existingList;
    } else {
      await assertRankingOwnerCapacity(ctx, userId);
      const listId = await ctx.db.insert("rankedLists", {
        userId,
        rankedListTypeId: type._id,
        status: "DRAFT",
        ...(createTitle === undefined ? {} : { title: createTitle }),
        createdAt: now,
        updatedAt: now,
      });
      list = await requireRankingList(ctx, listId);
    }
    for (const [index, movieId] of top.entries()) {
      await ctx.db.insert("rankedItems", {
        rankedListId: list._id,
        targetType: "movie",
        movieId,
        rank: index + 1,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch("rankedLists", list._id, { updatedAt: now });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "rankings.user.listReplacedFromScorecard",
      targetType: "rankedList",
      targetId: list._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { itemCount: top.length },
    });
    return await hydrateRankingListDetail(
      ctx,
      await requireRankingList(ctx, list._id),
    );
  },
});
