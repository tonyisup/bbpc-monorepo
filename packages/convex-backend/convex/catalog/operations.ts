import { v, type Infer } from "convex/values";
import type { ApplicationActor } from "../lib/actors.js";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { MutationCtx } from "../_generated/server.js";
import { internalAppMutation, internalReadAction } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import {
  catalogOperationFingerprint,
  catalogSnapshotFingerprint,
} from "../lib/catalogSnapshot.js";
import { domainError } from "../lib/errors.js";
import {
  canonicalImdbUrl,
  movieUrlAliases,
  tmdbIdFromMovieUrl,
} from "./movieUrls.js";
import {
  assertMovieUnreferenced,
  findMovieForUpsert,
  validateTmdbId,
} from "./writeModel.js";
import { searchTmdb } from "./tmdbClient.js";

export const tmdbMovieSearchSmoke = internalReadAction({
  args: {
    query: v.string(),
    page: v.optional(v.number()),
  },
  returns: v.object({
    page: v.number(),
    resultCount: v.number(),
    firstResultIdPresent: v.boolean(),
  }),
  handler: async (_ctx, args) => {
    const result = await searchTmdb("movie", args.query, args.page ?? 1);
    return {
      page: result.page,
      resultCount: result.results.length,
      firstResultIdPresent: result.results.length > 0,
    };
  },
});

type MaintenanceCtx = MutationCtx & {
  actor: ApplicationActor;
  systemState: Doc<"systemState">;
};

function requireStagingMaintenance(batchId: string) {
  if (
    process.env.BBPC_ENVIRONMENT !== "staging" ||
    process.env.CONVEX_CLOUD_URL !== "https://merry-shepherd-928.convex.cloud"
  ) {
    domainError("FORBIDDEN", "Catalog maintenance is staging-only.");
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(batchId)) {
    domainError("VALIDATION_FAILED", "Supply a reviewed batch ID.");
  }
}

async function movieReferences(
  ctx: MutationCtx,
  movieIds: Array<Id<"movies">>
) {
  const references = {
    assignments: [],
    reviews: [],
    syllabusEntries: [],
    rankedItems: [],
  } as {
    [Table in
      | "assignments"
      | "reviews"
      | "syllabusEntries"
      | "rankedItems"]: Array<Doc<Table>>;
  };
  for (const movieId of movieIds) {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_movieId", (q) => q.eq("movieId", movieId))
      .take(101);
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_movieId", (q) => q.eq("movieId", movieId))
      .take(101);
    const syllabusEntries = await ctx.db
      .query("syllabusEntries")
      .withIndex("by_movieId", (q) => q.eq("movieId", movieId))
      .take(101);
    const rankedItems = await ctx.db
      .query("rankedItems")
      .withIndex("by_movieId", (q) => q.eq("movieId", movieId))
      .take(101);
    if (
      [assignments, reviews, syllabusEntries, rankedItems].some(
        (rows) => rows.length > 100
      )
    ) {
      domainError("CONFLICT", "Movie references exceed the maintenance limit.");
    }
    references.assignments.push(...assignments);
    references.reviews.push(...reviews);
    references.syllabusEntries.push(...syllabusEntries);
    references.rankedItems.push(...rankedItems);
  }
  if (Object.values(references).flat().length > 100) {
    domainError("CONFLICT", "Group references exceed the maintenance limit.");
  }
  return references;
}

function rejectCrossMovieCollisions<T extends { movieId?: Id<"movies"> }>(
  rows: T[],
  key: (row: T) => string | undefined
) {
  const owners = new Map<string, Id<"movies"> | undefined>();
  for (const row of rows) {
    const value = key(row);
    if (value === undefined) continue;
    if (owners.has(value) && owners.get(value) !== row.movieId) {
      domainError(
        "CONFLICT",
        "Merging would collide with another movie's history or ranking."
      );
    }
    owners.set(value, row.movieId);
  }
}

function isPlaceholderMovieUrl(url: string) {
  return (
    url === "https://www.imdb.com/title/None" ||
    url === "https://www.imdb.com/title/"
  );
}

function isCanonicalMovieUrl(url: string, tmdbId: number) {
  return (
    canonicalImdbUrl(url) === url ||
    url === `https://www.themoviedb.org/movie/${String(tmdbId)}`
  );
}

