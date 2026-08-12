import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [prediction, board, adapter, wager] = await Promise.all([
  read("src/components/ConvexPredictionGame.tsx"),
  read("src/components/ConvexAssignmentGamblingBoard.tsx"),
  read("src/convex/wagers.ts"),
  read("src/components/BettingCoin.tsx"),
]);

test("Convex wagering uses bounded and owner-derived game functions", () => {
  for (const name of [
    "games/gambling:listActiveTypes",
    "games/gambling:mineForAssignment",
    "games/member:myAvailablePoints",
    "games/gambling:submit",
  ]) {
    assert.match(adapter, new RegExp(name.replace("/", "\\/"), "u"));
  }
  assert.match(adapter, /targetUserId/u);
  assert.doesNotMatch(adapter, /ownerUserId|input\.userId/u);
  assert.match(adapter, /BBPC_CLIENT_API_VERSION/u);
  assert.match(adapter, /wagerEntrySchema\.parse/u);
  assert.match(adapter, /getPacificTodayPlainDate/u);
});

test("the Convex wager board reuses neutral controls without SQL dependencies", () => {
  assert.doesNotMatch(board, /next-auth|trpc|prisma|server\/db/u);
  assert.doesNotMatch(wager, /@prisma\/client/u);
  assert.match(board, /getPredictionRoundState\(episodeStatus, playable\)/u);
  assert.match(board, /await reload\(\)[\s\S]*throw error/u);
  assert.match(board, /formatSubmissionError=\{wagerError\}/u);
  assert.match(board, /Wagers can lose points/u);
  assert.match(board, /Available/u);
  assert.match(board, /One host/u);
  assert.match(board, /Two hosts/u);
  assert.match(board, /All hosts/u);
});

test("wagering is exposed only after every host prediction is present", () => {
  assert.match(
    prediction,
    /hasAllGuesses \? \([\s\S]*<ConvexAssignmentGamblingBoard/u
  );
  assert.match(
    prediction,
    /<ConvexAssignmentVoiceMessages assignmentId=\{assignment\.id\}/u
  );
  assert.doesNotMatch(
    prediction,
    /Assignment voice messages are temporarily read-only/u
  );
});
