/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { api } from "./_generated/api.js";
import schema from "./schema.js";
import { BBPC_API_VERSION } from "../contracts/index.js";
import { dashboardTriggers } from "./lib/dashboardProjection.js";
import { transcriptFingerprintInput } from "./lib/transcriptModel.js";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  tokenIdentifier: "https://merge.example.test|admin",
  issuer: "https://merge.example.test",
  subject: "admin",
};
const confirmation = "MERGE_WITHOUT_REDIRECTS_AND_REBUILD_SLUG" as const;

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (raw) => {
    const ctx = { ...raw, ...dashboardTriggers.wrapDB(raw) };
    const userId = await ctx.db.insert("users", {
      name: "Test admin",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...identity,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    const roleId = await ctx.db.insert("roles", {
      name: "Administrator",
      normalizedName: "administrator",
      description: "Synthetic admin",
      admin: true,
      permissions: ["admin"],
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("userRoles", { userId, roleId, assignedAt: 1 });
    const stateId = await ctx.db.insert("systemState", {
      singletonKey: "global",
      cutoverStage: "S3",
      applicationWriteMode: "enabled",
      apiVersion: BBPC_API_VERSION,
      cutoverRunId: "synthetic-merge",
      initializedAt: 1,
      updatedAt: 1,
      updatedBy: "test",
    });
    const common = {
      number: 100,
      title: "Synthetic Example",
      status: "published",
    };
    const keeperId = await ctx.db.insert("episodes", {
      ...common,
      date: "2020-01-01",
      slug: "episode-100-synthetic-example-2",
      normalizedSlug: "episode-100-synthetic-example-2",
      seoTitle: "Keep SEO",
    });
    const donorId = await ctx.db.insert("episodes", {
      ...common,
      title: "100 - Synthetic Example",
      date: "2020-01-03",
      slug: "episode-100-synthetic-example",
      normalizedSlug: "episode-100-synthetic-example",
      recording: "https://archive.example.test/audio.mp3",
      description: "Preserve description",
    });
    const passage = {
      start: 0,
      end: 10,
      text: "Synthetic transcript for a safe local test.",
    };
    const hash = bytesToHex(
      sha256(new TextEncoder().encode(transcriptFingerprintInput([passage])))
    );
    const transcriptId = await ctx.db.insert("episodeTranscripts", {
      episodeId: keeperId,
      hash,
      version: "passages-v1",
      passageCount: 1,
      updatedAt: 1,
    });
    const passageId = await ctx.db.insert("transcriptPassages", {
      episodeId: keeperId,
      hash,
      isPublic: true,
      sequence: 0,
      ...passage,
    });
    const archiveId = await ctx.db.insert("archivePosts", {
      episodeId: donorId,
      postedAt: 1,
      content: "Original archive body",
      title: "Archive",
    });
    const linkId = await ctx.db.insert("episodeLinks", {
      episodeId: donorId,
      url: "https://example.test/source",
      text: "Source",
    });
    const movieId = await ctx.db.insert("movies", {
      title: "Example",
      normalizedTitle: "example",
      year: 2000,
      url: "https://example.test/movie",
    });
    const assignmentId = await ctx.db.insert("assignments", {
      episodeId: donorId,
      userId,
      movieId,
      type: "homework",
      playable: true,
    });
    const reviewId = await ctx.db.insert("reviews", { movieId, userId });
    const extraId = await ctx.db.insert("extraReviews", {
      episodeId: donorId,
      reviewId,
    });
    const assignmentReviewId = await ctx.db.insert("assignmentReviews", {
      assignmentId,
      reviewId,
    });
    return {
      keeperId,
      donorId,
      stateId,
      userId,
      roleId,
      movieId,
      transcriptId,
      passageId,
      archiveId,
      linkId,
      assignmentId,
      reviewId,
      extraId,
      assignmentReviewId,
    };
  });
  const admin = t.withIdentity(identity);
  const pair = { keeperId: ids.keeperId, donorId: ids.donorId };
  const preview = () =>
    admin.query(api.episodes.admin.previewDuplicateMerge, pair);
  const commit = (expectedFingerprint: string, extras = {}) =>
    admin.mutation(api.episodes.admin.mergeDuplicateEpisode, {
      ...pair,
      expectedFingerprint,
      backupReceipt: "synthetic-local-backup",
      confirmation,
      clientApiVersion: BBPC_API_VERSION,
      ...extras,
    });
  return { t, admin, ids, pair, preview, commit };
}

test("preview is read-only; merge preserves transcripts and children, rebuilds base slug and counts", async () => {
  const f = await fixture();
  const before = await f.t.run((ctx) =>
    ctx.db.get("transcriptPassages", f.ids.passageId)
  );
  const p = await f.preview();
  const backup: unknown = JSON.parse(p.snapshotJson);
  expect(backup).toMatchObject({
    donor: { _id: f.ids.donorId },
    passages: [expect.objectContaining({ _id: f.ids.passageId })],
  });
  expect(
    await f.t.run((ctx) => ctx.db.get("episodes", f.ids.donorId))
  ).not.toBeNull();
  const result = await f.commit(p.fingerprint);
  expect(result.slug).toBe("episode-100-synthetic-example");
  await f.t.run(async (ctx) => {
    expect(await ctx.db.get("episodes", f.ids.donorId)).toBeNull();
    expect(await ctx.db.get("episodes", f.ids.keeperId)).toMatchObject({
      date: "2020-01-01",
      recording: "https://archive.example.test/audio.mp3",
      description: "Preserve description",
      seoTitle: "Keep SEO",
      slug: result.slug,
      normalizedSlug: result.slug,
    });
    expect(await ctx.db.get("transcriptPassages", f.ids.passageId)).toEqual(
      before
    );
    expect(
      await ctx.db.get("episodeTranscripts", f.ids.transcriptId)
    ).toMatchObject({ episodeId: f.ids.keeperId });
    for (const [table, id] of [
      ["archivePosts", f.ids.archiveId],
      ["episodeLinks", f.ids.linkId],
      ["assignments", f.ids.assignmentId],
      ["extraReviews", f.ids.extraId],
    ] as const)
      expect(await ctx.db.get(table, id)).toMatchObject({
        episodeId: f.ids.keeperId,
      });
    expect(
      await ctx.db.get("assignmentReviews", f.ids.assignmentReviewId)
    ).toMatchObject({
      assignmentId: f.ids.assignmentId,
      reviewId: f.ids.reviewId,
    });
    expect(await ctx.db.query("dashboardEpisodes").take(10)).toMatchObject([
      { episodeId: f.ids.keeperId, hasRecording: true },
    ]);
    expect(
      await ctx.db
        .query("dashboardCounts")
        .withIndex("by_key", (q) => q.eq("key", "episodes"))
        .unique()
    ).toMatchObject({ count: 1 });
    expect(
      await ctx.db
        .query("dashboardCountMembers")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", f.ids.donorId))
        .unique()
    ).toBeNull();
    expect(
      (await ctx.db.query("auditEvents").take(10)).find(
        (e) => e.action === "episodes.admin.duplicateMerged"
      )?.metadata
    ).toMatchObject({
      donorId: f.ids.donorId,
      redirects: false,
      fingerprint: p.fingerprint,
    });
  });
  expect(
    await f.t.query(api.episodes.public.getBySlug, { slug: result.slug })
  ).toMatchObject({ id: f.ids.keeperId });
  expect(
    await f.t.query(api.episodes.public.getBySlug, {
      slug: "episode-100-synthetic-example-2",
    })
  ).toBeNull();
  await expect(f.commit(p.fingerprint)).rejects.toThrow(
    /Both episodes must still exist/
  );
});

test.each(["episode", "relationship", "new-link", "transcript"])(
  "rejects stale preview after %s changes",
  async (kind) => {
    const f = await fixture();
    const p = await f.preview();
    await f.t.run(async (ctx) => {
      if (kind === "episode")
        await ctx.db.patch("episodes", f.ids.keeperId, { notes: "new" });
      if (kind === "relationship")
        await ctx.db.patch("archivePosts", f.ids.archiveId, {
          content: "Edited",
        });
      if (kind === "new-link")
        await ctx.db.insert("episodeLinks", {
          episodeId: f.ids.donorId,
          text: "New",
          url: "https://example.test/new",
        });
      if (kind === "transcript")
        await ctx.db.patch("episodeTranscripts", f.ids.transcriptId, {
          updatedAt: 2,
        });
    });
    await expect(f.commit(p.fingerprint)).rejects.toThrow(/Merge data changed/);
    expect(
      await f.t.run((ctx) => ctx.db.get("episodes", f.ids.donorId))
    ).not.toBeNull();
  }
);

test.each([
  "zero",
  "title",
  "date",
  "status",
  "recording",
  "third",
  "slug",
  "donor-transcript",
  "orphan",
  "integrity",
  "duplicate-link",
  "capacity",
  "unsupported",
])("blocks unsafe %s pair", async (kind) => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    if (kind === "zero")
      await ctx.db.patch("episodes", f.ids.keeperId, { number: 0 });
    if (kind === "title")
      await ctx.db.patch("episodes", f.ids.donorId, {
        title: "Another episode",
      });
    if (kind === "date")
      await ctx.db.patch("episodes", f.ids.keeperId, { date: "2017-01-01" });
    if (kind === "status")
      await ctx.db.patch("episodes", f.ids.donorId, { status: "pending" });
    if (kind === "recording")
      await ctx.db.patch("episodes", f.ids.keeperId, {
        recording: "https://example.test/different.mp3",
      });
    if (kind === "third")
      await ctx.db.insert("episodes", { number: 100, title: "Third" });
    if (kind === "slug") {
      await ctx.db.patch("episodes", f.ids.donorId, {
        slug: "other",
        normalizedSlug: "other",
      });
      await ctx.db.insert("episodes", {
        number: 101,
        title: "Collision",
        normalizedSlug: "episode-100-synthetic-example",
      });
    }
    if (kind === "donor-transcript")
      await ctx.db.insert("episodeTranscripts", {
        episodeId: f.ids.donorId,
        hash: "unexpected",
        version: "passages-v1",
        passageCount: 0,
        updatedAt: 1,
      });
    if (kind === "orphan")
      await ctx.db.insert("transcriptPassages", {
        episodeId: f.ids.donorId,
        hash: "orphan",
        sequence: 0,
        start: 0,
        end: 1,
        text: "orphan",
        isPublic: true,
      });
    if (kind === "integrity")
      await ctx.db.patch("transcriptPassages", f.ids.passageId, {
        text: "Changed without updating hash",
      });
    if (kind === "duplicate-link")
      await ctx.db.insert("episodeLinks", {
        episodeId: f.ids.keeperId,
        text: "Duplicate",
        url: "https://example.test/source",
      });
    if (kind === "capacity")
      for (let n = 0; n < 50; n++)
        await ctx.db.insert("episodeLinks", {
          episodeId: f.ids.keeperId,
          text: "Extra",
          url: `https://example.test/${String(n)}`,
        });
    if (kind === "unsupported")
      await ctx.db.insert("episodeAudioMessages", {
        episodeId: f.ids.donorId,
        userId: f.ids.userId,
        url: "https://example.test/message",
        createdAt: 1,
      });
  });
  await expect(f.preview()).rejects.toThrow();
  expect(
    await f.t.run((ctx) => ctx.db.get("episodes", f.ids.donorId))
  ).not.toBeNull();
});

