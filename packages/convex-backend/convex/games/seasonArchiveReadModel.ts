import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { MAX_SEASONS_TO_INSPECT } from "./limits.js";
import { findCurrentSeason } from "./readModel.js";
import type { archiveSeasonValidator } from "./validators.js";

type ArchiveReadContext = Pick<QueryCtx, "db">;
export type ArchiveSeason = Infer<typeof archiveSeasonValidator>;

export function toArchiveSeason(
  season: Doc<"seasons">,
  isCurrent: boolean,
): ArchiveSeason {
  return {
    id: season._id,
    title: season.title,
    startedOn: season.startedOn ?? null,
    endedOn: season.endedOn ?? null,
    isCurrent,
  };
}

/**
 * Seasons a public archive can show, newest first: every season `hasActivity`
 * accepts, plus the current season so it always has a place even before
 * anything has happened in it.
 */
export async function listArchiveSeasons(
  ctx: ArchiveReadContext,
  today: string,
  hasActivity: (seasonId: Id<"seasons">) => Promise<boolean>,
): Promise<ArchiveSeason[]> {
  const [seasons, current] = await Promise.all([
    ctx.db
      .query("seasons")
      .withIndex("by_startedOn")
      .order("desc")
      .take(MAX_SEASONS_TO_INSPECT + 1),
    findCurrentSeason(ctx, today),
  ]);
  if (seasons.length > MAX_SEASONS_TO_INSPECT) {
    domainError(
      "CONFLICT",
      "Season list exceeds its bounded inspection limit.",
      { details: { limit: MAX_SEASONS_TO_INSPECT } },
    );
  }
  const listed = await Promise.all(
    seasons.map(async (season) => {
      const isCurrent = season._id === current?._id;
      const shown = isCurrent || (await hasActivity(season._id));
      return shown ? [toArchiveSeason(season, isCurrent)] : [];
    }),
  );
  return listed.flat();
}

/**
 * Seasons the public standings can show, newest first: any season with a
 * point, plus the current season.
 */
export async function listStandingsSeasons(
  ctx: ArchiveReadContext,
  today: string,
): Promise<ArchiveSeason[]> {
  return await listArchiveSeasons(
    ctx,
    today,
    async (seasonId) =>
      (await ctx.db
        .query("points")
        .withIndex("by_seasonId", (index) => index.eq("seasonId", seasonId))
        .first()) !== null,
  );
}
