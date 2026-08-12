import assert from "node:assert/strict";
import test from "node:test";

import { parseNamedArguments } from "./cli.mjs";

test("parses separated and equals-style named arguments", () => {
  assert.deepEqual(
    Object.fromEntries(
      parseNamedArguments([
        "--run-id",
        "run-one",
        "--source-env=source.env",
        "--dry-run",
      ]),
    ),
    {
      "run-id": "run-one",
      "source-env": "source.env",
      "dry-run": "",
    },
  );
});

test("rejects positional arguments", () => {
  assert.throws(
    () => parseNamedArguments(["run-one"]),
    /Unexpected positional argument/u,
  );
});
