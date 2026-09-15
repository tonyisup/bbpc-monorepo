/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";
import { dashboardTriggers } from "./lib/dashboardProjection.js";
import {
  buildPassages,
  validatePassages,
  MAX_TRANSCRIPT_PASSAGES,
  MAX_TRANSCRIPT_BYTES,
} from "./lib/transcriptModel.js";
const modules = import.meta.glob("./**/*.ts");
const identity = {
  tokenIdentifier: "https://issuer.example.test|transcripts",
  issuer: "https://issuer.example.test",
  subject: "transcripts",
};
const clientApiVersion = "0.1.0";
const samplePassage = {
  start: 12.5,
  end: 24,
  text: "The camera captures a luminous jellyfish.",
};
const sample = [samplePassage];

async function setup() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: "transcripts",
    apiVersion: clientApiVersion,
    actor: "test",
  });
  for (const [expectedStage, nextStage] of [
    ["S0", "S1"],
    ["S1", "S2"],
    ["S2", "S3"],
  ] as const) {
    await t.mutation(internal.system.cutover.transition, {
      cutoverRunId: "transcripts",
      expectedStage,
      nextStage,
      actor: "test",
      ...(nextStage === "S3"
        ? {
            approvedBackupId: "synthetic",
            approvedBackupChecksum: "sha256:synthetic",
          }
        : {}),
    });
  }
  const episodeId = await t.run(async (ctx) => {
    await ctx.db.insert("servicePrincipals", {
      ...identity,
      name: "Test pipeline",
      status: "active",
      permissions: ["pipeline:publish"],
      createdAt: 1,
      updatedAt: 1,
    });
    return await ctx.db.insert("episodes", {
      number: 1,
      title: "Underwater cinema",
      status: "published",
      slug: "underwater",
      date: "2026-01-01",
    });
  });
  const service = t.withIdentity(identity);
  const args = {
    clientApiVersion,
    episodeId,
    expectedHash: null,
    complete: true as const,
    passages: sample,
  };
  return { t, service, args, episodeId };
}

