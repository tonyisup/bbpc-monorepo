import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeJsonLines,
  sha256,
  transformBangerRow,
  transformEpisodeAudioMessageRow,
  transformEpisodeLinkRow,
  transformEpisodeRow,
} from "./episode-rows.mjs";

const RUN_ID = "synthetic-episode-run-001";
const EPISODE_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE1";

test("preserves episode fields and calendar dates", () => {
  const row = transformEpisodeRow(RUN_ID, {
    id: EPISODE_ID,
    number: 101,
    title: "Synthetic Episode",
    recording: "https://example.test/recording",
    date: new Date("2025-02-03T00:00:00.000Z"),
    description: "Description",
    status: "published",
    notes: "Notes",
    seoDescription: "SEO description",
    seoKeywords: "synthetic,episode",
    seoTitle: "SEO title",
    slug: "episode-101",
  });

  assert.equal(
    row.legacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  );
  assert.equal(row.date, "2025-02-03");
  assert.equal(row.seoTitle, "SEO title");
  assert.equal(row.slug, "episode-101");
});

test("preserves nullable episode and user relationships", () => {
  const link = transformEpisodeLinkRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE2",
    url: "https://example.test/link",
    text: "Link",
    episodeId: null,
  });
  const banger = transformBangerRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE3",
    title: "Song",
    artist: "Artist",
    url: "https://example.test/song",
    episodeId: EPISODE_ID,
    userId: null,
  });

  assert.equal("episodeLegacyId" in link, false);
  assert.equal(
    banger.episodeLegacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  );
  assert.equal("userLegacyId" in banger, false);
});

test("converts audio timestamps and keeps media external", () => {
  const audio = transformEpisodeAudioMessageRow(RUN_ID, {
    id: 7,
    url: "https://example.test/audio",
    createdAt: new Date("2024-01-02T03:04:05.000Z"),
    fileKey: "audio/seven",
    userId: "legacy-user",
    episodeId: EPISODE_ID,
    notes: null,
  });

  assert.equal(audio.legacyId, 7);
  assert.equal(audio.createdAt, 1_704_164_645_000);
  assert.equal(audio.userLegacyId, "legacy-user");
  assert.equal("notes" in audio, false);
  assert.equal("bytes" in audio, false);
});

test("serializes deterministic episode JSON lines", () => {
  const episode = transformEpisodeRow(RUN_ID, {
    id: EPISODE_ID,
    number: 1,
    title: "Minimal",
    recording: null,
    date: null,
    description: null,
    status: null,
    notes: null,
    seoDescription: null,
    seoKeywords: null,
    seoTitle: null,
    slug: null,
  });
  const jsonl = serializeJsonLines([episode]);

  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(sha256(jsonl).length, 64);
});

test("rejects malformed episode rows", () => {
  assert.throws(
    () =>
      transformEpisodeRow(RUN_ID, {
        id: EPISODE_ID,
        number: 32_768,
        title: "Episode",
        recording: null,
        date: null,
        description: null,
        status: null,
        notes: null,
        seoDescription: null,
        seoKeywords: null,
        seoTitle: null,
        slug: null,
      }),
    /smallint/u,
  );
  assert.throws(
    () =>
      transformEpisodeLinkRow(RUN_ID, {
        id: "not-a-uuid",
        url: "https://example.test/link",
        text: "Link",
        episodeId: null,
      }),
    /UUID/u,
  );
  assert.throws(
    () =>
      transformEpisodeAudioMessageRow(RUN_ID, {
        id: 1,
        url: "https://example.test/audio",
        createdAt: new Date(Number.NaN),
        fileKey: null,
        userId: "legacy-user",
        episodeId: null,
        notes: null,
      }),
    /valid Date/u,
  );
});
