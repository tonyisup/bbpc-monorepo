import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { normalizeLookupKey } from "../lib/normalize.js";

const MAX_GAME_TEXT_LENGTH = 1000;
const MIN_SQL_SMALLINT = -32_768;
const MAX_SQL_SMALLINT = 32_767;

type GameWriteContext = Pick<QueryCtx, "db">;

export function validateGameTitle(
  value: string,
  label: string,
): string {
  const title = value.trim().normalize("NFKC");
  if (title.length < 1 || title.length > MAX_GAME_TEXT_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(MAX_GAME_TEXT_LENGTH)} characters.`,
    );
  }
  return title;
}

export function validateOptionalGameText(
  value: string | null,
  label: string,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  const text = value.trim().normalize("NFKC");
  if (text.length > MAX_GAME_TEXT_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `${label} cannot exceed ${String(MAX_GAME_TEXT_LENGTH)} characters.`,
    );
  }
  return text.length === 0 ? undefined : text;
}

export function validateGameLookupId(
  value: string,
  label: string,
): { lookupId: string; normalizedLookupId: string } {
  const lookupId = validateGameTitle(value, label);
  return {
    lookupId,
    normalizedLookupId: normalizeLookupKey(lookupId, label),
  };
}

export function validatePointTypeValue(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_SQL_SMALLINT ||
    value > MAX_SQL_SMALLINT
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Game point value must be an integer in the SQL SMALLINT range.",
    );
  }
  return value;
}

export function validatePlainDate(
  value: string,
  label: string,
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must use YYYY-MM-DD format.`,
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a real calendar date.`,
    );
  }
  return value;
}

export function validateSeasonRange(
  startedOn: string,
  endedOn: string | undefined,
): void {
  if (endedOn !== undefined && endedOn < startedOn) {
    domainError(
      "VALIDATION_FAILED",
      "Season end date cannot be before its start date.",
    );
  }
}

export async function requireGameType(
  ctx: GameWriteContext,
  id: Id<"gameTypes">,
): Promise<Doc<"gameTypes">> {
  const gameType = await ctx.db.get("gameTypes", id);
  if (gameType === null) {
    domainError("NOT_FOUND", "The game type is unavailable.");
  }
  return gameType;
}

export async function requireGamePointType(
  ctx: GameWriteContext,
  id: Id<"gamePointTypes">,
): Promise<Doc<"gamePointTypes">> {
  const pointType = await ctx.db.get("gamePointTypes", id);
  if (pointType === null) {
    domainError("NOT_FOUND", "The game point type is unavailable.");
  }
  return pointType;
}

export async function requireSeason(
  ctx: GameWriteContext,
  id: Id<"seasons">,
): Promise<Doc<"seasons">> {
  const season = await ctx.db.get("seasons", id);
  if (season === null) {
    domainError("NOT_FOUND", "The season is unavailable.");
  }
  return season;
}

export async function assertUniqueGameTypeLookup(
  ctx: GameWriteContext,
  normalizedLookupId: string,
  excludeId?: Id<"gameTypes">,
): Promise<void> {
  const existing = await ctx.db
    .query("gameTypes")
    .withIndex("by_normalizedLookupId", (index) =>
      index.eq("normalizedLookupId", normalizedLookupId),
    )
    .take(2);
  if (existing.some((gameType) => gameType._id !== excludeId)) {
    domainError("CONFLICT", "The game type lookup ID is in use.");
  }
}

export async function assertUniqueGamePointTypeLookup(
  ctx: GameWriteContext,
  normalizedLookupId: string,
  excludeId?: Id<"gamePointTypes">,
): Promise<void> {
  const existing = await ctx.db
    .query("gamePointTypes")
    .withIndex("by_normalizedLookupId", (index) =>
      index.eq("normalizedLookupId", normalizedLookupId),
    )
    .take(2);
  if (
    existing.some((pointType) => pointType._id !== excludeId)
  ) {
    domainError(
      "CONFLICT",
      "The game point type lookup ID is in use.",
    );
  }
}

export async function assertGameTypeUnreferenced(
  ctx: GameWriteContext,
  gameTypeId: Id<"gameTypes">,
): Promise<void> {
  const [pointType, season] = await Promise.all([
    ctx.db
      .query("gamePointTypes")
      .withIndex("by_gameTypeId", (index) =>
        index.eq("gameTypeId", gameTypeId),
      )
      .first(),
    ctx.db
      .query("seasons")
      .withIndex("by_gameTypeId", (index) =>
        index.eq("gameTypeId", gameTypeId),
      )
      .first(),
  ]);
  const relationship =
    pointType !== null
      ? "game point type"
      : season !== null
        ? "season"
        : undefined;
  if (relationship !== undefined) {
    domainError(
      "CONFLICT",
      "The game type cannot be deleted while it is referenced.",
      { details: { relationship } },
    );
  }
}

export async function assertGamePointTypeUnreferenced(
  ctx: GameWriteContext,
  gamePointTypeId: Id<"gamePointTypes">,
): Promise<void> {
  const point = await ctx.db
    .query("points")
    .withIndex("by_gamePointTypeId", (index) =>
      index.eq("gamePointTypeId", gamePointTypeId),
    )
    .first();
  if (point !== null) {
    domainError(
      "CONFLICT",
      "The game point type cannot be deleted while points reference it.",
      { details: { relationship: "point" } },
    );
  }
}

export async function assertSeasonUnreferenced(
  ctx: GameWriteContext,
  seasonId: Id<"seasons">,
): Promise<void> {
  const references = await Promise.all([
    ctx.db
      .query("points")
      .withIndex("by_seasonId", (index) =>
        index.eq("seasonId", seasonId),
      )
      .first(),
    ctx.db
      .query("guesses")
      .withIndex("by_seasonId", (index) =>
        index.eq("seasonId", seasonId),
      )
      .first(),
    ctx.db
      .query("gamblingEntries")
      .withIndex("by_seasonId", (index) =>
        index.eq("seasonId", seasonId),
      )
      .first(),
    ctx.db
      .query("quoteSubmissions")
      .withIndex("by_seasonId", (index) =>
        index.eq("seasonId", seasonId),
      )
      .first(),
  ]);
  const relationship = [
    "point",
    "guess",
    "gambling entry",
    "quote submission",
  ].find((_, index) => references[index] !== null);
  if (relationship !== undefined) {
    domainError(
      "CONFLICT",
      "The season cannot be deleted while it is referenced.",
      { details: { relationship } },
    );
  }
}
