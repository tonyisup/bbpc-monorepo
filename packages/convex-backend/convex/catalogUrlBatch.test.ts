/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BBPC_API_VERSION } from "../contracts/index.js";
import { internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.stubEnv("BBPC_ENVIRONMENT", "staging");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://merry-shepherd-928.convex.cloud");
});
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const updates = await t.run(async (ctx) => {
    await ctx.db.insert("systemState", {
      singletonKey: "global",
      cutoverStage: "S4",
      applicationWriteMode: "enabled",
      cutoverRunId: "url-batch-test",
      apiVersion: BBPC_API_VERSION,
      initializedAt: 1,
      updatedAt: 1,
      updatedBy: "test",
      firstApplicationWriteAt: 1,
    });
    const updates = [];
    for (const number of [1, 2]) {
      const url = `https://www.themoviedb.org/movie/${String(number)}`;
      const id = await ctx.db.insert("movies", {
        title: `Movie ${String(number)}`,
        normalizedTitle: `movie ${String(number)}`,
        year: 2000,
        tmdbId: number,
        url,
        poster: "https://example.test/poster.jpg",
      });
      updates.push({
        id,
        expectedUrl: url,
        expectedTmdbId: number,
        expectedTitle: `Movie ${String(number)}`,
        expectedYear: 2000,
        newUrl: `https://www.imdb.com/title/tt000000${String(number)}/`,
      });
    }
    return updates;
  });
  const args = {
    cutoverRunId: "url-batch-test",
    clientApiVersion: BBPC_API_VERSION,
    batchId: "test-batch",
    updates,
  };
  const first = updates.at(0);
  const second = updates.at(1);
  if (!first || !second) throw new Error("Missing test movies");
  return { t, args, first, second };
}

test("patches only URLs, audits each change, and safely replays the batch", async () => {
  const { t, args } = await setup();
  const before = await t.run(async (ctx) =>
    Promise.all(args.updates.map((u) => ctx.db.get("movies", u.id)))
  );
  expect(
    await t.mutation(internal.catalog.operations.applyStagingImdbUrls, args)
  ).toEqual({ updated: 2, alreadyApplied: 0 });
  const after = await t.run(async (ctx) =>
    Promise.all(args.updates.map((u) => ctx.db.get("movies", u.id)))
  );
  expect(after).toEqual(
    before.map((movie, i) => ({ ...movie, url: args.updates[i]?.newUrl }))
  );
  expect(
    await t.mutation(internal.catalog.operations.applyStagingImdbUrls, args)
  ).toEqual({ updated: 0, alreadyApplied: 2 });
  const audits = await t.run(async (ctx) =>
    ctx.db.query("auditEvents").withIndex("by_createdAt").take(10)
  );
  expect(audits).toHaveLength(2);
  expect(
    audits.every((audit) => audit.metadata?.batchId === "test-batch")
  ).toBe(true);
});

test("a stale row rolls back every URL and audit in the batch", async () => {
  const { t, args, first, second } = await setup();
  await t.run(async (ctx) =>
    ctx.db.patch("movies", second.id, { title: "Changed since review" })
  );
  await expect(
    t.mutation(internal.catalog.operations.applyStagingImdbUrls, args)
  ).rejects.toThrow(/reviewed movie changed/);
  expect(
    await t.run(async (ctx) => (await ctx.db.get("movies", first.id))?.url)
  ).toBe(first.expectedUrl);
  expect(
    await t.run(async (ctx) =>
      ctx.db.query("auditEvents").withIndex("by_createdAt").take(10)
    )
  ).toHaveLength(0);
});

test("rejects a newly introduced duplicate destination", async () => {
  const { t, args, first } = await setup();
  await t.run(async (ctx) =>
    ctx.db.insert("movies", {
      title: "Duplicate",
      normalizedTitle: "duplicate",
      year: 2000,
      url: first.newUrl,
    })
  );
  await expect(
    t.mutation(internal.catalog.operations.applyStagingImdbUrls, args)
  ).rejects.toThrow(/Multiple catalog movies/);
});

test("requires the staging target, current version, cutover run, and enabled writes", async () => {
  const { t, args } = await setup();
  vi.stubEnv("CONVEX_CLOUD_URL", "https://determined-wombat-872.convex.cloud");
  await expect(
    t.mutation(internal.catalog.operations.applyStagingImdbUrls, args)
  ).rejects.toThrow(/staging-only/);
  vi.stubEnv("CONVEX_CLOUD_URL", "https://merry-shepherd-928.convex.cloud");
  vi.stubEnv("BBPC_ENVIRONMENT", "production");
  await expect(
    t.mutation(internal.catalog.operations.applyStagingImdbUrls, args)
  ).rejects.toThrow(/staging-only/);
  vi.stubEnv("BBPC_ENVIRONMENT", "staging");
  await expect(
    t.mutation(internal.catalog.operations.applyStagingImdbUrls, {
      ...args,
      clientApiVersion: "wrong",
    })
  ).rejects.toThrow();
  await expect(
    t.mutation(internal.catalog.operations.applyStagingImdbUrls, {
      ...args,
      cutoverRunId: "wrong",
    })
  ).rejects.toThrow();
  await t.run(async (ctx) => {
    const state = await ctx.db
      .query("systemState")
      .withIndex("by_singletonKey", (q) => q.eq("singletonKey", "global"))
      .unique();
    if (!state) throw new Error("Missing system state");
    await ctx.db.patch("systemState", state._id, {
      applicationWriteMode: "disabled",
    });
  });
  await expect(
    t.mutation(internal.catalog.operations.applyStagingImdbUrls, args)
  ).rejects.toThrow();
});

test("rejects repeated IDs, an oversized batch, and invalid provider URLs", async () => {
  const { t, args, first } = await setup();
  for (const updates of [
    [],
    [first, first],
    Array.from({ length: 26 }, () => first),
    [{ ...first, newUrl: "https://imdb.com.evil.test/title/tt0000001/" }],
    [{ ...first, expectedTmdbId: 123 }],
  ]) {
    await expect(
      t.mutation(internal.catalog.operations.applyStagingImdbUrls, {
        ...args,
        updates,
      })
    ).rejects.toThrow();
  }
});