describe("transcript import and public search", () => {
  test("applies inclusive episode date bounds and excludes undated transcript matches", async () => {
    const { t, service, args, episodeId } = await setup();
    await service.mutation(api.episodes.transcripts.replace, args);
    for (const [range, count] of [
      [{ dateFrom: "2026-01-01", dateTo: "2026-01-01" }, 1],
      [{ dateFrom: "2026-01-02" }, 0],
      [{ dateTo: "2025-12-31" }, 0],
      [{ dateTo: "2026-01-01" }, 1],
    ] as const) {
      const result = await t.query(api.episodes.transcripts.search, {
        query: "jellyfish",
        ...range,
      });
      expect(result.results).toHaveLength(count);
    }
    await t.run(async (ctx) => {
      await ctx.db.patch("episodes", episodeId, { date: undefined });
    });
    expect(
      (
        await t.query(api.episodes.transcripts.search, {
          query: "jellyfish",
          dateTo: "2026-12-31",
        })
      ).results,
    ).toEqual([]);
    expect(
      (await t.query(api.episodes.transcripts.search, { query: "jellyfish" }))
        .results,
    ).toHaveLength(1);
    await expect(
      t.query(api.episodes.transcripts.search, {
        query: "jellyfish",
        dateFrom: "2026-02-30",
      }),
    ).rejects.toThrow("real calendar date");
    await expect(
      t.query(api.episodes.transcripts.search, {
        query: "jellyfish",
        dateFrom: "2026-02-01",
        dateTo: "2026-01-01",
      }),
    ).rejects.toThrow("start date");
  });

  test("finds transcript-only words, returns source timing, and replaces without stale hits", async () => {
    const { t, service, args } = await setup();
    const first = await service.mutation(
      api.episodes.transcripts.replace,
      args
    );
    expect(
      await t.query(api.episodes.transcripts.search, { query: "jellyfish" })
    ).toMatchObject({
      results: [{ episode: { title: "Underwater cinema" }, passages: sample }],
      limited: false,
    });
    expect(
      await service.mutation(api.episodes.transcripts.replace, args)
    ).toEqual({ ...first, changed: false });
    await service.mutation(api.episodes.transcripts.replace, {
      ...args,
      expectedHash: first.hash,
      passages: [{ ...samplePassage, text: "A sea turtle swims past." }],
    });
    expect(
      (await t.query(api.episodes.transcripts.search, { query: "jellyfish" }))
        .results
    ).toEqual([]);
    expect(
      (await t.query(api.episodes.transcripts.search, { query: "turtle" }))
        .results
    ).toHaveLength(1);
  });
  test("rejects conflicts and invalid replacement while preserving the active transcript", async () => {
    const { t, service, args } = await setup();
    await service.mutation(api.episodes.transcripts.replace, args);
    await expect(
      service.mutation(api.episodes.transcripts.replace, {
        ...args,
        passages: [{ ...samplePassage, text: "Another version" }],
      })
    ).rejects.toThrow("Transcript changed");
    await expect(
      service.mutation(api.episodes.transcripts.replace, {
        ...args,
        passages: [],
      })
    ).rejects.toThrow();
    expect(
      (await t.query(api.episodes.transcripts.search, { query: "jellyfish" }))
        .results
    ).toHaveLength(1);
  });
  test("unpublishing and deleting immediately suppress passage access; orphan cleanup is retryable", async () => {
    const { t, service, args, episodeId } = await setup();
    const result = await service.mutation(
      api.episodes.transcripts.replace,
      args
    );
    await t.run(async (ctx) => {
      await dashboardTriggers
        .wrapDB(ctx)
        .db.patch("episodes", episodeId, { status: "draft" });
    });
    expect(
      (await t.query(api.episodes.transcripts.search, { query: "jellyfish" }))
        .results
    ).toEqual([]);
    await t.run(async (ctx) => {
      await dashboardTriggers.wrapDB(ctx).db.delete("episodes", episodeId);
    });
    expect(
      (await t.query(api.episodes.transcripts.search, { query: "jellyfish" }))
        .results
    ).toEqual([]);
    await service.mutation(api.episodes.transcripts.remove, {
      clientApiVersion,
      episodeId,
      expectedHash: result.hash,
    });
    await service.mutation(api.episodes.transcripts.remove, {
      clientApiVersion,
      episodeId,
      expectedHash: result.hash,
    });
    expect(
      await t.run(
        async (ctx) => await ctx.db.query("transcriptPassages").collect()
      )
    ).toEqual([]);
  });
  test("enforces authentication, permission, client version, and completion", async () => {
    const { t, service, args } = await setup();
    await expect(
      t.mutation(api.episodes.transcripts.replace, args)
    ).rejects.toThrow();
    await expect(
      service.mutation(api.episodes.transcripts.replace, {
        ...args,
        clientApiVersion: "wrong",
      })
    ).rejects.toThrow();
    await expect(
      service.mutation(api.episodes.transcripts.replace, {
        ...args,
        complete: false as unknown as true,
      })
    ).rejects.toThrow();
    const imported = await service.mutation(api.episodes.transcripts.replace, args);
    expect(
      await service.query(api.episodes.transcripts.inspect, {
        episodeId: args.episodeId,
      })
    ).toEqual({ hash: imported.hash, number: 1, title: "Underwater cinema" });
    await t.run(async (ctx) => {
      const principal = await ctx.db.query("servicePrincipals").first();
      if (!principal) throw new Error("Missing service fixture");
      await ctx.db.patch("servicePrincipals", principal._id, {
        permissions: [],
      });
    });
    await expect(
      service.mutation(api.episodes.transcripts.replace, args)
    ).rejects.toThrow();
    await expect(
      service.query(api.episodes.transcripts.inspect, {
        episodeId: args.episodeId,
      })
    ).rejects.toThrow();
  });
  test("excluded episodes cannot consume the public search budget", async () => {
    const { t, service, args } = await setup();
    await service.mutation(api.episodes.transcripts.replace, {
      ...args,
      passages: Array.from({ length: 110 }, (_, i) => ({
        start: i,
        end: i + 1,
        text: "jellyfish",
      })),
    });
    const publishedId = await t.run(async (ctx) => {
      return await dashboardTriggers
        .wrapDB(ctx)
        .db.insert("episodes", {
          number: 2,
          title: "Public",
          status: "published",
        });
    });
    await service.mutation(api.episodes.transcripts.replace, {
      ...args,
      episodeId: publishedId,
      passages: sample,
    });
    await t.run(async (ctx) => {
      await dashboardTriggers
        .wrapDB(ctx)
        .db.patch("episodes", args.episodeId, { status: "draft" });
    });
    const found = await t.query(api.episodes.transcripts.search, {
      query: "jellyfish",
    });
    expect(found.results.map((result) => result.episode.id)).toEqual([
      publishedId,
    ]);
    expect(found.limited).toBe(false);
    await t.run(async (ctx) => {
      await dashboardTriggers
        .wrapDB(ctx)
        .db.patch("episodes", args.episodeId, { status: "published" });
    });
    expect(
      (await t.query(api.episodes.transcripts.search, { query: "jellyfish" }))
        .limited
    ).toBe(true);
  });
  test("caps matches honestly, deduplicates overlap, and rejects excessive queries", async () => {
    const { t, service, args } = await setup();
    await service.mutation(api.episodes.transcripts.replace, {
      ...args,
      passages: Array.from({ length: 101 }, (_, index) => ({
        start: index * 10,
        end: index * 10 + 12,
        text: "jellyfish",
      })),
    });
    const found = await t.query(api.episodes.transcripts.search, {
      query: "jellyfish",
    });
    expect(found.limited).toBe(true);
    expect(found.results).toHaveLength(1);
    expect(found.results[0]?.passages.length).toBeLessThanOrEqual(3);
    expect(
      (await t.query(api.episodes.transcripts.search, { query: " " })).results
    ).toEqual([]);
    await expect(
      t.query(api.episodes.transcripts.search, { query: "word ".repeat(17) })
    ).rejects.toThrow();
  });
  test("maximum-size atomic replacement stays bounded", async () => {
    const { t, service, args } = await setup();
    const passages = Array.from(
      { length: MAX_TRANSCRIPT_PASSAGES },
      (_, i) => ({
        start: i * 10,
        end: i * 10 + 5,
        text: "jellyfish ".repeat(120),
      })
    );
    const original = await service.mutation(api.episodes.transcripts.replace, {
      ...args,
      passages,
    });
    const replacement = await service.mutation(
      api.episodes.transcripts.replace,
      {
        ...args,
        expectedHash: original.hash,
        passages: passages.map((p) => ({
          ...p,
          text: p.text.replace("jellyfish", "turtle"),
        })),
      }
    );
    expect(replacement.passageCount).toBe(MAX_TRANSCRIPT_PASSAGES);
    expect(
      await t.run(
        async (ctx) =>
          (
            await ctx.db.query("transcriptPassages").collect()
          ).length
      )
    ).toBe(MAX_TRANSCRIPT_PASSAGES);
  });
});

