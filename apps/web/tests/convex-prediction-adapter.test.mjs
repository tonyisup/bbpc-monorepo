import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [participation, component, adapter] = await Promise.all([
  read("src/components/GameParticipation.tsx"),
  read("src/components/ConvexPredictionGame.tsx"),
  read("src/convex/predictions.ts"),
]);

test("Convex predictions combine bounded catalogs with owner-derived guesses", () => {
  for (const name of [
    "identity/public:listHosts",
    "ratings/public:list",
    "games/public:hasActiveSeason",
    "games/public:predictionScoring",
    "games/guesses:mineForAssignments",
    "games/guesses:submit",
  ]) {
    assert.ok(adapter.includes(`api.${name.replaceAll("/", ".").replace(":", ".")}`), name);
  }
  assert.doesNotMatch(adapter, /userId/u);
  assert.match(adapter, /BBPC_CLIENT_API_VERSION/u);
  assert.match(adapter, /getPacificTodayPlainDate/u);
  assert.match(adapter, /assignmentGuessGroupSchema/u);
  assert.match(adapter, /guessSchema\.parse/u);
});

test("the Convex prediction UI is independent of the SQL transport and auth stack", () => {
  assert.doesNotMatch(component, /next-auth|trpc|prisma|server\/db/u);
  assert.match(component, /getPredictionRoundState/u);
  assert.match(component, /submitConvexPrediction/u);
  // Pending, confirmed, and failed saves are exercised by ListenerInteractions.behavior.test.tsx.
  assert.match(component, /ConvexAssignmentGamblingBoard/u);
  for (const name of [
    "assignments/public:listMyAudioMessages",
    "assignments/public:createMyAudioMessage",
    "assignments/public:deleteMyAudioMessage",
    "assignments/public:discardMyAudioUpload",
  ]) {
    assert.ok(component.includes(`api.${name.replaceAll("/", ".").replace(":", ".")}`), name);
  }
  assert.match(component, /useUploadThing\("audioUploader"\)/u);
  assert.doesNotMatch(
    component,
    /Assignment voice messages are temporarily read-only/u
  );
});

test("canonical account resolution gates both Convex participation clients", () => {
  assert.match(participation, /accountStatus !== "ready"/u);
  assert.match(
    participation,
    /<ConvexPredictionGame[\s\S]*<ConvexQuotabungaSubmission/u
  );
  assert.doesNotMatch(participation, /backend|<PredictionGame/u);
});
