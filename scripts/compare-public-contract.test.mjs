import assert from "node:assert/strict";
import test from "node:test";

import {
  assertEquivalentContracts,
  canonicalContract,
} from "./compare-public-contract.mjs";

const firstContract = `
export type PublicApiType = {
  zebra: {
    read: FunctionReference<
      "query",
      "public",
      { second: string; first: number },
      { right: string; left: number } | null
    >;
  };
  alpha: {
    write: FunctionReference<
      "mutation",
      "public",
      { clientApiVersion: string },
      null
    >;
  };
};
export type InternalApiType = {};
`;

const reorderedContract = `
export type PublicApiType = {
  alpha: {
    write: FunctionReference<
      "mutation",
      "public",
      { clientApiVersion: string },
      null
    >;
  };
  zebra: {
    read: FunctionReference<
      "query",
      "public",
      { first: number; second: string },
      null | { left: number; right: string }
    >;
  };
};
export type InternalApiType = {};
`;

test("treats generated property and union ordering as semantic", () => {
  assert.doesNotThrow(() =>
    assertEquivalentContracts(
      firstContract,
      reorderedContract,
    ),
  );
  assert.deepEqual(
    canonicalContract(firstContract),
    canonicalContract(reorderedContract),
  );
});

test("rejects a deployed signature change", () => {
  const changedContract = reorderedContract.replace(
    "{ clientApiVersion: string }",
    "{ clientApiVersion: number }",
  );
  assert.throws(
    () =>
      assertEquivalentContracts(firstContract, changedContract),
    /does not match the committed contract/u,
  );
});

test("requires both generated API type declarations", () => {
  assert.throws(
    () =>
      canonicalContract(
        "export type PublicApiType = {};",
        "Incomplete contract",
      ),
    /exactly one InternalApiType/u,
  );
});
