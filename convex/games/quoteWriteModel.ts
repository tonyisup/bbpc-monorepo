import type { Doc, Id } from "../_generated/dataModel.js";
import type {
  MutationCtx,
  QueryCtx,
} from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  assertPointRelationshipCapacity,
  deletePointAndClearRelationships,
  requirePoint,
  resolvePointSeason,
} from "./pointWriteModel.js";

const MAX_QUOTE_TEXT_LENGTH = 2000;
const MAX_SOURCE_TITLE_LENGTH = 500;
const MAX_QUOTE_URL_LENGTH = 2000;
const MAX_QUOTE_NOTES_LENGTH = 1000;
const MAX_CLIP_START_SECONDS = 86_400;
const MIN_SQL_SMALLINT = -32_768;
const MAX_SQL_SMALLINT = 32_767;

type QuoteReadContext = Pick<QueryCtx, "db">;
type QuoteWriteContext = Pick<MutationCtx, "db">;

export type QuoteSourceType = "MOVIE" | "TV" | "OTHER";
export type QuoteStatus = "SUBMITTED" | "INCLUDED" | "REJECTED";

function validateRequiredText(
  rawValue: string,
  label: string,
  maxLength: number,
): string {
  const value = rawValue.trim().normalize("NFKC");
  if (value.length < 1 || value.length > maxLength) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(maxLength)} characters.`,
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

export function validateQuoteText(value: string): string {
  return validateRequiredText(
    value,
    "Quote text",
    MAX_QUOTE_TEXT_LENGTH,
  );
}

export function validateQuoteSourceTitle(value: string): string {
  return validateRequiredText(
    value,
    "Quote source title",
    MAX_SOURCE_TITLE_LENGTH,
  );
}

export function validateQuoteSourceType(
  value: string,
): QuoteSourceType {
  if (value !== "MOVIE" && value !== "TV" && value !== "OTHER") {
    domainError(
      "VALIDATION_FAILED",
      "Quote source type must be MOVIE, TV, or OTHER.",
    );
  }
  return value;
}

export function validateQuoteStatus(value: string): QuoteStatus {
  if (
    value !== "SUBMITTED" &&
    value !== "INCLUDED" &&
    value !== "REJECTED"
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Quote status must be SUBMITTED, INCLUDED, or REJECTED.",
    );
  }
  return value;
}

export function validateQuoteClipUrl(
  value: string | null,
): string | undefined {
  const clipUrl = validateOptionalText(
    value,
    "Quote clip URL",
    MAX_QUOTE_URL_LENGTH,
  );
  if (clipUrl === undefined) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(clipUrl);
  } catch {
    domainError(
      "VALIDATION_FAILED",
      "Quote clip URL must be a valid HTTP or HTTPS URL.",
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    domainError(
      "VALIDATION_FAILED",
      "Quote clip URL must be a valid HTTP or HTTPS URL.",
    );
  }
  return clipUrl;
}

export function validateQuoteClipStart(
  value: number | null,
): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_CLIP_START_SECONDS
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Quote clip start must be an integer from 0 through ${String(MAX_CLIP_START_SECONDS)}.`,
    );
  }
  return value;
}

export function validateQuoteListenerNotes(
  value: string | null,
): string | undefined {
  return validateOptionalText(
    value,
    "Quote listener notes",
    MAX_QUOTE_NOTES_LENGTH,
  );
}

export function validateQuoteAdminNotes(
  value: string | null,
): string | undefined {
  return validateOptionalText(
    value,
    "Quote administrator notes",
    MAX_QUOTE_NOTES_LENGTH,
  );
}

export function validateQuoteTimestamp(
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

export function validateBracketOrder(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_SQL_SMALLINT ||
    value > MAX_SQL_SMALLINT
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Quote bracket order must be an integer in the SQL SMALLINT range.",
    );
  }
  return value;
}

export function validatePlacement(value: number): 1 | 2 | 3 {
  if (value !== 1 && value !== 2 && value !== 3) {
    domainError(
      "VALIDATION_FAILED",
      "Quote placement must be 1, 2, or 3.",
    );
  }
  return value;
}

export async function resolveQuoteSeasonForEpisode(
  ctx: QuoteReadContext,
  episodeId: Id<"episodes">,
  today: string,
): Promise<Doc<"seasons">> {
  const existing = await ctx.db
    .query("quoteSubmissions")
    .withIndex("by_episodeId_and_createdAt", (index) =>
      index.eq("episodeId", episodeId),
    )
    .first();
  if (existing !== null) {
    const season = await ctx.db.get("seasons", existing.seasonId);
    if (season === null) {
      domainError(
        "CONFLICT",
        "Existing quote submission has a missing season.",
        { details: { quoteSubmissionId: existing._id } },
      );
    }
    return season;
  }
  return await resolvePointSeason(ctx, {
    kind: "current",
    today,
  });
}

export async function assertQuotePointOwnedOnly(
  ctx: QuoteReadContext,
  submission: Doc<"quoteSubmissions">,
): Promise<Doc<"points">> {
  if (submission.pointId === undefined) {
    domainError(
      "CONFLICT",
      "The quote submission has no award point.",
    );
  }
  const point = await requirePoint(ctx, submission.pointId);
  const relationships = await assertPointRelationshipCapacity(
    ctx,
    point._id,
  );
  const ownedSubmission =
    relationships.quoteSubmissions.length === 1 &&
    relationships.quoteSubmissions[0]?._id === submission._id;
  if (
    !ownedSubmission ||
    relationships.assignmentLinks.length > 0 ||
    relationships.guesses.length > 0 ||
    relationships.gamblingEntries.length > 0 ||
    relationships.tagVotes.length > 0
  ) {
    domainError(
      "CONFLICT",
      "The quote award point is shared by another relationship.",
    );
  }
  if (
    point.userId !== submission.userId ||
    point.seasonId !== submission.seasonId
  ) {
    domainError(
      "CONFLICT",
      "The quote award point belongs to a different user or season.",
    );
  }
  return point;
}

export async function deleteOwnedQuotePoint(
  ctx: QuoteWriteContext,
  submission: Doc<"quoteSubmissions">,
): Promise<void> {
  if (submission.pointId === undefined) {
    return;
  }
  const point = await assertQuotePointOwnedOnly(ctx, submission);
  await deletePointAndClearRelationships(ctx, point);
}

export function quotePlacementAdjustment(
  placement: 1 | 2 | 3,
): number {
  return placement === 1 ? 40 : placement === 2 ? 20 : 10;
}

export function quotePlacementReason(
  episodeNumber: number,
  placement: 1 | 2 | 3,
): string {
  const placementName =
    placement === 1
      ? "First"
      : placement === 2
        ? "Second"
        : "Third";
  return `Quotabunga - Episode ${String(episodeNumber)} - ${placementName} place`;
}
