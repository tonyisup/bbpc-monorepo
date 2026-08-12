import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [callRoute, convexCall, gamesPage] = await Promise.all([
  read("src/app/call/page.tsx"),
  read("src/app/call/ConvexCallPage.tsx"),
  read("src/app/games/page.tsx"),
]);

test("the call route uses only the Clerk and Convex controller", () => {
  assert.match(callRoute, /import \{ ConvexCallPage \}/u);
  assert.match(callRoute, /<ConvexCallPage \/>/u);
  assert.doesNotMatch(callRoute, /SqlCallPage|server\/auth|next-auth/u);
  assert.match(convexCall, /useBbpcAuth/u);
  assert.match(convexCall, /status === "unauthenticated"/u);
  assert.doesNotMatch(convexCall, /server\/auth|next-auth|trpc|prisma/u);
});

test("the obsolete plural game route redirects to the supported game page", () => {
  assert.match(gamesPage, /permanentRedirect\("\/game"\)/u);
  assert.doesNotMatch(gamesPage, /server\/db|prisma|gameType\.findMany/u);
});
