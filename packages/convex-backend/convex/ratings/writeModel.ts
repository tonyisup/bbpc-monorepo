import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { MAX_RATING_TEXT_LENGTH } from "./limits.js";

type RatingWriteContext = Pick<MutationCtx, "db">;

export function validateRatingName(value: string): string {
  const name = value.trim().normalize("NFKC");
  if (name.length < 1 || name.length > MAX_RATING_TEXT_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Rating name must contain 1 through ${String(MAX_RATING_TEXT_LENGTH)} characters.`,
    );
  }
  return name;
}

export function validateRatingValue(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    domainError(
      "VALIDATION_FAILED",
      "Rating value must be an integer from 0 through 255.",
    );
  }
  return value;
}

export function validateOptionalRatingText(
  value: string | null,
  label: string,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  const text = value.trim().normalize("NFKC");
  if (text.length > MAX_RATING_TEXT_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `${label} cannot exceed ${String(MAX_RATING_TEXT_LENGTH)} characters.`,
    );
  }
  return text.length === 0 ? undefined : text;
}

export async function requireRating(
  ctx: RatingWriteContext,
  id: Id<"ratings">,
): Promise<Doc<"ratings">> {
  const rating = await ctx.db.get("ratings", id);
  if (rating === null) {
    domainError("NOT_FOUND", "The rating is unavailable.");
  }
  return rating;
}

export async function assertRatingUnreferenced(
  ctx: RatingWriteContext,
  ratingId: Id<"ratings">,
): Promise<void> {
  const [review, guess] = await Promise.all([
    ctx.db
      .query("reviews")
      .withIndex("by_ratingId", (index) =>
        index.eq("ratingId", ratingId),
      )
      .first(),
    ctx.db
      .query("guesses")
      .withIndex("by_ratingId", (index) =>
        index.eq("ratingId", ratingId),
      )
      .first(),
  ]);
  const relationship =
    review !== null
      ? "review"
      : guess !== null
        ? "guess"
        : undefined;
  if (relationship !== undefined) {
    domainError(
      "CONFLICT",
      "The rating cannot be deleted while it is referenced.",
      { details: { relationship } },
    );
  }
}
