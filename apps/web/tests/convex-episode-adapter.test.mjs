import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [
  client,
  episodes,
  episodeTypes,
  nextPage,
  episodesPage,
  sitemap,
  episodeDetailPage,
  episodeResults,
  homePage,
  historyPage,
  historyClient,
  gambling,
  middleware,
  nextEpisodeApi,
] = await Promise.all([
  read("src/server/convex/client.ts"),
  read("src/server/convex/episodes.ts"),
  read("src/types/episode.ts"),
  read("src/app/next/page.tsx"),
  read("src/app/episodes/page.tsx"),
  read("src/app/sitemap.ts"),
  read("src/app/episodes/[slug]/page.tsx"),
  read("src/components/EpisodeResults.tsx"),
  read("src/app/page.tsx"),
  read("src/app/history/page.tsx"),
  read("src/app/history/HistoryPageClient.tsx"),
  read("src/server/convex/gambling.ts"),
  read("src/middleware.ts"),
  read("src/app/api/episode/next/route.ts"),
]);

test("anonymous episode reads use the fail-closed Convex adapter", () => {
  assert.match(client, /import "server-only"/u);
  assert.match(client, /return env\.NEXT_PUBLIC_CONVEX_URL/u);
  for (const name of [
    "episodes/public:nextScheduled",
    "episodes/public:search",
    "episodes/public:listPage",
    "episodes/public:getByLegacyId",
    "episodes/public:getBySlug",
    "episodes/public:results",
  ]) {
    assert.match(episodes, new RegExp(name.replace("/", "\\/"), "u"));
  }
  assert.match(episodes, /episodeSchema\.nullable\(\)\.parse/u);
  assert.match(episodes, /HISTORY_EPISODE_LIMIT = 1_000/u);
  assert.match(episodes, /pagination did not advance/u);

  assert.match(nextPage, /getNextScheduledEpisode\(\)/u);
  assert.match(episodesPage, /listEpisodeHistory\(\)/u);
  assert.match(historyPage, /listEpisodeHistory\(\)/u);
  assert.match(sitemap, /listEpisodeHistory\(\)/u);
  assert.match(episodeDetailPage, /getEpisodeResults\(episode\.id\)/u);
  assert.match(homePage, /getLatestPublishedEpisode/u);
  assert.match(homePage, /hasSignedInUserWonForEpisode/u);
  assert.match(homePage, /<Episode episode=\{nextEpisode\} allowGuesses/u);
  assert.match(nextEpisodeApi, /getNextScheduledEpisode\(\)/u);

  for (const surface of [
    nextPage,
    episodesPage,
    historyPage,
    sitemap,
    episodeDetailPage,
    homePage,
    nextEpisodeApi,
  ]) {
    assert.doesNotMatch(
      surface,
      /BBPC_BACKEND|server\/db|server\/api\/trpc|server\/sql|next-auth|prisma/u
    );
  }
  assert.doesNotMatch(historyClient, /trpc|next-auth|@prisma|server\/db/u);
  assert.doesNotMatch(episodeResults, /\bany\b/u);
  assert.match(episodeResults, /results: EpisodeResultsData/u);
});

test("authenticated Convex reads use Clerk tokens and fail closed", () => {
  assert.match(gambling, /games\/gambling:hasWonForEpisode/u);
  assert.match(
    gambling,
    /AUTHENTICATION_REQUIRED[\s\S]*IDENTITY_NOT_LINKED[\s\S]*IDENTITY_CONFLICT[\s\S]*ACCOUNT_DISABLED[\s\S]*return false/u
  );
  assert.match(client, /auth\(\)/u);
  assert.match(client, /getToken\(\{ template: "convex" \}\)/u);
  assert.match(client, /isClerkAPIResponseError\(error\)/u);
  assert.match(
    client,
    /setTimeout\(resolve, 250\)[\s\S]*setTimeout\(resolve, 500\)/u
  );
});

test("Clerk middleware matches routes before Next.js locale rewriting", () => {
  assert.match(middleware, /clerkMiddleware/u);
  assert.equal(middleware.match(/locale: false/gu)?.length, 3);
});

test("the public episode presentation contract is storage-neutral", () => {
  assert.doesNotMatch(episodeTypes, /@prisma\/client/u);
  assert.match(episodeTypes, /date: Date \| string \| null/u);
  assert.match(episodeTypes, /only fields used by public episode surfaces/u);
});
