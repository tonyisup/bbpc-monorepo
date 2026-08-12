import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [route, page, component, adapter, affordance] = await Promise.all([
  read("src/app/episodes/[slug]/extras/add/page.tsx"),
  read("src/app/episodes/[slug]/extras/add/ConvexAddExtraPage.tsx"),
  read("src/app/episodes/[slug]/extras/add/ConvexAddExtraPageClient.tsx"),
  read("src/convex/extras.ts"),
  read("src/components/AddExtraToNext.tsx"),
]);

test("the add-extra route uses only the Convex controller", () => {
  assert.match(route, /import \{ ConvexAddExtraPage \}/u);
  assert.match(route, /<ConvexAddExtraPage slug=\{slug\}/u);
  assert.doesNotMatch(
    route,
    /SqlAddExtraPage|AddExtraPageClient|resolveEpisodeRouteParam|server\/db|trpc/u
  );
  assert.doesNotMatch(page, /server\/db|next-auth|trpc|prisma/u);
  assert.match(page, /getEpisodeBySlug\(slug\)/u);
  assert.match(page, /getEpisodeByLegacyId\(slug\)/u);
});

test("Convex extras use owner-derived versioned mutations", () => {
  assert.match(adapter, /reviews\/mine:addMovieExtra/u);
  assert.match(adapter, /reviews\/mine:addShowExtra/u);
  assert.match(adapter, /BBPC_CLIENT_API_VERSION/u);
  assert.doesNotMatch(adapter, /userId/u);
  assert.match(adapter, /extraReviewResultSchema\.parse/u);
  assert.match(component, /accountStatus !== "ready"/u);
  assert.match(component, /user\.appUserId === null/u);
  assert.doesNotMatch(component, /next-auth|trpc|prisma|server\/db/u);
  assert.match(affordance, /user\?\.isHost === true/u);
  assert.doesNotMatch(affordance, /SqlAddExtraToNext|backend|trpc/u);
});

test("catalog search survives an unavailable external provider", () => {
  assert.match(adapter, /catalog\/public:searchMovies/u);
  assert.match(adapter, /catalog\/public:searchShows/u);
  assert.match(adapter, /catalog\/external:searchMovies/u);
  assert.match(adapter, /catalog\/external:searchShows/u);
  assert.match(adapter, /catalog\/write:upsertMovieByUrl/u);
  assert.match(adapter, /catalog\/write:upsertShowByUrl/u);
  assert.match(component, /Promise\.allSettled/u);
  assert.match(component, /External title search is unavailable/u);
});
