import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [adapter, page, gamePage] = await Promise.all([
  read("src/server/convex/games.ts"),
  read("src/app/game/standings/page.tsx"),
  read("src/app/game/page.tsx"),
]);

test("the standings page reads runtime-validated public Convex data on the server", () => {
  assert.match(adapter, /import "server-only"/u);
  assert.match(adapter, /api\.games\.public\.standingsSeasons/u);
  assert.match(adapter, /api\.games\.public\.seasonStandings/u);
  assert.match(adapter, /z\s*\.array\(standingsSeasonSchema\)\s*\.parse\(/u);
  assert.match(adapter, /documentId\("seasons", seasonId\)/u);
  assert.doesNotMatch(page, /"use client"/u);
});

test("the standings page ignores repeated season values", () => {
  assert.match(page, /typeof requested === "string" \? requested : undefined/u);
  assert.match(page, /getConvexSeasonStandings\(season\.id, today\)/u);
  assert.doesNotMatch(page, /getConvexSeasonStandings\(requested/u);
});

test("the game page links to the standings beside the Quotabunga archive", () => {
  assert.match(gamePage, /href=\{getStandingsArchivePath\(\)\}/u);
  assert.match(gamePage, /href=\{getQuotabungaArchivePath\(\)\}/u);
});
