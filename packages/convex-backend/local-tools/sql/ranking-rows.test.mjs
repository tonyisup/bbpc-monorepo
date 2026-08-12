import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeJsonLines,
  sha256,
  transformRankedItemRow,
  transformRankedListRow,
  transformRankedListTypeRow,
} from "./ranking-rows.mjs";

const RUN_ID = "synthetic-ranking-run-001";
const TYPE_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE1";
const LIST_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE2";
const ITEM_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE3";
const TARGET_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE4";
const INSTANT = new Date("2025-01-02T03:04:05.000Z");

test("transforms ranked-list type and list metadata", () => {
  const type = transformRankedListTypeRow(RUN_ID, {
    id: TYPE_ID,
    name: "Movies",
    description: null,
    maxItems: 10,
    targetType: "MOVIE",
    createdAt: INSTANT,
    updatedAt: INSTANT,
  });
  const list = transformRankedListRow(RUN_ID, {
    id: LIST_ID,
    userId: "legacy-user",
    rankedListTypeId: TYPE_ID,
    status: "PUBLISHED",
    title: null,
    createdAt: INSTANT,
    updatedAt: INSTANT,
  });

  assert.equal(type.legacyId, TYPE_ID.toLowerCase());
  assert.equal(type.maxItems, 10);
  assert.equal("description" in type, false);
  assert.equal(list.rankedListTypeLegacyId, TYPE_ID.toLowerCase());
  assert.equal("title" in list, false);
});

test("preserves each ranked-item target shape", () => {
  for (const [field, output] of [
    ["movieId", "movieLegacyId"],
    ["showId", "showLegacyId"],
    ["episodeId", "episodeLegacyId"],
  ]) {
    const row = transformRankedItemRow(RUN_ID, {
      id: ITEM_ID,
      rankedListId: LIST_ID,
      movieId: null,
      showId: null,
      episodeId: null,
      [field]: TARGET_ID,
      rank: 1,
      comment: null,
      createdAt: INSTANT,
      updatedAt: INSTANT,
    });
    assert.equal(row[output], TARGET_ID.toLowerCase());
    assert.equal("comment" in row, false);
  }
});

test("serializes deterministic ranking JSON lines", () => {
  const row = transformRankedListTypeRow(RUN_ID, {
    id: TYPE_ID,
    name: "Movies",
    description: "Movie rankings",
    maxItems: 10,
    targetType: "MOVIE",
    createdAt: INSTANT,
    updatedAt: INSTANT,
  });
  const jsonl = serializeJsonLines([row]);

  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(sha256(jsonl).length, 64);
});

test("rejects unsupported type, status, count, and target shapes", () => {
  const baseType = {
    id: TYPE_ID,
    name: "Movies",
    description: null,
    maxItems: 10,
    targetType: "MOVIE",
    createdAt: INSTANT,
    updatedAt: INSTANT,
  };
  assert.throws(
    () =>
      transformRankedListTypeRow(RUN_ID, {
        ...baseType,
        maxItems: 101,
      }),
    /maxItems/u,
  );
  assert.throws(
    () =>
      transformRankedListTypeRow(RUN_ID, {
        ...baseType,
        targetType: "BOOK",
      }),
    /targetType/u,
  );
  assert.throws(
    () =>
      transformRankedListRow(RUN_ID, {
        id: LIST_ID,
        userId: "legacy-user",
        rankedListTypeId: TYPE_ID,
        status: "INVALID",
        title: null,
        createdAt: INSTANT,
        updatedAt: INSTANT,
      }),
    /status/u,
  );
  assert.throws(
    () =>
      transformRankedItemRow(RUN_ID, {
        id: ITEM_ID,
        rankedListId: LIST_ID,
        movieId: null,
        showId: null,
        episodeId: null,
        rank: 1,
        comment: null,
        createdAt: INSTANT,
        updatedAt: INSTANT,
      }),
    /exactly one/u,
  );
  assert.throws(
    () =>
      transformRankedItemRow(RUN_ID, {
        id: ITEM_ID,
        rankedListId: LIST_ID,
        movieId: TARGET_ID,
        showId: TARGET_ID,
        episodeId: null,
        rank: 1,
        comment: null,
        createdAt: INSTANT,
        updatedAt: INSTANT,
      }),
    /exactly one/u,
  );
  assert.throws(
    () =>
      transformRankedItemRow(RUN_ID, {
        id: ITEM_ID,
        rankedListId: LIST_ID,
        movieId: TARGET_ID,
        showId: null,
        episodeId: null,
        rank: 0,
        comment: null,
        createdAt: INSTANT,
        updatedAt: INSTANT,
      }),
    /positive/u,
  );
});
