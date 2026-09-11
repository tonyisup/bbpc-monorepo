/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import { catalogSnapshotFingerprint } from "./lib/catalogSnapshot.js";
import { backfillDashboardDocument } from "./lib/dashboardProjection.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const tables = [
  "movies",
  "assignments",
  "reviews",
  "syllabusEntries",
  "rankedItems",
] as const;
const gate = {
  cutoverRunId: "dedup-test",
  clientApiVersion: BBPC_API_VERSION,
  batchId: "dedup-test",
};
const merge = internal.catalog.operations.mergeStagingMovies;
const repair = internal.catalog.operations.repairStagingMovieIdentity;
beforeEach(() => {
  vi.stubEnv("BBPC_ENVIRONMENT", "staging");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://merry-shepherd-928.convex.cloud");
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    await ctx.db.insert("systemState", {
      singletonKey: "global",
      cutoverStage: "S4",
      applicationWriteMode: "enabled",
      cutoverRunId: gate.cutoverRunId,
      apiVersion: BBPC_API_VERSION,
      initializedAt: 1,
      updatedAt: 1,
      updatedBy: "test",
      firstApplicationWriteAt: 1,
    });
    const value = {
      title: "Test Movie",
      normalizedTitle: "test movie",
      year: 2000,
      tmdbId: 12,
      url: "https://www.imdb.com/title/tt0000012",
      poster: "https://example.test/poster",
    };
    const survivorId = await ctx.db.insert("movies", {
      ...value,
      legacyId: "keep",
    });
    const sourceId = await ctx.db.insert("movies", {
      ...value,
      legacyId: "remove",
    });
    const userId = await ctx.db.insert("users", {
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    const episodeId = await ctx.db.insert("episodes", {
      number: 1,
      title: "Test Episode",
    });
    const assignmentId = await ctx.db.insert("assignments", {
      userId,
      episodeId,
      movieId: sourceId,
      type: "test",
      playable: true,
      legacyId: "assignment",
    });
    const reviewId = await ctx.db.insert("reviews", {
      userId,
      movieId: sourceId,
      reviewedAt: 42,
    });
    await ctx.db.insert("assignmentReviews", { assignmentId, reviewId });
    await ctx.db.insert("assignmentAudioMessages", {
      assignmentId,
      userId,
      url: "https://example.test/audio",
      createdAt: 7,
    });
    await ctx.db.insert("syllabusEntries", {
      userId,
      movieId: sourceId,
      order: 3,
      createdAt: 4,
      notes: "Preserve this",
      assignmentId,
    });
    const rankedListTypeId = await ctx.db.insert("rankedListTypes", {
      name: "Favorites",
      targetType: "MOVIE",
      maxItems: 10,
      createdAt: 1,
      updatedAt: 1,
    });
    const rankedListId = await ctx.db.insert("rankedLists", {
      userId,
      rankedListTypeId,
      status: "DRAFT",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("rankedItems", {
      rankedListId,
      targetType: "movie",
      movieId: sourceId,
      rank: 2,
      comment: "Keep rank and comment",
      createdAt: 5,
      updatedAt: 6,
    });
    for (const source of ["movies", "reviews"] as const) {
      for (const doc of await ctx.db.query(source).collect())
        await backfillDashboardDocument(ctx, source, doc);
    }
    return { survivorId, sourceId, reviewId };
  });
  const snapshot = () =>
    t.run(async (ctx) => {
      const rows = [];
      for (const table of tables)
        rows.push(...(await ctx.db.query(table).collect()));
      return rows;
    });
  const args = {
    ...gate,
    tmdbId: 12,
    movieIds: [seeded.survivorId, seeded.sourceId],
    survivorId: seeded.survivorId,
    newUrl: "https://www.imdb.com/title/tt0000012/",
    expectedFingerprint: catalogSnapshotFingerprint(await snapshot()),
  };
  return { t, ...seeded, snapshot, args };
}

test("merges atomically, preserves all history IDs and fields, and updates dashboard counts", async () => {
  const { t, args, snapshot, sourceId, survivorId } = await setup();
  const before = await snapshot();
  const indirect = () =>
    t.run(async (ctx) => ({
      joins: await ctx.db.query("assignmentReviews").collect(),
      audio: await ctx.db.query("assignmentAudioMessages").collect(),
    }));
  const beforeIndirect = await indirect();
  expect(await t.mutation(merge, args)).toEqual({
    deleted: 1,
    movedReferences: 4,
  });
  expect(await snapshot()).toEqual(
    before
      .filter((row) => row._id !== sourceId)
      .map((row) =>
        row._id === survivorId
          ? { ...row, url: args.newUrl }
          : "movieId" in row && row.movieId === sourceId
          ? { ...row, movieId: survivorId }
          : row
      )
  );
  expect(await indirect()).toEqual(beforeIndirect);
  const counts = await t.run(async (ctx) =>
    ctx.db.query("dashboardCounts").collect()
  );
  expect(counts.find((row) => row.key === "movies")?.count).toBe(1);
  expect(counts.find((row) => row.key === "reviews")?.count).toBe(1);
  await expect(t.mutation(merge, args)).rejects.toThrow(/group changed/);
  const audits = await t.run(async (ctx) =>
    ctx.db.query("auditEvents").collect()
  );
  expect(audits).toHaveLength(1);
  expect(audits[0]?.metadata?.snapshotFingerprint).toBe(
    args.expectedFingerprint
  );
});

test.each(["movie", "reference", "newReference"])(
  "rejects a stale %s snapshot without changing data",
  async (kind) => {
    const { t, args, snapshot, sourceId, reviewId } = await setup();
    await t.run(async (ctx) => {
      if (kind === "movie")
        await ctx.db.patch("movies", sourceId, {
          poster: "https://example.test/new",
        });
      else if (kind === "reference")
        await ctx.db.patch("reviews", reviewId, { reviewedAt: 99 });
      else await ctx.db.insert("reviews", { movieId: sourceId });
    });
    const before = await snapshot();
    await expect(t.mutation(merge, args)).rejects.toThrow(/snapshot changed/);
    expect(await snapshot()).toEqual(before);
  }
);

test.each([
  "assignments",
  "reviews",
  "syllabusEntries",
  "rankedItems",
] as const)("rejects cross-movie collisions in %s", async (table) => {
  const { t, args, snapshot, survivorId } = await setup();
  await t.run(async (ctx) => {
    const row = await ctx.db.query(table).first();
    if (!row) throw Error("Missing reference");
    const { _id: _id, _creationTime: _creationTime, ...value } = row;
    expect(_id).toBeTruthy();
    expect(_creationTime).toBeGreaterThanOrEqual(0);
    await ctx.db.insert(table, { ...value, movieId: survivorId });
  });
  const before = await snapshot();
  await expect(
    t.mutation(merge, {
      ...args,
      expectedFingerprint: catalogSnapshotFingerprint(before),
    })
  ).rejects.toThrow(/collide/);
  expect(await snapshot()).toEqual(before);
});

test.each(["title", "imdb", "newMember", "outsideDestination"])(
  "rejects identity conflict: %s",
  async (kind) => {
    const { t, args, sourceId, snapshot } = await setup();
    await t.run(async (ctx) => {
      if (kind === "title")
        await ctx.db.patch("movies", sourceId, { title: "A sequel" });
      else if (kind === "imdb")
        await ctx.db.patch("movies", sourceId, {
          url: "https://www.imdb.com/title/tt9999999/",
        });
      else
        await ctx.db.insert("movies", {
          title: "Test Movie",
          normalizedTitle: "test movie",
          year: 2000,
          url: args.newUrl,
          ...(kind === "newMember" ? { tmdbId: args.tmdbId } : {}),
        });
    });
    const before = await snapshot();
    await expect(
      t.mutation(merge, {
        ...args,
        expectedFingerprint: catalogSnapshotFingerprint(before),
      })
    ).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  }
);

test("requires staging, a current API version, current cutover run, and enabled writes", async () => {
  const { t, args } = await setup();
  const movie = await t.run(async (ctx) =>
    ctx.db.get("movies", args.survivorId)
  );
  if (!movie) throw Error("Missing movie");
  const repairArgs = {
    ...gate,
    id: movie._id,
    expectedFingerprint: catalogSnapshotFingerprint([movie]),
    newTmdbId: 99,
    newUrl: args.newUrl,
  };
  for (const [name, value] of [
    ["CONVEX_CLOUD_URL", "https://determined-wombat-872.convex.cloud"],
    ["BBPC_ENVIRONMENT", "production"],
  ]) {
    if (!name || !value) throw Error("Missing environment test");
    const original = process.env[name];
    vi.stubEnv(name, value);
    await expect(t.mutation(merge, args)).rejects.toThrow(/staging-only/);
    await expect(t.mutation(repair, repairArgs)).rejects.toThrow(
      /staging-only/
    );
    vi.stubEnv(name, original);
  }
  await expect(
    t.mutation(merge, { ...args, clientApiVersion: "wrong" })
  ).rejects.toThrow();
  await expect(
    t.mutation(merge, { ...args, cutoverRunId: "wrong" })
  ).rejects.toThrow();
  await t.run(async (ctx) => {
    const state = await ctx.db.query("systemState").first();
    if (!state) throw Error("Missing state");
    await ctx.db.patch("systemState", state._id, {
      applicationWriteMode: "disabled",
    });
  });
  await expect(t.mutation(merge, args)).rejects.toThrow();
});

test("repairs a conflicting TMDB ID while retaining the IMDb identity and all references", async () => {
  const { t, args, snapshot, sourceId } = await setup();
  const before = await snapshot();
  const movie = before.find((row) => row._id === sourceId);
  if (!movie) throw Error("Missing movie");
  // Give this distinct film its own IMDb identity before fixing its shared TMDB ID.
  await t.run(async (ctx) =>
    ctx.db.patch("movies", sourceId, {
      url: "https://www.imdb.com/title/tt0000099",
    })
  );
  const reviewed = { ...movie, url: "https://www.imdb.com/title/tt0000099" };
  const repairArgs = {
    ...gate,
    id: sourceId,
    expectedFingerprint: catalogSnapshotFingerprint([reviewed]),
    newTmdbId: 99,
    newUrl: "https://www.imdb.com/title/tt0000099/",
  };
  await t.mutation(repair, repairArgs);
  expect(await snapshot()).toEqual(
    before.map((row) =>
      row._id === sourceId
        ? { ...row, url: repairArgs.newUrl, tmdbId: 99 }
        : row
    )
  );
  await expect(t.mutation(repair, repairArgs)).rejects.toThrow(
    /snapshot changed/
  );
  await expect(t.mutation(merge, args)).rejects.toThrow(/group changed/);
});

test("repairs placeholder URLs with a TMDB fallback and rolls back conflicting destinations", async () => {
  const { t, args, snapshot, sourceId } = await setup();
  await t.run(async (ctx) =>
    ctx.db.patch("movies", sourceId, {
      url: "https://www.imdb.com/title/None",
      tmdbId: 99,
    })
  );
  const movie = await t.run(async (ctx) => ctx.db.get("movies", sourceId));
  if (!movie) throw Error("Missing movie");
  const before = await snapshot();
  const repairArgs = {
    ...gate,
    id: sourceId,
    expectedFingerprint: catalogSnapshotFingerprint([movie]),
    newTmdbId: 99,
    newUrl: args.newUrl,
  };
  await expect(t.mutation(repair, repairArgs)).rejects.toThrow(
    /Multiple catalog movies/
  );
  expect(await snapshot()).toEqual(before);
  await t.mutation(repair, {
    ...repairArgs,
    newUrl: "https://www.themoviedb.org/movie/99",
  });
  expect(await snapshot()).toEqual(
    before.map((row) =>
      row._id === sourceId
        ? { ...row, url: "https://www.themoviedb.org/movie/99" }
        : row
    )
  );
});
