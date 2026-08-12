import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeJsonLines,
  sha256,
  transformMovieRow,
  transformShowRow,
  transformTagRow,
} from "./catalog-rows.mjs";

const RUN_ID = "synthetic-catalog-run-001";

test("transforms catalog rows while preserving source duplicates", () => {
  const first = transformMovieRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE1",
    title: "Same Movie",
    year: 2024,
    poster: "https://example.test/poster.jpg",
    url: "https://example.test/movie",
    tmdbId: 42,
  });
  const second = transformMovieRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE2",
    title: "Same Movie",
    year: 2024,
    poster: null,
    url: "https://example.test/movie",
    tmdbId: null,
  });

  assert.equal(
    first.legacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  );
  assert.equal(first.title, second.title);
  assert.equal(first.year, second.year);
  assert.equal("poster" in second, false);
  assert.equal("tmdbId" in second, false);
  assert.notEqual(first.sourceRowHash, second.sourceRowHash);
});

test("converts UTC catalog dates to epoch milliseconds", () => {
  const show = transformShowRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE3",
    title: "Synthetic Show",
    year: 2025,
    poster: null,
    url: "https://example.test/show",
  });
  const tag = transformTagRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE4",
    name: "Synthetic Tag",
    description: null,
    createdAt: new Date("2024-01-02T03:04:05.000Z"),
  });

  assert.equal(show.year, 2025);
  assert.equal("poster" in show, false);
  assert.equal(tag.createdAt, 1_704_164_645_000);
  assert.equal("description" in tag, false);
});

test("serializes deterministic newline-delimited catalog JSON", () => {
  const tag = transformTagRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE4",
    name: "Synthetic Tag",
    description: "Synthetic description",
    createdAt: new Date("2024-01-02T03:04:05.000Z"),
  });
  const jsonl = serializeJsonLines([tag]);

  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(jsonl.trimEnd().split("\n").length, 1);
  assert.equal(sha256(jsonl).length, 64);
});

test("rejects malformed catalog source rows", () => {
  assert.throws(
    () =>
      transformMovieRow(RUN_ID, {
        id: "not-a-uuid",
        title: "Movie",
        year: 2024,
        poster: null,
        url: "https://example.test/movie",
        tmdbId: null,
      }),
    /UUID/u,
  );
  assert.throws(
    () =>
      transformShowRow(RUN_ID, {
        id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE3",
        title: "Show",
        year: 32_768,
        poster: null,
        url: "https://example.test/show",
      }),
    /smallint/u,
  );
  assert.throws(
    () =>
      transformMovieRow(RUN_ID, {
        id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE1",
        title: "Movie",
        year: 2024,
        poster: null,
        url: "https://example.test/movie",
        tmdbId: 2_147_483_648,
      }),
    /SQL int/u,
  );
  assert.throws(
    () =>
      transformTagRow(RUN_ID, {
        id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE4",
        name: "Tag",
        description: null,
        createdAt: new Date(Number.NaN),
      }),
    /valid Date/u,
  );
});
