import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [route, component, adapter] = await Promise.all([
  read("src/app/year/page.tsx"),
  read("src/app/year/ConvexYearPageClient.tsx"),
  read("src/convex/year.ts"),
]);

test("the year route uses only the Convex controller", () => {
  assert.match(route, /import \{ ConvexYearPageClient \}/u);
  assert.match(route, /<ConvexYearPageClient \/>/u);
  assert.doesNotMatch(route, /import\("\.\/YearPageClient"\)/u);
  assert.doesNotMatch(route, /next-auth|trpc|prisma|server\/db/u);
});

test("the Convex year archive is public and runtime validated", () => {
  assert.match(adapter, /reviews\/public:listMovieReviewsForYear/u);
  assert.match(adapter, /yearReviewSchema/u);
  assert.match(adapter, /\.array\(yearReviewSchema\)[\s\S]*\.parse/u);
  assert.match(component, /listConvexYearReviews\(convex, selectedYear\)/u);
  assert.doesNotMatch(component, /next-auth|trpc|prisma|server\/db/u);
});

test("ranking controls use owner-derived versioned Convex functions", () => {
  for (const name of [
    "rankings/lists:listMine",
    "rankings/lists:get",
    "rankings/items:upsert",
    "rankings/items:remove",
    "rankings/items:reorder",
  ]) {
    assert.match(adapter, new RegExp(name.replace("/", "\\/"), "u"));
  }
  assert.doesNotMatch(adapter, /userId/u);
  assert.match(adapter, /BBPC_CLIENT_API_VERSION/u);
  assert.match(adapter, /target: \{ kind: "movie", id: input\.movieId \}/u);
  assert.match(component, /accountStatus === "ready"[\s\S]*user\.isAdmin/u);
  assert.match(component, /orderedItems\.map\(\(item\) => item\.id\)/u);
  assert.match(component, /getConvexDomainErrorCode/u);
});
