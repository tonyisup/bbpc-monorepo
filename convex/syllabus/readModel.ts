import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { toCatalogMovie } from "../catalog/readModel.js";
import { domainError } from "../lib/errors.js";
import { MAX_SYLLABUS_ENTRIES_PER_USER } from "./limits.js";
import type {
  syllabusAdminEntryValidator,
  syllabusEntryValidator,
} from "./validators.js";

type SyllabusReadContext = Pick<QueryCtx, "db">;
type SyllabusEntry = Infer<typeof syllabusEntryValidator>;
type SyllabusAdminEntry = Infer<
  typeof syllabusAdminEntryValidator
>;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function canonicalCompare(
  left: Doc<"syllabusEntries">,
  right: Doc<"syllabusEntries">,
): number {
  const leftPending = left.assignmentId === undefined;
  const rightPending = right.assignmentId === undefined;
  if (leftPending !== rightPending) {
    return leftPending ? -1 : 1;
  }
  if (left.order !== right.order) {
    return right.order - left.order;
  }
  return left._id.localeCompare(right._id);
}

export async function listCanonicalSyllabusEntries(
  ctx: SyllabusReadContext,
  userId: Id<"users">,
): Promise<Array<Doc<"syllabusEntries">>> {
  const entries = await ctx.db
    .query("syllabusEntries")
    .withIndex("by_userId_and_order", (index) =>
      index.eq("userId", userId),
    )
    .order("desc")
    .take(MAX_SYLLABUS_ENTRIES_PER_USER + 1);
  if (entries.length > MAX_SYLLABUS_ENTRIES_PER_USER) {
    domainError(
      "CONFLICT",
      "The syllabus exceeds the supported per-user limit.",
      { details: { limit: MAX_SYLLABUS_ENTRIES_PER_USER } },
    );
  }
  return entries.sort(canonicalCompare);
}

export function partitionSyllabusEntries(
  entries: ReadonlyArray<Doc<"syllabusEntries">>,
): {
  pending: Array<Doc<"syllabusEntries">>;
  assigned: Array<Doc<"syllabusEntries">>;
} {
  const pending: Array<Doc<"syllabusEntries">> = [];
  const assigned: Array<Doc<"syllabusEntries">> = [];
  for (const entry of entries) {
    if (entry.assignmentId === undefined) {
      pending.push(entry);
    } else {
      assigned.push(entry);
    }
  }
  return { pending, assigned };
}

export async function hydrateSyllabusEntry(
  ctx: SyllabusReadContext,
  entry: Doc<"syllabusEntries">,
): Promise<SyllabusEntry> {
  const movie = await ctx.db.get("movies", entry.movieId);
  if (movie === null) {
    domainError(
      "CONFLICT",
      "Syllabus read model found a missing movie relationship.",
      { details: { syllabusEntryId: entry._id } },
    );
  }
  let assignment: SyllabusEntry["assignment"] = null;
  if (entry.assignmentId !== undefined) {
    const assignmentDocument = await ctx.db.get(
      "assignments",
      entry.assignmentId,
    );
    if (assignmentDocument === null) {
      domainError(
        "CONFLICT",
        "Syllabus read model found a missing assignment relationship.",
        { details: { syllabusEntryId: entry._id } },
      );
    }
    const episode = await ctx.db.get(
      "episodes",
      assignmentDocument.episodeId,
    );
    if (episode === null) {
      domainError(
        "CONFLICT",
        "Syllabus read model found a missing episode relationship.",
        { details: { syllabusEntryId: entry._id } },
      );
    }
    assignment = {
      id: assignmentDocument._id,
      type: assignmentDocument.type,
      playable: assignmentDocument.playable,
      slug: nullable(assignmentDocument.slug),
      episode: {
        id: episode._id,
        number: episode.number,
        title: episode.title,
        status: nullable(episode.status),
        slug: nullable(episode.slug),
      },
    };
  }
  return {
    id: entry._id,
    order: entry.order,
    createdAt: entry.createdAt,
    notes: nullable(entry.notes),
    movie: toCatalogMovie(movie),
    assignment,
  };
}

export async function hydrateAdminSyllabusEntry(
  ctx: SyllabusReadContext,
  entry: Doc<"syllabusEntries">,
): Promise<SyllabusAdminEntry> {
  const [hydrated, user] = await Promise.all([
    hydrateSyllabusEntry(ctx, entry),
    ctx.db.get("users", entry.userId),
  ]);
  if (user === null) {
    domainError(
      "CONFLICT",
      "Syllabus read model found a missing user relationship.",
      { details: { syllabusEntryId: entry._id } },
    );
  }
  return {
    ...hydrated,
    user: {
      id: user._id,
      name: nullable(user.name),
      email: nullable(user.email),
      status: user.status,
    },
  };
}