describe("pipeline transcript conversion", () => {
  test.each(["x".repeat(800), "🐠".repeat(200)])(
    "rejects source beyond grouping capacity before final passage validation",
    (text) => {
      const source = Array.from({ length: MAX_TRANSCRIPT_PASSAGES + 1 }, (_, i) => ({
        start: i, end: i + 1, text,
      }));
      expect(new TextEncoder().encode(source.map((p) => p.text).join("")).length)
        .toBeLessThan(MAX_TRANSCRIPT_BYTES);
      expect(buildPassages(source.slice(0, MAX_TRANSCRIPT_PASSAGES)).passages)
        .toHaveLength(MAX_TRANSCRIPT_PASSAGES);
      expect(() => buildPassages(source)).toThrow(/exceeds the 400-passage capacity/);
    }
  );
  test("counts overlap when checking passage capacity", () => {
    const source = Array.from({ length: MAX_TRANSCRIPT_PASSAGES * 2 + 2 }, (_, i) => ({
      start: i, end: i + 1, text: "x".repeat(399),
    }));
    expect(buildPassages(source.slice(0, -1)).passages).toHaveLength(MAX_TRANSCRIPT_PASSAGES);
    expect(() => buildPassages(source)).toThrow(/exceeds the 400-passage capacity/);
  });
  test("keeps adjacent segments together with original timestamps", () => {
    expect(
      buildPassages([
        { start: 1, end: 2, text: "luminous" },
        { start: 2, end: 3, text: "jellyfish" },
      ]).passages
    ).toEqual([{ start: 1, end: 3, text: "luminous jellyfish" }]);
  });
  test("splits oversized Unicode text without breaking characters", () => {
    const result = buildPassages([
      { start: 12, end: 50, text: "🐠".repeat(1200) },
    ]);
    expect(result.passages.length).toBeGreaterThan(1);
    for (const passage of result.passages) {
      expect(new TextEncoder().encode(passage.text).length).toBeLessThanOrEqual(
        2000
      );
      expect(passage.start).toBe(12);
      expect(/\p{Surrogate}/u.test(passage.text)).toBe(false);
    }
  });
  test.each([
    null,
    [],
    [{ start: -1, end: 3, text: "bad" }],
    [{ start: 4, end: 3, text: "bad" }],
    [{ start: 1, end: Infinity, text: "bad" }],
    [{ start: 0, end: 1, text: "\ud800" }],
    [
      { start: 2, end: 3, text: "later" },
      { start: 1, end: 2, text: "earlier" },
    ],
    [{ start: 0, end: 1, text: " " }],
  ])("rejects invalid transcript %j", (value) => {
    expect(() => buildPassages(value)).toThrow();
  });
  test("enforces size on direct API input too", () => {
    expect(() =>
      validatePassages([{ start: 0, end: 1, text: "x".repeat(2001) }])
    ).toThrow();
  });
});
