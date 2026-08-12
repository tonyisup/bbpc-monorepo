import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeJsonLines,
  sha256,
  transformArchivePostRow,
} from "./archive-rows.mjs";

const RUN_ID = "synthetic-archive-run-001";
const EPISODE_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE1";
const INSTANT = new Date("2025-01-02T03:04:05.000Z");

test("transforms linked and unlinked archive posts", () => {
  const linked = transformArchivePostRow(RUN_ID, {
    id: 1,
    postedOn: INSTANT,
    content: "Preserved content",
    title: "Preserved title",
    episodeId: EPISODE_ID,
  });
  const unlinked = transformArchivePostRow(RUN_ID, {
    id: 2,
    postedOn: INSTANT,
    content: "",
    title: "",
    episodeId: null,
  });

  assert.equal(linked.episodeLegacyId, EPISODE_ID.toLowerCase());
  assert.equal(linked.postedAt, INSTANT.getTime());
  assert.equal(linked.sourceRowHash.startsWith("sha256:"), true);
  assert.equal("episodeLegacyId" in unlinked, false);
  assert.equal(unlinked.content, "");
  assert.equal(unlinked.title, "");
});

test("serializes deterministic archive JSON lines", () => {
  const row = transformArchivePostRow(RUN_ID, {
    id: 1,
    postedOn: INSTANT,
    content: "Content",
    title: "Title",
    episodeId: null,
  });
  const jsonl = serializeJsonLines([row]);

  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(sha256(jsonl).length, 64);
});

test("rejects invalid archive identifiers and timestamps", () => {
  const base = {
    id: 1,
    postedOn: INSTANT,
    content: "Content",
    title: "Title",
    episodeId: null,
  };
  assert.throws(
    () => transformArchivePostRow(RUN_ID, { ...base, id: 0 }),
    /positive/u,
  );
  assert.throws(
    () =>
      transformArchivePostRow(RUN_ID, {
        ...base,
        id: 2_147_483_648,
      }),
    /SQL int/u,
  );
  assert.throws(
    () =>
      transformArchivePostRow(RUN_ID, {
        ...base,
        episodeId: "not-a-uuid",
      }),
    /UUID/u,
  );
  assert.throws(
    () =>
      transformArchivePostRow(RUN_ID, {
        ...base,
        postedOn: "2025-01-02",
      }),
    /valid Date/u,
  );
});

test("requires string content and title while preserving empty values", () => {
  const base = {
    id: 1,
    postedOn: INSTANT,
    content: "",
    title: "",
    episodeId: null,
  };
  assert.doesNotThrow(() => transformArchivePostRow(RUN_ID, base));
  assert.throws(
    () =>
      transformArchivePostRow(RUN_ID, {
        ...base,
        content: null,
      }),
    /Content must be a string/u,
  );
  assert.throws(
    () =>
      transformArchivePostRow(RUN_ID, {
        ...base,
        title: null,
      }),
    /Title must be a string/u,
  );
});
