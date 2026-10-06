import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [adapter, page, gamePage, roundRow, routes] = await Promise.all([
  read("src/server/convex/quotabunga.ts"),
  read("src/app/game/quotabunga/page.tsx"),
  read("src/app/game/page.tsx"),
  read("src/app/game/quotabunga/QuotabungaRoundRow.tsx"),
  read("src/lib/routes.ts"),
]);

test("the Quotabunga archive reads runtime-validated public Convex data on the server", () => {
  assert.match(adapter, /import "server-only"/u);
  assert.match(adapter, /api\.games\.public\.quotabungaSeasons/u);
  assert.match(adapter, /api\.games\.public\.quotabungaSeason;/u);
  assert.match(adapter, /fetchPublicQuery\(quotabungaSeasonsQuery, \{ today \}\)/u);
  assert.match(adapter, /seasonDetailSchema\.parse/u);
  // Listener-supplied links to other sites never reach the page.
  assert.match(
    adapter,
    /clipUrl: z\.string\(\)\.nullable\(\)\.transform\(youtubeUrlOrNull\)/u
  );
  assert.match(adapter, /documentId\("seasons", seasonId\)/u);
  assert.doesNotMatch(adapter, /listenerNotes|adminNotes|email/u);
});

test("the archive page only loads seasons the backend listed", () => {
  assert.match(page, /selectSeasonView\(\s*seasons,/u);
  assert.match(
    page,
    /shown\.map\(\(season\) => getQuotabungaSeason\(season\.id, today, now\)\)/u
  );
  assert.doesNotMatch(page, /getQuotabungaSeason\(requested/u);
  assert.doesNotMatch(page, /"use client"/u);
});

test("the game page links to the archive and the open round links back to it", () => {
  assert.match(gamePage, /href=\{getQuotabungaArchivePath\(\)\}/u);
  assert.match(gamePage, /id="current-round-heading"/u);
  // A plain module, so server and client components can both import it.
  assert.match(routes, /SUBMIT_QUOTE_PATH = "\/game#current-round-heading"/u);
  assert.doesNotMatch(routes, /"use client"/u);
  assert.match(roundRow, /<Link href=\{SUBMIT_QUOTE_PATH\}>/u);
});

test("the archive page ignores repeated season values and seasons that vanish mid-load", () => {
  assert.match(page, /typeof requested === "string" \? requested : undefined/u);
  assert.match(
    page,
    /flatMap\(\(detail\) => \(detail === null \? \[\] : \[detail\]\)\)/u
  );
  assert.match(page, /view\.kind === "none" \?/u);
  assert.match(page, /No Quotabunga rounds yet/u);
  // The all-seasons view sends each season's overflow to that season's tab.
  assert.match(page, /moreHref=\{getQuotabungaArchivePath\(season\.id\)\}/u);
  // An empty season has no open round, so it offers no way to submit.
  assert.doesNotMatch(page, /SUBMIT_QUOTE_PATH/u);
});

test("the archive loader rejects round states and places the page cannot draw", () => {
  assert.match(adapter, /state: z\.enum\(\["open", "locked", "revealed"\]\)/u);
  assert.match(
    adapter,
    /placement: z\.union\(\[z\.literal\(1\), z\.literal\(2\), z\.literal\(3\)\]\)\.nullable\(\)/u
  );
  assert.match(adapter, /sourceType: z\.enum\(\["MOVIE", "TV", "OTHER"\]\)/u);
  assert.match(adapter, /z\s*\.array\(seasonSchema\)\s*\.parse\(/u);
});

test("the archive page shares one clip player and rounds the clock to cache", () => {
  // Keyed by the selected view, so a season change never resumes a clip.
  assert.match(
    page,
    /<ClipPlaybackProvider\s+key=\{view\.kind === "all" \? ALL_SEASONS : view\.season\.id\}\s*>[\s\S]*<\/ClipPlaybackProvider>/u
  );
  assert.match(page, /key=\{winner\.entry\.id\}/u);
  assert.match(page, /Math\.floor\(Date\.now\(\) \/ 60_000\) \* 60_000/u);
  assert.match(page, /<SeasonTabLabel>/u);
});

test("the game page says results wait for the published episode", () => {
  assert.match(
    gamePage,
    /update when each episode is\s+published, not when it is recorded/u
  );
});