/** One reviewed group per transaction. Stale snapshots, including replays, abort. */
const mergeArgs = v.object({
  batchId: v.string(),
  tmdbId: v.number(),
  movieIds: v.array(v.id("movies")),
  survivorId: v.id("movies"),
  newUrl: v.string(),
  expectedFingerprint: v.string(),
});

async function mergeReviewedMovies(
  ctx: MaintenanceCtx,
  args: Infer<typeof mergeArgs>
) {
  validateTmdbId(args.tmdbId);
  const ids = new Set(args.movieIds);
  if (
    ids.size < 2 ||
    ids.size > 25 ||
    ids.size !== args.movieIds.length ||
    !ids.has(args.survivorId) ||
    !isCanonicalMovieUrl(args.newUrl, args.tmdbId)
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Supply 2–25 distinct movies and a canonical provider URL."
    );
  }
  const movies = await ctx.db
    .query("movies")
    .withIndex("by_tmdbId", (q) => q.eq("tmdbId", args.tmdbId))
    .take(26);
  if (
    movies.length !== ids.size ||
    movies.some((movie) => !ids.has(movie._id))
  ) {
    domainError("CONFLICT", "The reviewed duplicate group changed.");
  }
  const survivor = movies.find((movie) => movie._id === args.survivorId);
  if (!survivor) domainError("CONFLICT", "The survivor is unavailable.");
  for (const movie of movies) {
    const imdb = canonicalImdbUrl(movie.url);
    const urlTmdbId = tmdbIdFromMovieUrl(movie.url);
    if (
      movie.title !== survivor.title ||
      movie.year !== survivor.year ||
      (imdb !== null && imdb !== args.newUrl) ||
      (urlTmdbId !== undefined && urlTmdbId !== args.tmdbId) ||
      (imdb === null &&
        urlTmdbId === undefined &&
        !isPlaceholderMovieUrl(movie.url))
    ) {
      domainError(
        "CONFLICT",
        "Movie identities disagree; do not merge this group."
      );
    }
  }
  for (const alias of movieUrlAliases(args.newUrl, args.tmdbId)) {
    const matches = await ctx.db
      .query("movies")
      .withIndex("by_url", (q) => q.eq("url", alias))
      .take(26);
    if (matches.some((movie) => !ids.has(movie._id))) {
      domainError(
        "CONFLICT",
        "A provider destination matches a movie outside the group."
      );
    }
  }
  const refs = await movieReferences(ctx, args.movieIds);
  if (
    catalogSnapshotFingerprint([...movies, ...Object.values(refs).flat()]) !==
    args.expectedFingerprint
  ) {
    domainError(
      "CONFLICT",
      "The reviewed movie or reference snapshot changed."
    );
  }
  rejectCrossMovieCollisions(
    refs.assignments,
    (row) => `${row.userId}:${row.episodeId}`
  );
  rejectCrossMovieCollisions(refs.reviews, (row) => row.userId);
  rejectCrossMovieCollisions(refs.syllabusEntries, (row) => row.userId);
  rejectCrossMovieCollisions(refs.rankedItems, (row) => row.rankedListId);
  let movedReferences = 0;
  for (const table of [
    "assignments",
    "reviews",
    "syllabusEntries",
    "rankedItems",
  ] as const) {
    for (const row of refs[table]) {
      if (row.movieId === args.survivorId) continue;
      await ctx.db.patch(table, row._id, { movieId: args.survivorId });
      movedReferences += 1;
    }
  }
  await ctx.db.patch("movies", survivor._id, { url: args.newUrl });
  for (const movie of movies) {
    if (movie._id === survivor._id) continue;
    await assertMovieUnreferenced(ctx, movie._id);
    await ctx.db.delete("movies", movie._id);
  }
  await writeAuditEvent(ctx, {
    actor: ctx.actor,
    action: "catalog.movie.duplicatesMerged",
    targetType: "movie",
    targetId: survivor._id,
    cutoverRunId: ctx.systemState.cutoverRunId,
    metadata: {
      batchId: args.batchId,
      snapshotFingerprint: args.expectedFingerprint,
      deleted: movies.length - 1,
      movedReferences,
    },
  });
  return { deleted: movies.length - 1, movedReferences };
}

