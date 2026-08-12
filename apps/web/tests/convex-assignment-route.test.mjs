import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [route, page, game, adapter] = await Promise.all([
  read("src/app/assignment/[slug]/page.tsx"),
  read("src/app/assignment/[slug]/ConvexAssignmentPage.tsx"),
  read("src/app/assignment/[slug]/ConvexAssignmentGameSegment.tsx"),
  read("src/server/convex/assignments.ts"),
]);

test("the assignment route uses only the Convex controller", () => {
  assert.match(route, /import \{ ConvexAssignmentPage \}/u);
  assert.match(route, /<ConvexAssignmentPage slug=\{slug\}/u);
  assert.doesNotMatch(
    route,
    /SqlAssignmentPage|GameSegment|resolveAssignmentRouteParam|server\/db|server\/auth/u
  );
});

test("Convex assignment resolution is public, normalized, and runtime validated", () => {
  assert.match(adapter, /assignments\/public:getBySlug/u);
  assert.match(adapter, /assignments\/public:getByLegacyId/u);
  assert.match(adapter, /assignmentSchema[\s\S]*\.nullable\(\)[\s\S]*\.parse/u);
  assert.match(page, /getAssignmentBySlug\(slug\)/u);
  assert.match(page, /isUuid\(slug\)[\s\S]*getAssignmentByLegacyId\(slug\)/u);
  assert.match(page, /permanentRedirect/u);
  assert.doesNotMatch(page, /server\/db|server\/auth|next-auth|trpc|prisma/u);
});

test("the assignment game reuses owner-derived Convex participation", () => {
  assert.match(game, /accountStatus !== "ready"/u);
  assert.match(game, /user\.appUserId === null/u);
  assert.match(game, /<ConvexPredictionGame/u);
  assert.match(game, /playable: assignment\.playable/u);
  assert.match(game, /episodeStatus=\{assignment\.episode\.status \?\? ""\}/u);
  assert.doesNotMatch(game, /next-auth|trpc|prisma|server\/db|userId/u);
});
