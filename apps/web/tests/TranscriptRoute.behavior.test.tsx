import { expect, test, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("@/server/convex/episodes", () => ({
  searchEpisodeTranscripts: mocks.search,
}));
import { GET } from "@/app/api/episodes/transcripts/route";
const request = (query: string) =>
  ({
    nextUrl: new URL(
      `http://localhost/api/episodes/transcripts?q=${encodeURIComponent(query)}`
    ),
  } as NextRequest);
beforeEach(() => {
  mocks.search.mockReset();
});
test("blank or invalid queries do not reach the backend", async () => {
  expect(await (await GET(request(" "))).json()).toEqual({
    results: [],
    limited: false,
  });
  expect((await GET(request("word ".repeat(17)))).status).toBe(400);
  expect((await GET(request("a".repeat(33)))).status).toBe(400);
  expect(mocks.search).not.toHaveBeenCalled();
});
test("returns bounded search response without caching visibility", async () => {
  mocks.search.mockResolvedValue({ results: [], limited: true });
  const response = await GET(request(" jellyfish "));
  expect(mocks.search).toHaveBeenCalledWith("jellyfish");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ results: [], limited: true });
});
test("backend failures are not represented as no matches or leaked to clients", async () => {
  mocks.search.mockRejectedValue(new Error("Private backend diagnostic"));
  const response = await GET(request("jellyfish"));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    "Private backend diagnostic"
  );
});
