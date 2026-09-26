import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  env: { YOUTUBE_API_KEY: undefined as string | undefined },
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/env.mjs", () => ({ env: mocks.env }));
import { GET } from "@/app/api/youtube/search/route";

const fetchMock = vi.fn();
const request = (query: string, token?: string) =>
  ({
    nextUrl: new URL(
      `http://localhost/api/youtube/search?${new URLSearchParams({
        q: query,
        ...(token === undefined ? {} : { pageToken: token }),
      })}`
    ),
  } as NextRequest);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  mocks.auth.mockResolvedValue({ userId: "signed-in-listener" });
  mocks.env.YOUTUBE_API_KEY = "test-server-key";
});
afterEach(() => vi.unstubAllGlobals());

test("requires sign-in and valid input before spending search quota", async () => {
  mocks.auth.mockResolvedValueOnce({ userId: null });
  expect((await GET(request("movie quote"))).status).toBe(401);
  for (const query of [" ", "a", "x".repeat(201)])
    expect((await GET(request(query))).status).toBe(400);
  expect((await GET(request("movie", "x".repeat(513)))).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("returns embeddable video results and keeps the key on the server", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [
          {
            id: { videoId: "abcdefghijk" },
            snippet: {
              title: "Rock &amp; Roll &#39;scene&#39;",
              channelTitle: "Movie &amp; TV",
            },
          },
        ],
        nextPageToken: "next-token",
      })
    )
  );
  const response = await GET(request("  a   movie quote ", "page-2"));
  const [url, options] = fetchMock.mock.calls[0] ?? [];
  expect(url.origin).toBe("https://www.googleapis.com");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    key: "test-server-key",
    type: "video",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    maxResults: "6",
    q: "a movie quote",
    pageToken: "page-2",
  });
  expect(options).toMatchObject({
    cache: "force-cache",
    next: { revalidate: 300 },
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body).toEqual({
    videos: [
      {
        id: "abcdefghijk",
        title: "Rock & Roll 'scene'",
        channel: "Movie & TV",
      },
    ],
    nextPageToken: "next-token",
  });
  expect(JSON.stringify(body)).not.toContain("test-server-key");
});

test("missing configuration, quota failures and malformed responses are unavailable, never empty results", async () => {
  mocks.env.YOUTUBE_API_KEY = undefined;
  expect((await GET(request("movie quote"))).status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
  mocks.env.YOUTUBE_API_KEY = "test-server-key";
  fetchMock.mockResolvedValueOnce(
    new Response("test-server-key quota exceeded", { status: 403 })
  );
  fetchMock.mockRejectedValueOnce(new Error("Private key: test-server-key"));
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ items: [{ id: { videoId: "bad" } }] }))
  );
  for (let i = 0; i < 3; i += 1) {
    const response = await GET(request("movie quote"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain("unavailable");
    expect(JSON.stringify(body)).not.toContain("test-server-key");
    expect(body.videos).toBeUndefined();
  }
});

test("distinguishes a successful empty search", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ items: [] })));
  const response = await GET(request("unusual scene"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ videos: [], nextPageToken: null });
});
