/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const USER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|catalog-external",
  issuer: "https://issuer.example.test",
  subject: "catalog-external",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;

async function seedUser(t: TestBackend): Promise<void> {
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: "Catalog External User",
      email: "catalog-external@example.test",
      normalizedEmail: "catalog-external@example.test",
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...USER_IDENTITY,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
  });
}

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
  expected?: {
    retryable?: boolean;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({
      code: expectedCode,
      ...(expected?.retryable === undefined
        ? {}
        : { retryable: expected.retryable }),
      ...(expected?.details === undefined
        ? {}
        : { details: expected.details }),
    });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

function jsonResponse(
  payload: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  return typeof input === "string"
    ? new URL(input)
    : new URL(input.url);
}

function validMovie(
  id: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    title: `Movie ${String(id)}`,
    backdrop_path: `/backdrop-${String(id)}.jpg`,
    poster_path: `/poster-${String(id)}.jpg`,
    overview: "Overview",
    release_date: "2026-07-24",
    vote_average: 8.5,
    vote_count: 100,
    popularity: 50,
    media_type: "movie",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("TMDB_API_KEY", "test-tmdb-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authenticated TMDB catalog actions", () => {
  test("requires a linked identity but not application write state", async () => {
    const t = createTestBackend();
    await seedUser(t);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ page: 1, results: [validMovie(1)] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expectDomainError(
      t.action(api.catalog.external.searchMovies, {
        query: "movie",
        page: 1,
      }),
      "AUTHENTICATION_REQUIRED",
    );
    await expect(
      t.withIdentity(USER_IDENTITY).action(
        api.catalog.external.searchMovies,
        { query: "   ", page: 1 },
      ),
    ).resolves.toEqual({ page: 0, results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      t.withIdentity(USER_IDENTITY).action(
        api.catalog.external.searchMovies,
        { query: "movie" },
      ),
    ).resolves.toMatchObject({
      page: 1,
      results: [{ id: 1, title: "Movie 1" }],
    });
  });

  test("maps and bounds movie search responses without exposing the API key", async () => {
    const t = createTestBackend();
    await seedUser(t);
    const requestEvidence: {
      pathname?: string;
      query?: string | null;
      page?: string | null;
      hasSignal?: boolean;
      accept?: string | null;
    } = {};
    const results = Array.from({ length: 21 }, (_, index) =>
      validMovie(index + 1),
    );
    results[0] = validMovie(1, {
      poster_path: "https://cdn.example.test/poster.jpg",
      backdrop_path: null,
      overview: undefined,
      vote_average: Number.NaN,
      vote_count: undefined,
      popularity: undefined,
      media_type: undefined,
      first_air_date: "legacy-date",
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        requestEvidence.pathname = url.pathname;
        requestEvidence.query = url.searchParams.get("query");
        requestEvidence.page = url.searchParams.get("page");
        requestEvidence.hasSignal = init?.signal !== undefined;
        requestEvidence.accept = new Headers(
          init?.headers,
        ).get("accept");
        return jsonResponse({ page: 3, results });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await t.withIdentity(USER_IDENTITY).action(
      api.catalog.external.searchMovies,
      { query: "  Ａｒｒｉｖａｌ  ", page: 3 },
    );
    expect(response.page).toBe(3);
    expect(response.results).toHaveLength(20);
    expect(response.results[0]).toEqual({
      id: 1,
      title: "Movie 1",
      backdrop_path: null,
      poster_path: "https://cdn.example.test/poster.jpg",
      overview: "",
      release_date: "2026-07-24",
      first_air_date: "legacy-date",
      vote_average: 0,
      vote_count: 0,
      popularity: 0,
      media_type: "movie",
      imdb_id: null,
      imdb_path: null,
    });
    expect(response.results[1]?.poster_path).toBe(
      "https://image.tmdb.org/t/p/w342/poster-2.jpg",
    );
    expect(requestEvidence).toEqual({
      pathname: "/3/search/movie",
      query: "Arrival",
      page: "3",
      hasSignal: true,
      accept: "application/json",
    });
  });

  test("maps show search fields and falls back to the requested page", async () => {
    const t = createTestBackend();
    await seedUser(t);
    let pathname = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        pathname = requestUrl(input).pathname;
        return jsonResponse({
          page: "invalid",
          results: [
            {
              id: 2,
              name: "Severance",
              first_air_date: "2022-02-18",
              poster_path: "/severance.jpg",
              backdrop_path:
                "https://cdn.example.test/severance-backdrop.jpg",
              external_ids: { imdb_id: "tt11280740" },
            },
          ],
        });
      }),
    );

    const response = await t.withIdentity(USER_IDENTITY).action(
      api.catalog.external.searchShows,
      { query: "severance" },
    );
    expect(pathname).toBe("/3/search/tv");
    expect(response).toEqual({
      page: 1,
      results: [
        {
          id: 2,
          title: "Severance",
          backdrop_path:
            "https://cdn.example.test/severance-backdrop.jpg",
          poster_path:
            "https://image.tmdb.org/t/p/w342/severance.jpg",
          overview: "",
          release_date: "2022-02-18",
          first_air_date: "2022-02-18",
          vote_average: 0,
          vote_count: 0,
          popularity: 0,
          media_type: "tv",
          imdb_id: "tt11280740",
          imdb_path:
            "https://www.imdb.com/title/tt11280740",
        },
      ],
    });
  });

  test("maps movie and show detail responses including IMDB links", async () => {
    const t = createTestBackend();
    await seedUser(t);
    const requestEvidence: Array<{
      pathname: string;
      append: string | null;
    }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requestEvidence.push({
          pathname: url.pathname,
          append: url.searchParams.get("append_to_response"),
        });
        return url.pathname.includes("/movie/")
          ? jsonResponse(
              validMovie(10, {
                imdb_id: "tt2543164",
                first_air_date: null,
              }),
            )
          : jsonResponse({
              id: 20,
              name: "Twin Peaks",
              first_air_date: "1990-04-08",
              poster_path: null,
              backdrop_path: null,
            });
      }),
    );

    const movie = await t.withIdentity(USER_IDENTITY).action(
      api.catalog.external.getMovie,
      { id: 10 },
    );
    const show = await t.withIdentity(USER_IDENTITY).action(
      api.catalog.external.getShow,
      { id: 20 },
    );
    expect(movie.imdb_path).toBe(
      "https://www.imdb.com/title/tt2543164",
    );
    expect(movie.first_air_date).toBeNull();
    expect(show).toMatchObject({
      title: "Twin Peaks",
      imdb_id: null,
      imdb_path: null,
    });
    expect(requestEvidence).toEqual([
      { pathname: "/3/movie/10", append: null },
      {
        pathname: "/3/tv/20",
        append: "external_ids",
      },
    ]);
  });

  test("validates search and detail bounds before making requests", async () => {
    const t = createTestBackend();
    await seedUser(t);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const input of [
      { query: "x".repeat(201), page: 1 },
      { query: "movie", page: 0 },
      { query: "movie", page: 1.5 },
      { query: "movie", page: 501 },
    ]) {
      await expectDomainError(
        t.withIdentity(USER_IDENTITY).action(
          api.catalog.external.searchMovies,
          input,
        ),
        "VALIDATION_FAILED",
      );
    }
    for (const id of [0, 1.5, 2_147_483_648]) {
      await expectDomainError(
        t.withIdentity(USER_IDENTITY).action(
          api.catalog.external.getMovie,
          { id },
        ),
        "VALIDATION_FAILED",
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fails safely when TMDB configuration or transport is unavailable", async () => {
    const t = createTestBackend();
    await seedUser(t);
    vi.stubEnv("TMDB_API_KEY", " ");
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).action(
        api.catalog.external.searchMovies,
        { query: "movie", page: 1 },
      ),
      "SERVICE_UNAVAILABLE",
      { retryable: false },
    );

    vi.stubEnv("TMDB_API_KEY", "test-tmdb-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    );
    await expectDomainError(
      t.withIdentity(USER_IDENTITY).action(
        api.catalog.external.searchMovies,
        { query: "movie", page: 1 },
      ),
      "SERVICE_UNAVAILABLE",
      { retryable: true },
    );
  });

  test("maps upstream HTTP failures to bounded domain errors", async () => {
    const t = createTestBackend();
    await seedUser(t);

    for (const [status, code, retryable] of [
      [404, "NOT_FOUND", false],
      [400, "SERVICE_UNAVAILABLE", false],
      [429, "SERVICE_UNAVAILABLE", true],
      [500, "SERVICE_UNAVAILABLE", true],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({}, status)),
      );
      await expectDomainError(
        t.withIdentity(USER_IDENTITY).action(
          api.catalog.external.getMovie,
          { id: 1 },
        ),
        code,
        {
          retryable,
          ...(status === 404
            ? {}
            : { details: { upstreamStatus: status } }),
        },
      );
    }
  });

  test("rejects malformed JSON and TMDB error envelopes", async () => {
    const t = createTestBackend();
    await seedUser(t);
    const responses = [
      new Response("{", { status: 200 }),
      jsonResponse({ success: false }),
      jsonResponse({ status_code: 7 }),
    ];

    for (const response of responses) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response.clone()),
      );
      await expectDomainError(
        t.withIdentity(USER_IDENTITY).action(
          api.catalog.external.getMovie,
          { id: 1 },
        ),
        "SERVICE_UNAVAILABLE",
      );
    }
  });

  test("rejects malformed search envelopes and title records", async () => {
    const t = createTestBackend();
    await seedUser(t);
    const payloads = [
      null,
      { results: "invalid" },
      { results: [null] },
      { results: [{ id: 1, title: " " }] },
      { results: [{ id: "invalid", title: "Movie" }] },
    ];

    for (const payload of payloads) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(payload)),
      );
      await expectDomainError(
        t.withIdentity(USER_IDENTITY).action(
          api.catalog.external.searchMovies,
          { query: "movie", page: 1 },
        ),
        "SERVICE_UNAVAILABLE",
        { retryable: true },
      );
    }
  });
});
