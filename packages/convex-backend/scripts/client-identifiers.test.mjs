import assert from "node:assert/strict";
import test from "node:test";

import { documentId } from "../contracts/index.js";

test("document IDs preserve serialized values and optional field semantics", () => {
  assert.equal(documentId("users", "user-1"), "user-1");
  assert.equal(documentId("users", null), null);
  assert.equal(documentId("users", undefined), undefined);
});

test("document IDs reject missing or non-string form values", () => {
  assert.throws(() => documentId("users", ""), /Invalid users identifier/);
  assert.throws(() => documentId("users", 42), /Invalid users identifier/);
});