export const mergeStagingMovies = internalAppMutation({
  args: mergeArgs.fields,
  returns: v.object({ deleted: v.number(), movedReferences: v.number() }),
  handler: async (ctx, args) => {
    requireStagingMaintenance(args.batchId);
    return mergeReviewedMovies(ctx, args);
  },
});

/** Repair verified provider IDs/URLs without changing any history or movie metadata. */
const repairArgs = v.object({
  batchId: v.string(),
  id: v.id("movies"),
  expectedFingerprint: v.string(),
  newTmdbId: v.number(),
  newUrl: v.string(),
});

async function repairReviewedMovieIdentity(
  ctx: MaintenanceCtx,
  args: Infer<typeof repairArgs>
) {
  validateTmdbId(args.newTmdbId);
  const movie = await ctx.db.get("movies", args.id);
  if (
    !movie ||
    catalogSnapshotFingerprint([movie]) !== args.expectedFingerprint
  ) {
    domainError("CONFLICT", "The reviewed movie snapshot changed.");
  }
  const imdb = canonicalImdbUrl(movie.url);
  if (
    !isCanonicalMovieUrl(args.newUrl, args.newTmdbId) ||
    (imdb !== null
      ? imdb !== args.newUrl
      : movie.tmdbId !== args.newTmdbId ||
        (!isPlaceholderMovieUrl(movie.url) &&
          tmdbIdFromMovieUrl(movie.url) !== args.newTmdbId))
  ) {
    domainError(
      "VALIDATION_FAILED",
      "A repair must preserve a known IMDb identity or the existing TMDB ID."
    );
  }
  await ctx.db.patch("movies", movie._id, {
    tmdbId: args.newTmdbId,
    url: args.newUrl,
  });
  if (
    (await findMovieForUpsert(ctx, args.newUrl, args.newTmdbId))?._id !==
    movie._id
  ) {
    domainError("CONFLICT", "The repaired identity is not unique.");
  }
  await writeAuditEvent(ctx, {
    actor: ctx.actor,
    action: "catalog.movie.identityRepaired",
    targetType: "movie",
    targetId: movie._id,
    cutoverRunId: ctx.systemState.cutoverRunId,
    metadata: {
      batchId: args.batchId,
      snapshotFingerprint: args.expectedFingerprint,
    },
  });
  return null;
}

export const repairStagingMovieIdentity = internalAppMutation({
  args: repairArgs.fields,
  returns: v.null(),
  handler: async (ctx, args) => {
    requireStagingMaintenance(args.batchId);
    return repairReviewedMovieIdentity(ctx, args);
  },
});

/** Apply a reviewed staging report atomically; retries are safe after a lost response. */
export const applyStagingImdbUrls = internalAppMutation({
  args: {
    batchId: v.string(),
    updates: v.array(
      v.object({
        id: v.id("movies"),
        expectedUrl: v.string(),
        expectedTmdbId: v.number(),
        expectedTitle: v.string(),
        expectedYear: v.number(),
        newUrl: v.string(),
      })
    ),
  },
  returns: v.object({ updated: v.number(), alreadyApplied: v.number() }),
  handler: async (ctx, args) => {
    if (
      process.env.BBPC_ENVIRONMENT !== "staging" ||
      process.env.CONVEX_CLOUD_URL !== "https://merry-shepherd-928.convex.cloud"
    ) {
      domainError("FORBIDDEN", "This URL batch operation is staging-only.");
    }
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(args.batchId) ||
      args.updates.length < 1 ||
      args.updates.length > 25 ||
      new Set(args.updates.map((update) => update.id)).size !==
        args.updates.length
    ) {
      domainError(
        "VALIDATION_FAILED",
        "Supply a batch ID and 1–25 distinct reviewed movies."
      );
    }
    let updated = 0;
    let alreadyApplied = 0;
    for (const update of args.updates) {
      if (
        canonicalImdbUrl(update.newUrl) !== update.newUrl ||
        tmdbIdFromMovieUrl(update.expectedUrl) !== update.expectedTmdbId
      ) {
        domainError(
          "VALIDATION_FAILED",
          "Expected a TMDB source and canonical IMDb destination."
        );
      }
      const movie = await ctx.db.get("movies", update.id);
      if (
        movie?.tmdbId !== update.expectedTmdbId ||
        movie.title !== update.expectedTitle ||
        movie.year !== update.expectedYear ||
        (movie.url !== update.expectedUrl && movie.url !== update.newUrl)
      ) {
        domainError(
          "CONFLICT",
          "A reviewed movie changed; regenerate the report before applying."
        );
      }
      const match = await findMovieForUpsert(
        ctx,
        update.newUrl,
        update.expectedTmdbId
      );
      if (match?._id !== movie._id) {
        domainError(
          "CONFLICT",
          "The reviewed movie no longer has a unique provider match."
        );
      }
      if (movie.url === update.newUrl) {
        alreadyApplied += 1;
        continue;
      }
      await ctx.db.patch("movies", movie._id, { url: update.newUrl });
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "catalog.movie.imdbUrlBackfilled",
        targetType: "movie",
        targetId: movie._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: { batchId: args.batchId },
      });
      updated += 1;
    }
    return { updated, alreadyApplied };
  },
});

