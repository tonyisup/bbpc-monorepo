import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [adapter, profilePage, profileSeasons, seasonRoute, seasonPage] =
  await Promise.all([
    read("src/convex/seasons.ts"),
    read("src/app/profile/ConvexProfilePage.tsx"),
    read("src/app/profile/ConvexProfileSeasons.tsx"),
    read("src/app/profile/seasons/[seasonId]/page.tsx"),
    read("src/app/profile/seasons/[seasonId]/ConvexSeasonPage.tsx"),
  ]);

test("the season adapter reads runtime-validated member season data", () => {
  assert.match(adapter, /api\.games\.member\.mySeasons/u);
  assert.match(adapter, /api\.games\.member\.mySeasonOverview/u);
  assert.match(adapter, /api\.games\.member\.mySeasonPointsPage/u);
  assert.match(adapter, /api\.games\.member\.mySeasonStanding/u);
  assert.match(adapter, /api\.games\.member\.mySeasonWagers/u);
  assert.match(adapter, /documentId\("seasons", seasonId\)/u);
  assert.match(adapter, /seasonSummarySchema\)\s*\.parse/u);
  assert.match(adapter, /seasonOverviewSchema\.parse/u);
  assert.match(adapter, /seasonPointsPageSchema\.parse/u);
  assert.match(adapter, /seasonWagerSchema\)\.parse/u);
});

test("the profile shows season summaries and sends detail to the season page", () => {
  assert.match(profilePage, /<ConvexProfileSeasons appUserId=/u);
  assert.doesNotMatch(profilePage, /ConvexPointHistory|UserPoints/u);
  assert.match(profileSeasons, /getProfileSeasonPath\(season\.id\)/u);
  assert.match(profileSeasons, /useLatestPointChange\(true\)/u);
  assert.match(profileSeasons, /loadConvexSeasonStanding\(convex, entry\.season\.id\)/u);
  assert.doesNotMatch(profileSeasons, /mySeasonPointsPage|loadConvexSeasonPointsPage/u);
  assert.match(profileSeasons, /<PlayGameLink \/>/u);
});

test("the season route renders the member season page behind the access gate", () => {
  assert.match(seasonRoute, /params: Promise<\{ seasonId: string \}>/u);
  assert.match(seasonRoute, /<ConvexSeasonPage seasonId=\{seasonId\} \/>/u);
  assert.match(seasonPage, /<ProfileAccessGate label="season">/u);
  assert.match(seasonPage, /loadConvexSeasonOverview\(convex, seasonId/u);
  assert.match(seasonPage, /<SeasonPointsByEpisode seasonId=\{seasonId\} \/>/u);
  assert.match(seasonPage, /<SeasonWagers wagers=\{wagers\}/u);
  assert.match(seasonPage, /overview\.isCurrent && <PlayGameLink \/>/u);
});
