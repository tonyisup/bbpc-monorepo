import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { normalizeLookupKey } from "../lib/normalize.js";
import { MAX_ASSIGNMENT_SLUG_ATTEMPTS } from "./limits.js";

const MAX_SLUG_LENGTH = 255;
const SLUG_SUFFIX_RESERVE = 16;
const ASSIGNMENT_TYPES = new Set([
  "HOMEWORK",
  "EXTRA_CREDIT",
  "BONUS",
]);

type AssignmentWriteContext = Pick<MutationCtx, "db">;

export type AssignmentType =
  | "HOMEWORK"
  | "EXTRA_CREDIT"
  | "BONUS";

export function validateAssignmentType(value: string): AssignmentType {
  const type = value.trim().normalize("NFKC").toUpperCase();
  if (!ASSIGNMENT_TYPES.has(type)) {
    domainError(
      "VALIDATION_FAILED",
      "Assignment type must be HOMEWORK, EXTRA_CREDIT, or BONUS.",
    );
  }
  return type as AssignmentType;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_SLUG_LENGTH - SLUG_SUFFIX_RESERVE)
    .replace(/-+$/gu, "");
}

function assignmentSlugBase(input: {
  episodeNumber: number;
  movieTitle: string;
  userId: Id<"users">;
  userName?: string;
  assignmentType: AssignmentType;
}): string {
  const trimmedUserName = input.userName?.trim();
  const idLabel = input.userId.slice(0, 8);
  const userLabel =
    trimmedUserName !== undefined && trimmedUserName.length > 0
      ? trimmedUserName
      : idLabel.length > 0
        ? idLabel
        : "user";
  return (
    slugify(
      `episode-${String(input.episodeNumber)}-${userLabel}-${input.assignmentType}-${input.movieTitle || "assignment"}`,
    ) || "assignment"
  );
}

async function findSlugConflict(
  ctx: AssignmentWriteContext,
  normalizedSlug: string,
  excludeId?: Id<"assignments">,
): Promise<Doc<"assignments"> | null> {
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_normalizedSlug", (index) =>
      index.eq("normalizedSlug", normalizedSlug),
    )
    .take(2);
  return (
    assignments.find((assignment) => assignment._id !== excludeId) ??
    null
  );
}

export async function validateRequestedAssignmentSlug(
  ctx: AssignmentWriteContext,
  requestedSlug: string,
  excludeId?: Id<"assignments">,
): Promise<{ slug: string; normalizedSlug: string }> {
  const slug = slugify(requestedSlug);
  if (slug.length === 0) {
    domainError(
      "VALIDATION_FAILED",
      "Assignment slug must contain at least one letter or number.",
    );
  }
  const normalizedSlug = normalizeLookupKey(slug, "Assignment slug");
  if (
    (await findSlugConflict(ctx, normalizedSlug, excludeId)) !== null
  ) {
    domainError("CONFLICT", "The assignment slug is already in use.");
  }
  return { slug, normalizedSlug };
}

export async function allocateAssignmentSlug(
  ctx: AssignmentWriteContext,
  input: {
    episode: Doc<"episodes">;
    movie: Doc<"movies">;
    user: Doc<"users">;
    assignmentType: AssignmentType;
    excludeId?: Id<"assignments">;
  },
): Promise<{ slug: string; normalizedSlug: string }> {
  const base = assignmentSlugBase({
    episodeNumber: input.episode.number,
    movieTitle: input.movie.title,
    userId: input.user._id,
    ...(input.user.name === undefined
      ? {}
      : { userName: input.user.name }),
    assignmentType: input.assignmentType,
  });
  for (
    let attempt = 1;
    attempt <= MAX_ASSIGNMENT_SLUG_ATTEMPTS;
    attempt += 1
  ) {
    const suffix = attempt === 1 ? "" : `-${String(attempt)}`;
    const slug = `${base.slice(0, MAX_SLUG_LENGTH - suffix.length)}${suffix}`;
    const normalizedSlug = normalizeLookupKey(
      slug,
      "Assignment slug",
    );
    if (
      (await findSlugConflict(
        ctx,
        normalizedSlug,
        input.excludeId,
      )) === null
    ) {
      return { slug, normalizedSlug };
    }
  }
  domainError(
    "CONFLICT",
    "Unable to allocate a unique assignment slug.",
  );
}

export async function requireAssignment(
  ctx: AssignmentWriteContext,
  id: Id<"assignments">,
): Promise<Doc<"assignments">> {
  const assignment = await ctx.db.get("assignments", id);
  if (assignment === null) {
    domainError("NOT_FOUND", "The assignment is unavailable.");
  }
  return assignment;
}

export async function requireAssignmentParents(
  ctx: AssignmentWriteContext,
  input: {
    userId: Id<"users">;
    movieId: Id<"movies">;
    episodeId: Id<"episodes">;
  },
): Promise<{
  user: Doc<"users">;
  movie: Doc<"movies">;
  episode: Doc<"episodes">;
}> {
  const [user, movie, episode] = await Promise.all([
    ctx.db.get("users", input.userId),
    ctx.db.get("movies", input.movieId),
    ctx.db.get("episodes", input.episodeId),
  ]);
  if (user === null) {
    domainError("NOT_FOUND", "The assignment user is unavailable.");
  }
  if (movie === null) {
    domainError("NOT_FOUND", "The assignment movie is unavailable.");
  }
  if (episode === null) {
    domainError("NOT_FOUND", "The assignment episode is unavailable.");
  }
  return { user, movie, episode };
}

export async function assertAssignmentUnreferenced(
  ctx: AssignmentWriteContext,
  assignmentId: Id<"assignments">,
): Promise<void> {
  const references = await Promise.all([
    ctx.db
      .query("assignmentAudioMessages")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignmentId),
      )
      .first(),
    ctx.db
      .query("assignmentPointLinks")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignmentId),
      )
      .first(),
    ctx.db
      .query("syllabusEntries")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignmentId),
      )
      .first(),
    ctx.db
      .query("assignmentReviews")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignmentId),
      )
      .first(),
    ctx.db
      .query("gamblingEntries")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignmentId),
      )
      .first(),
    ctx.db
      .query("guessSettlements")
      .withIndex("by_assignmentId", (index) =>
        index.eq("assignmentId", assignmentId),
      )
      .first(),
  ]);
  const relationship = [
    "audio message",
    "point link",
    "syllabus entry",
    "assignment review",
    "gambling entry",
    "guess settlement",
  ].find((_, index) => references[index] !== null);
  if (relationship !== undefined) {
    domainError(
      "CONFLICT",
      "The assignment cannot be deleted while it is referenced.",
      { details: { relationship } },
    );
  }
}
