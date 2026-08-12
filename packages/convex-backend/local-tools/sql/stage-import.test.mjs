import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalImportSpec } from "./stage-import.mjs";

test("uses the verified JSONL file for nonempty staging", () => {
  assert.deepEqual(
    buildLocalImportSpec(
      {
        table: "migrationRawUsers",
        filePath: "/private/source.jsonl",
        rowCount: 19,
      },
      "/private/empty.json",
    ),
    {
      filePath: "/private/source.jsonl",
      format: "jsonLines",
    },
  );
});

test("uses an empty JSON array to replace zero-row tables", () => {
  assert.deepEqual(
    buildLocalImportSpec(
      {
        table: "migrationRawBangers",
        filePath: "/private/source.jsonl",
        rowCount: 0,
      },
      "/private/empty.json",
    ),
    {
      filePath: "/private/empty.json",
      format: "jsonArray",
    },
  );
});

test("rejects invalid verified file metadata", () => {
  assert.throws(
    () =>
      buildLocalImportSpec(
        {
          table: "migrationRawBangers",
          filePath: "/private/source.jsonl",
          rowCount: -1,
        },
        "/private/empty.json",
      ),
    /verified staging file/u,
  );
});