test("requires administrator, write gate, current client, backup acknowledgement and explicit confirmation", async () => {
  const f = await fixture();
  const p = await f.preview();
  await expect(
    f.t.query(api.episodes.admin.previewDuplicateMerge, f.pair)
  ).rejects.toThrow();
  await expect(f.commit(p.fingerprint, { backupReceipt: " " })).rejects.toThrow(
    /backup receipt/
  );
  await expect(
    f.commit(p.fingerprint, { clientApiVersion: "old" })
  ).rejects.toThrow();
  await expect(
    f.commit(p.fingerprint, { confirmation: "wrong" })
  ).rejects.toThrow();
  await f.t.run((ctx) =>
    ctx.db.patch("systemState", f.ids.stateId, {
      applicationWriteMode: "disabled",
    })
  );
  await expect(f.commit(p.fingerprint)).rejects.toThrow(/read-only/);
  await f.t.run(async (ctx) => {
    const rows = await ctx.db.query("userRoles").take(10);
    for (const row of rows) await ctx.db.delete("userRoles", row._id);
  });
  await expect(f.preview()).rejects.toThrow();
});

test("late trigger failure rolls back child moves, donor deletion and slug clear", async () => {
  const f = await fixture();
  const p = await f.preview();
  await f.t.run((ctx) =>
    ctx.db.insert("dashboardEpisodes", {
      episodeId: f.ids.keeperId,
      status: "published",
      date: "2020-01-01",
      number: 100,
      hasRecording: false,
      createdAt: 1,
    })
  );
  await expect(f.commit(p.fingerprint)).rejects.toThrow();
  await f.t.run(async (ctx) => {
    expect(await ctx.db.get("episodes", f.ids.donorId)).not.toBeNull();
    expect(await ctx.db.get("archivePosts", f.ids.archiveId)).toMatchObject({
      episodeId: f.ids.donorId,
    });
    expect(await ctx.db.get("episodes", f.ids.keeperId)).toMatchObject({
      slug: "episode-100-synthetic-example-2",
    });
  });
});
