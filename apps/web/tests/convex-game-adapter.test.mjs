import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [adapter, gamePage, performance, participation, authContext, identity] =
  await Promise.all([
    read("src/server/convex/games.ts"),
    read("src/app/game/page.tsx"),
    read("src/components/GamePerformanceTracking.tsx"),
    read("src/components/GameParticipation.tsx"),
    read("src/components/auth/BbpcAuthContext.tsx"),
    read("src/convex/identity.ts"),
  ]);

test("the public game page reads bounded runtime-validated Convex data directly", () => {
  assert.match(adapter, /import "server-only"/u);
  assert.match(adapter, /games\/public:predictionScoring/u);
  assert.match(adapter, /games\/public:currentPerformance/u);
  assert.match(adapter, /predictionScoringSchema\.parse/u);
  assert.match(adapter, /currentPerformanceSchema\.parse/u);
  assert.doesNotMatch(gamePage, /BBPC_BACKEND|server\/sql|trpc/u);
  assert.match(
    gamePage,
    /getNextScheduledEpisode\(\)[\s\S]*getConvexPredictionScoring\(\)[\s\S]*getConvexCurrentPerformance\(today\)/u
  );
  assert.doesNotMatch(gamePage, /<NextEpisode/u);
  assert.doesNotMatch(performance, /api\.season/u);
});

test("Clerk subjects never become legacy application-data identifiers", () => {
  assert.match(authContext, /appUserId: profile\?\.id \?\? null/u);
  assert.doesNotMatch(authContext, /appUserId: user\.id/u);
  assert.match(
    authContext,
    /A Clerk subject must never be used as[\s\S]*application-data foreign key/u
  );
  assert.match(identity, /identity\/profile:me/u);
  assert.match(identity, /IDENTITY_NOT_LINKED/u);
  assert.match(identity, /identity\/linking:linkOrCreateMe/u);
  assert.match(identity, /BBPC_CLIENT_API_VERSION = "0\.1\.0"/u);
  assert.ok(
    identity.indexOf('!== "IDENTITY_NOT_LINKED"') <
      identity.indexOf("client.mutation")
  );
  assert.match(
    participation,
    /accountStatus !== "ready"[\s\S]*<ConvexPredictionGame/u
  );
  assert.doesNotMatch(participation, /backend|userId=\{user\.appUserId\}/u);
});
