import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_SYLLABUS_ENTRIES_PER_USER,
  MAX_SYLLABUS_NOTES_LENGTH,
} from "./limits.js";
import {
  listCanonicalSyllabusEntries,
  partitionSyllabusEntries,
} from "./readModel.js";

type SyllabusWriteContext = Pick<MutationCtx, "db">;

export type SyllabusPosition = "TOP" | "AFTER_NEXT" | "END";

export function validateSyllabusNotes(
  value: string | null,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  const notes = value.trim().normalize("NFKC");
  if (notes.length > MAX_SYLLABUS_NOTES_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Syllabus notes cannot exceed ${String(MAX_SYLLABUS_NOTES_LENGTH)} characters.`,
    );
  }
  return notes.length === 0 ? undefined : notes;
}

export async function requireSyllabusEntry(
  ctx: SyllabusWriteContext,
  id: Id<"syllabusEntries">,
): Promise<Doc<"syllabusEntries">> {
  const entry = await ctx.db.get("syllabusEntries", id);
  if (entry === null) {
    domainError("NOT_FOUND", "The syllabus entry is unavailable.");
  }
  return entry;
}

export function requireOwnedSyllabusEntry(
  entry: Doc<"syllabusEntries">,
  userId: Id<"users">,
): void {
  if (entry.userId !== userId) {
    domainError(
      "FORBIDDEN",
      "You do not have access to this syllabus entry.",
    );
  }
}

export async function applyDenseSyllabusOrder(
  ctx: SyllabusWriteContext,
  entries: ReadonlyArray<Doc<"syllabusEntries">>,
): Promise<Array<Doc<"syllabusEntries">>> {
  const length = entries.length;
  return await Promise.all(
    entries.map(async (entry, index) => {
      const order = length - index;
      if (entry.order !== order) {
        await ctx.db.patch("syllabusEntries", entry._id, { order });
      }
      return { ...entry, order };
    }),
  );
}

export async function normalizeUserSyllabus(
  ctx: SyllabusWriteContext,
  userId: Id<"users">,
): Promise<Array<Doc<"syllabusEntries">>> {
  return await applyDenseSyllabusOrder(
    ctx,
    await listCanonicalSyllabusEntries(ctx, userId),
  );
}

export async function insertSyllabusEntry(
  ctx: SyllabusWriteContext,
  input: {
    userId: Id<"users">;
    movieId: Id<"movies">;
    position: SyllabusPosition;
  },
): Promise<Doc<"syllabusEntries">> {
  const [user, movie, current] = await Promise.all([
    ctx.db.get("users", input.userId),
    ctx.db.get("movies", input.movieId),
    listCanonicalSyllabusEntries(ctx, input.userId),
  ]);
  if (user === null) {
    domainError("NOT_FOUND", "The syllabus user is unavailable.");
  }
  if (movie === null) {
    domainError("NOT_FOUND", "The syllabus movie is unavailable.");
  }
  if (current.length >= MAX_SYLLABUS_ENTRIES_PER_USER) {
    domainError(
      "CONFLICT",
      "The syllabus has reached its per-user limit.",
      { details: { limit: MAX_SYLLABUS_ENTRIES_PER_USER } },
    );
  }
  const now = Date.now();
  const entryId = await ctx.db.insert("syllabusEntries", {
    userId: user._id,
    movieId: movie._id,
    order: 0,
    createdAt: now,
  });
  const created = await requireSyllabusEntry(ctx, entryId);
  const { pending, assigned } = partitionSyllabusEntries(current);
  const insertionIndex =
    input.position === "TOP"
      ? 0
      : input.position === "AFTER_NEXT"
        ? Math.min(1, pending.length)
        : pending.length;
  pending.splice(insertionIndex, 0, created);
  const normalized = await applyDenseSyllabusOrder(ctx, [
    ...pending,
    ...assigned,
  ]);
  const result = normalized.find((entry) => entry._id === entryId);
  if (result === undefined) {
    throw new Error("Created syllabus entry was not normalized.");
  }
  return result;
}
