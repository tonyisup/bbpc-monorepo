import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [route, gate, manager, adapter, yearPage] = await Promise.all([
  read("src/app/year/scorecard/page.tsx"),
  read("src/app/year/scorecard/ConvexScorecardPage.tsx"),
  read("src/app/year/scorecard/ScorecardManager.tsx"),
  read("src/convex/scorecard.ts"),
  read("src/app/year/ConvexYearPageClient.tsx"),
]);

test("the scorecard route renders the signed-in gate", () => {
  // protects=route wiring; fails_when=the route skips the auth gate; no_claim=server-side authorization
  assert.match(route, /<ConvexScorecardPage \/>/u);
  assert.match(gate, /Sign in to use your scorecard/u);
  assert.match(gate, /user\.appUserId === null/u);
  assert.doesNotMatch(route + gate + manager, /next-auth|trpc|prisma|server\/db/u);
});

test("the scorecard adapter uses owner-derived, versioned, validated calls", () => {
  // protects=adapter contract; fails_when=a call passes a user id, skips the API version or skips zod parsing; no_claim=backend behavior
  for (const name of [
    "listForYear",
    "setScore",
    "add",
    "setUnseen",
    "clear",
    "orderTie",
    "applyToRankedList",
  ]) {
    assert.ok(adapter.includes(`api.scorecard.mine.${name}`), name);
  }
  assert.doesNotMatch(adapter, /userId/u);
  assert.match(adapter, /clientApiVersion: BBPC_CLIENT_API_VERSION/u);
  assert.match(adapter, /z\s*\.array\(scorecardEntrySchema\)\s*\.parse/u);
});

test("the year page links to the scorecard for the selected year", () => {
  // protects=entry point; fails_when=the /year link is removed or loses the year; no_claim=none beyond protects
  assert.match(yearPage, /\/year\/scorecard\?year=\$\{String\(selectedYear\)\}/u);
});
