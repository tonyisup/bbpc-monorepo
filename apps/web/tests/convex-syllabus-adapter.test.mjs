import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [route, page, manager, adapter] = await Promise.all([
  read("src/app/syllabus/page.tsx"),
  read("src/app/syllabus/ConvexSyllabusPage.tsx"),
  read("src/app/syllabus/ConvexSyllabusManager.tsx"),
  read("src/convex/syllabus.ts"),
]);

test("the protected syllabus route uses only Convex", () => {
  assert.match(route, /import \{ ConvexSyllabusPage \}/u);
  assert.match(route, /<ConvexSyllabusPage \/>/u);
  assert.doesNotMatch(route, /SqlSyllabusPage|server\/auth|server\/db/u);
  assert.doesNotMatch(page, /next-auth|server\/db|prisma|trpc/u);
  assert.match(page, /accountStatus !== "ready"/u);
  assert.match(page, /user\.appUserId === null/u);
});

test("Convex syllabus reads and writes derive the owner from authentication", () => {
  for (const name of [
    "syllabus/mine:list",
    "syllabus/mine:add",
    "syllabus/mine:remove",
    "syllabus/mine:reorderPending",
    "syllabus/mine:updateNotes",
  ]) {
    assert.match(adapter, new RegExp(name.replace("/", "\\/"), "u"));
  }
  assert.doesNotMatch(adapter, /userId/u);
  assert.match(adapter, /BBPC_CLIENT_API_VERSION/u);
  assert.match(adapter, /syllabusEntrySchema\.parse/u);
  assert.match(manager, /reorderedPending\.map\(\(entry\) => entry\.id\)/u);
  assert.doesNotMatch(manager, /api\.syllabus|trpc|router\.refresh/u);
});

test("movie search keeps the migrated catalog usable when TMDB is unavailable", () => {
  assert.match(adapter, /catalog\/public:searchMovies/u);
  assert.match(adapter, /catalog\/external:searchMovies/u);
  assert.match(adapter, /catalog\/write:upsertMovieByUrl/u);
  assert.match(manager, /Promise\.allSettled/u);
  assert.match(manager, /External movie search is unavailable/u);
  assert.match(
    manager,
    /catalogResult\.status === "fulfilled"[\s\S]*tmdbResult\.status === "fulfilled"/u
  );
});
