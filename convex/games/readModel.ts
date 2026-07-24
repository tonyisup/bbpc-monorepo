import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_SEASON_RELATIONSHIPS_FOR_COUNT,
  MAX_SEASONS_TO_INSPECT,
} from "./limits.js";

type GameReadContext = Pick<QueryCtx, "db">;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

export function toGameType(gameType: Doc<"gameTypes">) {
  return {
    id: gameType._id,
    title: gameType.title,
    description: nullable(gameType.description),
    lookupId: gameType.lookupId,
  };
}

export async function hydrateGamePointType(
  ctx: GameReadContext,
  pointType: Doc<"gamePointTypes">,
) {
  const gameType = await ctx.db.get(
    "gameTypes",
    pointType.gameTypeId,
  );
  if (gameType === null) {
    domainError(
      "CONFLICT",
      "Game point type has a missing game type relationship.",
      { details: { gamePointTypeId: pointType._id } },
    );
  }
  return {
    id: pointType._id,
    title: pointType.title,
    description: nullable(pointType.description),
    lookupId: pointType.lookupId,
    points: pointType.points,
    gameType: toGameType(gameType),
  };
}

export async function hydrateSeason(
  ctx: GameReadContext,
  season: Doc<"seasons">,
) {
  const gameType = await ctx.db.get("gameTypes", season.gameTypeId);
  if (gameType === null) {
    domainError(
      "CONFLICT",
      "Season has a missing game type relationship.",
      { details: { seasonId: season._id } },
    );
  }
  return {
    id: season._id,
    title: season.title,
    description: nullable(season.description),
    startedOn: nullable(season.startedOn),
    endedOn: nullable(season.endedOn),
    gameType: toGameType(gameType),
  };
}

function toBoundedCount(rows: unknown[]) {
  const isExact =
    rows.length <= MAX_SEASON_RELATIONSHIPS_FOR_COUNT;
  return {
    count: Math.min(
      rows.length,
      MAX_SEASON_RELATIONSHIPS_FOR_COUNT,
    ),
    isExact,
  };
}

export async function hydrateAdminSeason(
  ctx: GameReadContext,
  season: Doc<"seasons">,
) {
  const [detail, points, guesses, gamblingEntries, quoteSubmissions] =
    await Promise.all([
      hydrateSeason(ctx, season),
      ctx.db
        .query("points")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", season._id),
        )
        .take(MAX_SEASON_RELATIONSHIPS_FOR_COUNT + 1),
      ctx.db
        .query("guesses")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", season._id),
        )
        .take(MAX_SEASON_RELATIONSHIPS_FOR_COUNT + 1),
      ctx.db
        .query("gamblingEntries")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", season._id),
        )
        .take(MAX_SEASON_RELATIONSHIPS_FOR_COUNT + 1),
      ctx.db
        .query("quoteSubmissions")
        .withIndex("by_seasonId", (index) =>
          index.eq("seasonId", season._id),
        )
        .take(MAX_SEASON_RELATIONSHIPS_FOR_COUNT + 1),
    ]);
  return {
    ...detail,
    counts: {
      points: toBoundedCount(points),
      guesses: toBoundedCount(guesses),
      gamblingEntries: toBoundedCount(gamblingEntries),
      quoteSubmissions: toBoundedCount(quoteSubmissions),
    },
  };
}

export async function findCurrentSeason(
  ctx: GameReadContext,
  today: string,
): Promise<Doc<"seasons"> | null> {
  const candidates = await ctx.db
    .query("seasons")
    .withIndex("by_startedOn", (index) =>
      index.lte("startedOn", today),
    )
    .order("desc")
    .take(MAX_SEASONS_TO_INSPECT + 1);
  for (const season of candidates.slice(0, MAX_SEASONS_TO_INSPECT)) {
    if (
      season.startedOn !== undefined &&
      (season.endedOn === undefined || season.endedOn >= today)
    ) {
      return season;
    }
  }
  if (candidates.length > MAX_SEASONS_TO_INSPECT) {
    domainError(
      "CONFLICT",
      "Current season lookup exceeds its bounded inspection limit.",
      { details: { limit: MAX_SEASONS_TO_INSPECT } },
    );
  }
  return null;
}

export async function requireGameTypeDocument(
  ctx: GameReadContext,
  id: Id<"gameTypes">,
): Promise<Doc<"gameTypes">> {
  const gameType = await ctx.db.get("gameTypes", id);
  if (gameType === null) {
    domainError("NOT_FOUND", "The game type is unavailable.");
  }
  return gameType;
}
