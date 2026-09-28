import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchMutation:
    vi.fn<(reference: unknown, args: unknown) => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/convex/client", () => ({
  fetchMutationForSignedInUser: mocks.fetchMutation,
}));
vi.mock("@tonyisup/bbpc-convex-api", () => ({
  api: {
    games: {
      quotes: {
        reserveQuoteLocate: "reserveQuoteLocate",
        reserveVideoSearch: "reserveVideoSearch",
      },
    },
  },
}));

import { BBPC_API_VERSION } from "@tonyisup/bbpc-convex-api/contracts";
import { retryAfterSeconds, retryWait } from "@/server/budget";
import { reserveQuoteLocate, reserveVideoSearch } from "@/server/convex/quotes";

const NOW = Date.UTC(2026, 8, 28, 20);

beforeEach(() => {
  mocks.fetchMutation.mockReset();
});
afterEach(() => vi.useRealTimers());

test("each Quote Finder budget spends from its own mutation", async () => {
  mocks.fetchMutation.mockResolvedValue({ ok: true });
  await expect(reserveQuoteLocate("test-server-key")).resolves.toEqual({
    ok: true,
  });
  await expect(reserveVideoSearch()).resolves.toEqual({ ok: true });
  expect(mocks.fetchMutation.mock.calls).toEqual([
    [
      "reserveQuoteLocate",
      { clientApiVersion: BBPC_API_VERSION, serverKey: "test-server-key" },
    ],
    ["reserveVideoSearch", { clientApiVersion: BBPC_API_VERSION }],
  ]);
});

test("passes refusals through, reads signed-out as null and rejects unexpected replies", async () => {
  const refusal = { ok: false, scope: "site", retryAt: NOW };
  mocks.fetchMutation.mockResolvedValueOnce(refusal);
  await expect(reserveQuoteLocate("test-server-key")).resolves.toEqual(refusal);
  mocks.fetchMutation.mockResolvedValueOnce(null);
  await expect(reserveQuoteLocate("test-server-key")).resolves.toBeNull();
  // A reply the web app doesn't understand must never read as permission.
  mocks.fetchMutation.mockResolvedValueOnce({
    ok: false,
    scope: "everyone",
    retryAt: NOW,
  });
  await expect(reserveQuoteLocate("test-server-key")).rejects.toThrow();
  mocks.fetchMutation.mockResolvedValueOnce({ ok: "yes" });
  await expect(reserveVideoSearch()).rejects.toThrow();
});

test("says how long a spent budget takes to refill, never less than a minute", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const wait = (ms: number) => [
    retryWait(NOW + ms),
    retryAfterSeconds(NOW + ms),
  ];
  expect(wait(-5000)).toEqual(["1 minute", "1"]);
  expect(wait(30_000)).toEqual(["1 minute", "30"]);
  expect(wait(60_001)).toEqual(["2 minutes", "61"]);
  expect(wait(59 * 60_000)).toEqual(["59 minutes", "3540"]);
  expect(wait(60 * 60_000)).toEqual(["1 hour", "3600"]);
  expect(wait(90 * 60_000)).toEqual(["2 hours", "5400"]);
});
