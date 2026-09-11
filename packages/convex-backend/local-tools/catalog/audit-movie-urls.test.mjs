import assert from "node:assert/strict";
import test from "node:test";
import { auditMovieUrls, lookupTmdbMovie } from "./audit-movie-urls.mjs";
import {
  canonicalImdbUrl,
  tmdbIdFromMovieUrl,
} from "../../convex/catalog/movieUrls.ts";

const movie = {
  _id: "a",
  title: "Arrival",
  year: 2016,
  url: "https://www.themoviedb.org/movie/329865-arrival",
};
const details = {
  id: 329865,
  title: "Arrival",
  release_date: "2016-11-11",
  imdb_id: "tt2543164",
};

test("recovers a TMDB ID, proposes IMDb, and leaves the input unchanged", async () => {
  const original = globalThis.structuredClone(movie);
  const result = await auditMovieUrls([movie], async (id) => {
    assert.equal(id, 329865);
    return details;
  });
  assert.deepEqual(movie, original);
  assert.equal(result.counts.ready, 1);
  assert.equal(result.rows[0].recoveredTmdbId, true);
  assert.equal(
    result.rows[0].proposedUrl,
    "https://www.imdb.com/title/tt2543164/"
  );
});

test("reports collisions with existing IMDb movies instead of approving an update", async () => {
  const result = await auditMovieUrls(
    [
      movie,
      { ...movie, _id: "b", url: "http://imdb.com/title/tt2543164?ref_=test" },
    ],
    async () => details
  );
  assert.equal(result.counts.ready, 0);
  assert.equal(result.counts.review, 2);
  assert.equal(result.duplicates[0].field, "imdbUrl");
});

test("reports missing mappings, failed lookups, and title/year conflicts separately", async () => {
  for (const [lookup, status, reason] of [
    [async () => null, "unresolved", "tmdb_not_found"],
    [
      async () => ({ ...details, imdb_id: null }),
      "unresolved",
      "missing_or_invalid_imdb_id",
    ],
    [
      async () => {
        throw new Error("Secret upstream error");
      },
      "unresolved",
      "tmdb_lookup_failed",
    ],
    [
      async () => ({ ...details, release_date: "2000-01-01" }),
      "review",
      "title_or_year_mismatch",
    ],
    [
      async () => ({ ...details, id: 123 }),
      "review",
      "conflicting_tmdb_response",
    ],
  ]) {
    const result = await auditMovieUrls([movie], lookup);
    assert.equal(result.rows[0].status, status);
    assert.deepEqual(result.rows[0].reasons, [reason]);
    assert.doesNotMatch(JSON.stringify(result), /Secret upstream error/);
  }
});

test("does not resolve already-IMDb or conflicting TMDB IDs", async () => {
  let calls = 0;
  const result = await auditMovieUrls(
    [
      { ...movie, url: "https://www.imdb.com/title/tt2543164/" },
      { ...movie, _id: "b", tmdbId: 123 },
      { ...movie, _id: "c", url: "https://example.test/movie" },
    ],
    async () => {
      calls += 1;
      return details;
    }
  );
  assert.equal(calls, 0);
  assert.deepEqual(result.counts, {
    already_imdb: 1,
    ready: 0,
    unresolved: 1,
    review: 1,
  });
});

test("rejects lookalike hosts, credentials, non-movie paths, and malformed IMDb IDs", () => {
  assert.equal(
    canonicalImdbUrl("https://imdb.com.evil.test/title/tt2543164/"),
    null
  );
  assert.equal(
    canonicalImdbUrl("https://user:password@imdb.com/title/tt2543164/"),
    null
  );
  assert.equal(canonicalImdbUrl("https://imdb.com/title/tt2543164bad/"), null);
  assert.equal(
    tmdbIdFromMovieUrl("https://www.themoviedb.org/tv/123"),
    undefined
  );
  assert.equal(
    tmdbIdFromMovieUrl("https://www.themoviedb.org/movie/999999999999999999"),
    undefined
  );
});

test("TMDB lookup uses the fixed provider endpoint and reports missing movies", async () => {
  const result = await lookupTmdbMovie(
    329865,
    "private-test-key",
    async (url) => {
      assert.equal(url.origin, "https://api.themoviedb.org");
      assert.equal(url.pathname, "/3/movie/329865");
      assert.equal(url.searchParams.get("api_key"), "private-test-key");
      return new globalThis.Response(null, { status: 404 });
    }
  );
  assert.equal(result, null);
});