const productionOperation = v.union(
  v.object({ kind: v.literal("merge"), ...mergeArgs.fields }),
  v.object({ kind: v.literal("repair"), ...repairArgs.fields }),
  v.object({
    kind: v.literal("delete"),
    batchId: v.string(),
    id: v.id("movies"),
    expectedFingerprint: v.string(),
  })
);

/** Disabled by default; the operator enables only a reviewed manifest's exact operations. */
export const applyProductionCatalogOperation = internalAppMutation({
  args: { manifestSha256: v.string(), operation: productionOperation },
  returns: v.object({
    deleted: v.number(),
    movedReferences: v.number(),
    repaired: v.number(),
  }),
  handler: async (ctx, args) => {
    if (
      process.env.BBPC_ENVIRONMENT !== "production" ||
      process.env.CONVEX_CLOUD_URL !==
        "https://determined-wombat-872.convex.cloud" ||
      ctx.systemState.cutoverStage !== "S4"
    ) {
      domainError(
        "FORBIDDEN",
        "Catalog cleanup requires the production target in S4."
      );
    }
    const approvedManifest = process.env.BBPC_CATALOG_APPROVED_MANIFEST_SHA256;
    if (
      !/^[a-f0-9]{64}$/.test(args.manifestSha256) ||
      approvedManifest !== args.manifestSha256
    ) {
      domainError("FORBIDDEN", "Production catalog manifest is not approved.");
    }
    let approvedOperations: unknown;
    try {
      approvedOperations = JSON.parse(
        process.env.BBPC_CATALOG_APPROVED_OPERATIONS ?? "null"
      );
    } catch {
      domainError(
        "FORBIDDEN",
        "Invalid production catalog operation approval."
      );
    }
    if (
      !Array.isArray(approvedOperations) ||
      approvedOperations.length < 1 ||
      approvedOperations.length > 100 ||
      !approvedOperations.every(
        (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
      ) ||
      !approvedOperations.includes(catalogOperationFingerprint(args.operation))
    ) {
      domainError("FORBIDDEN", "Production catalog operation is not approved.");
    }
    const operation = args.operation;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(operation.batchId)) {
      domainError("VALIDATION_FAILED", "Invalid production catalog batch ID.");
    }
    if (operation.kind === "merge") {
      return { ...(await mergeReviewedMovies(ctx, operation)), repaired: 0 };
    }
    if (operation.kind === "repair") {
      await repairReviewedMovieIdentity(ctx, operation);
      return { deleted: 0, movedReferences: 0, repaired: 1 };
    }
    const movie = await ctx.db.get("movies", operation.id);
    if (
      !movie ||
      catalogSnapshotFingerprint([movie]) !== operation.expectedFingerprint ||
      !isPlaceholderMovieUrl(movie.url)
    ) {
      domainError("CONFLICT", "The reviewed placeholder movie changed.");
    }
    await assertMovieUnreferenced(ctx, movie._id);
    await ctx.db.delete("movies", movie._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "catalog.movie.unreferencedPlaceholderDeleted",
      targetType: "movie",
      targetId: movie._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        batchId: operation.batchId,
        manifestSha256: args.manifestSha256,
        snapshotFingerprint: operation.expectedFingerprint,
      },
    });
    return { deleted: 1, movedReferences: 0, repaired: 0 };
  },
});
