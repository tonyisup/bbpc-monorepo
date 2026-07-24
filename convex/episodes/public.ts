import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { anonymousQuery } from "../functions.js";
import { domainError } from "../lib/errors.js";
import { normalizeLookupKey } from "../lib/normalize.js";
import { hydrateEpisode } from "./readModel.js";
import { episodeDetailValidator } from "./validators.js";

function requirePlainDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    domainError(
      "VALIDATION_FAILED",
      "onOrBefore must use YYYY-MM-DD format.",
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    domainError(
      "VALIDATION_FAILED",
      "onOrBefore must be a real calendar date.",
    );
  }
  return value;
}

export const latestPublished = anonymousQuery({
  args: { onOrBefore: v.string() },
  returns: v.union(episodeDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const onOrBefore = requirePlainDate(args.onOrBefore);
    const [lowercasePublished, titleCasePublished] =
      await Promise.all([
        ctx.db
          .query("episodes")
          .withIndex("by_status_and_date", (query) =>
            query
              .eq("status", "published")
              .lte("date", onOrBefore),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("episodes")
          .withIndex("by_status_and_date", (query) =>
            query
              .eq("status", "Published")
              .lte("date", onOrBefore),
          )
          .order("desc")
          .first(),
      ]);
    const episode =
      lowercasePublished === null
        ? titleCasePublished
        : titleCasePublished === null ||
            (lowercasePublished.date ?? "") >=
              (titleCasePublished.date ?? "")
          ? lowercasePublished
          : titleCasePublished;
    return episode === null
      ? null
      : await hydrateEpisode(ctx, episode);
  },
});

export const nextScheduled = anonymousQuery({
  args: {},
  returns: v.union(episodeDetailValidator, v.null()),
  handler: async (ctx) => {
    const [nextEpisode, recordingEpisode] = await Promise.all([
      ctx.db
        .query("episodes")
        .withIndex("by_status_and_number", (query) =>
          query.eq("status", "next"),
        )
        .order("desc")
        .first(),
      ctx.db
        .query("episodes")
        .withIndex("by_status_and_number", (query) =>
          query.eq("status", "recording"),
        )
        .order("desc")
        .first(),
    ]);
    const episode =
      nextEpisode === null
        ? recordingEpisode
        : recordingEpisode === null ||
            nextEpisode.number >= recordingEpisode.number
          ? nextEpisode
          : recordingEpisode;
    return episode === null
      ? null
      : await hydrateEpisode(ctx, episode);
  },
});

export const getBySlug = anonymousQuery({
  args: { slug: v.string() },
  returns: v.union(episodeDetailValidator, v.null()),
  handler: async (ctx, args) => {
    const normalizedSlug = normalizeLookupKey(
      args.slug,
      "Episode slug",
    );
    const episode = await ctx.db
      .query("episodes")
      .withIndex("by_normalizedSlug", (query) =>
        query.eq("normalizedSlug", normalizedSlug),
      )
      .unique();
    return episode === null
      ? null
      : await hydrateEpisode(ctx, episode);
  },
});

export const listPage = anonymousQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(episodeDetailValidator),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("episodes")
      .withIndex("by_date_and_status")
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((episode) =>
          hydrateEpisode(ctx, episode),
        ),
      ),
    };
  },
});
