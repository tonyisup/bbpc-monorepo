import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  env: {
    YOUTUBE_API_KEY: undefined as string | undefined,
    GEMINI_API_KEY: undefined as string | undefined,
  },
  reserve: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/env.mjs", () => ({ env: mocks.env }));
vi.mock("@/server/convex/quotes", () => ({
  reserveQuoteLocate: mocks.reserve,
}));
import { GET, POST } from "@/app/api/quote-finder/locate/route";

const SHORT = "aaaaaaaaaaa";
const LONG = "bbbbbbbbbbb";
const PRIVATE = "ccccccccccc";
const NEXT = "ddddddddddd";
const AGE = "eeeeeeeeeee";
const LAST = "fffffffffff";

const fetchMock = vi.fn();
const input = {
  quoteText: "You talkin' to me?",
  sourceTitle: "Taxi Driver",
  sourceType: "MOVIE",
  videoIds: [LONG, PRIVATE, SHORT, AGE, NEXT, LAST],
};
const request = (body: unknown) =>
  new Request("http://localhost/api/quote-finder/locate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;

const video = (
  id: string,
  duration: string,
  status: Record<string, unknown> = {},
  rating?: string
) => ({
  id,
  snippet: { title: `Scene ${id}` },
  contentDetails: {
    duration,
    ...(rating ? { contentRating: { ytRating: rating } } : {}),
  },
  status: { privacyStatus: "public", embeddable: true, ...status },
});
const detailsResponse = () =>
  new Response(
    JSON.stringify({
      items: [
        video(LONG, "PT3M1S"),
        video(PRIVATE, "PT40S", { privacyStatus: "unlisted" }),
        video(SHORT, "PT1M30S"),
        video(AGE, "PT50S", {}, "ytAgeRestricted"),
        video(NEXT, "PT2M"),
        video(LAST, "PT20S", { embeddable: false }),
      ],
    })
  );
const answer = (value: Record<string, unknown>) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: JSON.stringify(value) }] },
          finishReason: "STOP",
        },
      ],
    })
  );
const heard = {
  found: true,
  spokenText: "You talkin' to me?",
  start: "1:05.2",
  end: "1:07",
  confidence: "high",
};

/** Answers videos.list with the fixture and Gemini with `gemini`. */
function provider(gemini: () => Promise<Response> | Response) {
  fetchMock.mockImplementation((url: URL | string) =>
    String(url).startsWith("https://www.googleapis.com/youtube/v3/videos")
      ? Promise.resolve(detailsResponse())
      : gemini()
  );
}
const geminiCalls = () =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("https://generativelanguage.googleapis.com")
  );

const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
const runs = vi.spyOn(console, "info").mockImplementation(() => undefined);

beforeEach(() => {
  logged.mockClear();
  runs.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  mocks.auth.mockResolvedValue({ userId: "signed-in-listener" });
  mocks.env.YOUTUBE_API_KEY = "test-youtube-key";
  mocks.env.GEMINI_API_KEY = "test-gemini-key";
  mocks.reserve.mockReset();
  mocks.reserve.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());

test("offers the assistant only to signed-in listeners when both keys are set", async () => {
  expect(await (await GET()).json()).toEqual({ available: true });
  mocks.env.GEMINI_API_KEY = undefined;
  expect(await (await GET()).json()).toEqual({ available: false });
  mocks.env.GEMINI_API_KEY = "test-gemini-key";
  mocks.env.YOUTUBE_API_KEY = undefined;
  expect(await (await GET()).json()).toEqual({ available: false });
  mocks.env.YOUTUBE_API_KEY = "test-youtube-key";
  // Only a signed-in answer is definite; the finder asks again otherwise.
  mocks.auth.mockResolvedValueOnce({ userId: null });
  const signedOut = await GET();
  expect(signedOut.status).toBe(401);
  expect(await signedOut.json()).toEqual({ available: false });
  mocks.auth.mockRejectedValueOnce(new Error("Clerk down"));
  const failed = await GET();
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ available: false });
  expect(failed.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("refuses posts that aren't JSON before doing anything", async () => {
  mocks.auth.mockClear();
  for (const type of [
    undefined,
    "text/plain",
    "application/x-www-form-urlencoded",
  ]) {
    const response = await POST(
      new Request("http://localhost/api/quote-finder/locate", {
        method: "POST",
        headers: type ? { "Content-Type": type } : {},
        body: new Blob([JSON.stringify(input)]),
      }) as unknown as NextRequest
    );
    expect(response.status).toBe(415);
  }
  expect(mocks.auth).not.toHaveBeenCalled();
  const typed = await POST(
    new Request("http://localhost/api/quote-finder/locate", {
      method: "POST",
      headers: { "Content-Type": "Application/JSON; charset=utf-8" },
      body: "not json",
    }) as unknown as NextRequest
  );
  expect(typed.status).toBe(400);
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("requires sign-in, valid input and both keys before spending a run", async () => {
  mocks.auth.mockResolvedValueOnce({ userId: null });
  expect((await POST(request(input))).status).toBe(401);
  for (const body of [
    "not json",
    { ...input, quoteText: "   " },
    { ...input, sourceTitle: "" },
    { ...input, sourceType: "PODCAST" },
    { ...input, videoIds: [] },
    { ...input, videoIds: ["short"] },
    { ...input, videoIds: [...input.videoIds, SHORT] },
    { ...input, quoteText: "x".repeat(2001) },
  ])
    expect((await POST(request(body))).status).toBe(400);
  mocks.env.GEMINI_API_KEY = undefined;
  const unconfigured = await POST(request(input));
  expect(unconfigured.status).toBe(503);
  expect(await unconfigured.json()).toMatchObject({ disabled: true });
  expect(mocks.reserve).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("refuses once a budget is spent and fails closed when it can't be checked", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 8, 28, 20));
  try {
    mocks.reserve.mockResolvedValueOnce({
      ok: false,
      scope: "user",
      retryAt: Date.now() + 12 * 60 * 60_000,
    });
    const mine = await POST(request(input));
    expect(mine.status).toBe(429);
    expect(mine.headers.get("Retry-After")).toBe("43200");
    expect(await mine.json()).toEqual({
      error:
        "You've used your assistant runs for now. Try again in 12 hours, or search and pick a clip yourself.",
      disabled: true,
    });
    mocks.reserve.mockResolvedValueOnce({
      ok: false,
      scope: "site",
      retryAt: Date.now() + 5 * 60_000,
    });
    expect((await (await POST(request(input))).json()).error).toBe(
      "The assistant has hit its limit for now. Try again in 5 minutes, or search and pick a clip yourself."
    );
  } finally {
    vi.useRealTimers();
  }
  mocks.reserve.mockResolvedValueOnce(null);
  expect((await POST(request(input))).status).toBe(401);
  // An older backend without the budget: retrying won't help.
  mocks.reserve.mockRejectedValueOnce(
    new Error(
      "[CONVEX M(games/quotes:reserveQuoteLocate)] Server Error Could not find public function for 'games/quotes:reserveQuoteLocate'"
    )
  );
  const older = await POST(request(input));
  expect(older.status).toBe(503);
  expect(await older.json()).toMatchObject({ disabled: true });
  // A network blip reaching Convex can pass.
  mocks.reserve.mockRejectedValueOnce(new TypeError("fetch failed"));
  const blip = await POST(request(input));
  expect(blip.status).toBe(503);
  expect((await blip.json()).disabled).toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("checks the best short public video and returns a padded range", async () => {
  provider(() => answer(heard));
  const response = await POST(request(input));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json();
  expect(body).toEqual({
    status: "found",
    video: { id: SHORT, title: `Scene ${SHORT}` },
    start: 64.7,
    end: 67.75,
    spokenText: "You talkin' to me?",
    match: "likely",
    remaining: [NEXT],
  });

  // One videos.list call covers every candidate, with the key in a header.
  const [detailsUrl, detailsOptions] = fetchMock.mock.calls[0] ?? [];
  expect(new URL(detailsUrl).searchParams.get("id")).toBe(
    input.videoIds.join(",")
  );
  expect(String(detailsUrl)).not.toContain("test-youtube-key");
  expect(detailsOptions.headers).toEqual({
    "X-Goog-Api-Key": "test-youtube-key",
  });

  // Gemini hears only the chosen video, as a bare watch link.
  expect(geminiCalls()).toHaveLength(1);
  const [geminiUrl, geminiOptions] = geminiCalls()[0] ?? [];
  expect(String(geminiUrl)).not.toContain("test-gemini-key");
  expect(geminiOptions.headers["x-goog-api-key"]).toBe("test-gemini-key");
  expect(geminiOptions.signal).toBeInstanceOf(AbortSignal);
  const sent = JSON.parse(geminiOptions.body);
  expect(sent.contents[0].parts[0].fileData.fileUri).toBe(
    `https://www.youtube.com/watch?v=${SHORT}`
  );
  expect(sent.contents[0].parts[1].text).toContain("The video is 1:30 long.");
  expect(JSON.stringify(body)).not.toContain("test-");
});

test("calls a found line possible when the wording differs or the model is unsure", async () => {
  provider(() =>
    answer({ ...heard, spokenText: "Are you looking at me, pal?" })
  );
  expect(await (await POST(request(input))).json()).toMatchObject({
    status: "found",
    match: "possible",
  });
  provider(() => answer({ ...heard, confidence: "medium" }));
  expect(await (await POST(request(input))).json()).toMatchObject({
    status: "found",
    match: "possible",
  });
});

test("reports a miss with the videos left to try", async () => {
  const missed = (reason: string) => ({
    status: "not_found",
    video: { id: SHORT, title: `Scene ${SHORT}` },
    reason,
    remaining: [NEXT],
  });
  provider(() =>
    answer({
      found: false,
      spokenText: "",
      start: "",
      end: "",
      confidence: "low",
    })
  );
  expect(await (await POST(request(input))).json()).toEqual(
    missed("not_heard")
  );
  // An answer outside the video is not a suggestion.
  provider(() => answer({ ...heard, start: "4:00", end: "4:02" }));
  expect(await (await POST(request(input))).json()).toEqual(
    missed("unreadable")
  );
  provider(
    () =>
      new Response(JSON.stringify({ error: { message: "Cannot fetch" } }), {
        status: 400,
      })
  );
  expect(await (await POST(request(input))).json()).toEqual(
    missed("unreadable")
  );
  provider(() =>
    Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))
  );
  expect(await (await POST(request(input))).json()).toEqual(missed("timeout"));
});

test("spends a run but asks nothing of Gemini when no video fits", async () => {
  provider(() => answer(heard));
  const response = await POST(
    request({ ...input, videoIds: [LONG, PRIVATE, AGE, LAST, "zzzzzzzzzzz"] })
  );
  expect(await response.json()).toEqual({
    status: "not_found",
    video: null,
    reason: "no_candidates",
    remaining: [],
  });
  expect(mocks.reserve).toHaveBeenCalledOnce();
  expect(geminiCalls()).toHaveLength(0);
});

test("an empty prepaid balance disables the assistant; other provider failures stay hidden", async () => {
  provider(
    () =>
      new Response(JSON.stringify({ error: { message: "Billing" } }), {
        status: 402,
      })
  );
  const broke = await POST(request(input));
  expect(broke.status).toBe(503);
  expect(await broke.json()).toEqual({
    error:
      "The assistant has used its budget for now. You can still search and pick a clip yourself.",
    disabled: true,
  });

  provider(
    () =>
      new Response(
        JSON.stringify({ error: { message: "Key test-gemini-key is bad" } }),
        { status: 429 }
      )
  );
  const limited = await POST(request(input));
  expect(limited.status).toBe(503);
  const body = await limited.json();
  expect(body.error).toContain("unavailable");
  expect(body.disabled).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("test-gemini-key");

  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response("test-youtube-key quota exceeded", { status: 403 })
  );
  const details = await POST(request(input));
  expect(details.status).toBe(503);
  expect(JSON.stringify(await details.json())).not.toContain("test-");
});

test("a slow video lookup or a dropped connection is unavailable, not a miss", async () => {
  fetchMock.mockImplementation(() =>
    Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))
  );
  const slow = await POST(request(input));
  expect(slow.status).toBe(503);
  expect(await slow.json()).toEqual({
    error:
      "The assistant is unavailable right now. You can still search and pick a clip yourself.",
  });
  expect(geminiCalls()).toHaveLength(0);

  // The listener closed the finder mid-check; Gemini's abort isn't a timeout.
  provider(() =>
    Promise.reject(new DOMException("The operation was aborted.", "AbortError"))
  );
  const dropped = await POST(request(input));
  expect(dropped.status).toBe(503);
  expect((await dropped.json()).disabled).toBeUndefined();
});

test("a bad key, a key without access or an unsupported region disables the assistant", async () => {
  const google = (status: number, error: Record<string, unknown>) => () =>
    new Response(
      JSON.stringify({
        error: { message: "Key test-gemini-key rejected", ...error },
      }),
      { status }
    );
  for (const reply of [
    google(400, {
      status: "INVALID_ARGUMENT",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "API_KEY_INVALID",
        },
      ],
    }),
    google(400, { status: "FAILED_PRECONDITION" }),
    google(403, { status: "PERMISSION_DENIED" }),
    // A retired model name answers 404 for every run.
    google(404, { status: "NOT_FOUND" }),
  ]) {
    provider(reply);
    const response = await POST(request(input));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ disabled: true });
  }
  // A video Gemini can't fetch is still just that video.
  provider(google(400, { status: "INVALID_ARGUMENT" }));
  expect(await (await POST(request(input))).json()).toMatchObject({
    status: "not_found",
    reason: "unreadable",
  });
  // Operators see the status and reason, never the message or a key.
  expect(logged).toHaveBeenCalledWith(
    "Quote Finder assistant failed",
    expect.objectContaining({ stage: "locate", reason: "API_KEY_INVALID" })
  );
  expect(JSON.stringify(logged.mock.calls)).not.toContain("test-");
});

test("a closed finder cancels the Gemini call", async () => {
  let geminiSignal: AbortSignal | undefined;
  fetchMock.mockImplementation((url: URL | string, init: RequestInit) =>
    String(url).startsWith("https://www.googleapis.com/youtube/v3/videos")
      ? Promise.resolve(detailsResponse())
      : new Promise((_, reject) => {
          geminiSignal = init.signal ?? undefined;
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
  );
  const client = new AbortController();
  const pending = POST(
    new Request("http://localhost/api/quote-finder/locate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: client.signal,
    }) as unknown as NextRequest
  );
  await vi.waitFor(() => expect(geminiSignal).toBeDefined());
  expect(geminiSignal?.aborted).toBe(false);
  client.abort();
  expect(geminiSignal?.aborted).toBe(true);
  const response = await pending;
  expect(response.status).toBe(503);
  expect((await response.json()).disabled).toBeUndefined();
  // A cancel isn't a failure worth an operator's attention.
  expect(logged).not.toHaveBeenCalled();
});

test("a closed finder also cancels the video lookup", async () => {
  let detailsSignal: AbortSignal | undefined;
  fetchMock.mockImplementation(
    (_url: URL | string, init: RequestInit) =>
      new Promise((_, reject) => {
        detailsSignal = init.signal ?? undefined;
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason)
        );
      })
  );
  const client = new AbortController();
  const pending = POST(
    new Request("http://localhost/api/quote-finder/locate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: client.signal,
    }) as unknown as NextRequest
  );
  await vi.waitFor(() => expect(detailsSignal).toBeDefined());
  client.abort();
  expect(detailsSignal?.aborted).toBe(true);
  expect((await pending).status).toBe(503);
  expect(geminiCalls()).toHaveLength(0);
});

test("Gemini gets what is left of the route's deadline", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 8, 28, 20));
  try {
    // A slow reservation uses 20 s of the 55 s deadline.
    mocks.reserve.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.UTC(2026, 8, 28, 20, 0, 20));
      return { ok: true };
    });
    provider(() => answer(heard));
    await POST(request(input));
    expect(timeout).toHaveBeenCalledWith(8000);
    expect(timeout).toHaveBeenLastCalledWith(35_000);
    // With 8 s left, the lookup gets what remains and Gemini isn't started:
    // the run ends as "try again", not a platform kill.
    vi.setSystemTime(Date.UTC(2026, 8, 28, 20));
    mocks.reserve.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.UTC(2026, 8, 28, 20, 0, 47));
      return { ok: true };
    });
    const before = geminiCalls().length;
    expect(await (await POST(request(input))).json()).toMatchObject({
      status: "not_found",
      reason: "timeout",
    });
    expect(timeout).toHaveBeenLastCalledWith(8000);
    expect(geminiCalls()).toHaveLength(before);
    // Past the deadline, even the lookup gets no time.
    vi.setSystemTime(Date.UTC(2026, 8, 28, 20));
    mocks.reserve.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.UTC(2026, 8, 28, 20, 2));
      return { ok: true };
    });
    await POST(request(input));
    expect(timeout).toHaveBeenLastCalledWith(0);
    expect(geminiCalls()).toHaveLength(before);
  } finally {
    vi.useRealTimers();
    timeout.mockRestore();
  }
});

test("a YouTube key or quota problem disables the assistant; a YouTube outage can pass", async () => {
  // A bad key (400), a key without access (401) or a spent quota (403).
  for (const status of [400, 401, 403]) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "keyInvalid" } }), {
        status,
      })
    );
    const refused = await POST(request(input));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ disabled: true });
  }
  fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
  const outage = await POST(request(input));
  expect(outage.status).toBe(503);
  expect((await outage.json()).disabled).toBeUndefined();
});

test("a cut-off or blocked answer is logged for operators", async () => {
  provider(
    () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
        })
      )
  );
  expect(await (await POST(request(input))).json()).toMatchObject({
    status: "not_found",
    reason: "unreadable",
  });
  expect(logged).toHaveBeenCalledWith("Quote Finder assistant failed", {
    stage: "answer",
    status: "blocked",
    reason: "MAX_TOKENS",
  });
});

test("each run logs its token counts, and a 400 is logged too", async () => {
  provider(
    () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: JSON.stringify(heard) }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 8200,
            candidatesTokenCount: 120,
            thoughtsTokenCount: 310,
          },
        })
      )
  );
  await POST(request(input));
  expect(runs).toHaveBeenCalledWith("Quote Finder assistant run", {
    status: "found",
    promptTokens: 8200,
    outputTokens: 120,
    thoughtsTokens: 310,
  });
  expect(JSON.stringify(runs.mock.calls)).not.toContain("talkin");
  provider(
    () =>
      new Response(
        JSON.stringify({
          error: { message: "Cannot fetch", status: "INVALID_ARGUMENT" },
        }),
        { status: 400 }
      )
  );
  await POST(request(input));
  expect(logged).toHaveBeenCalledWith(
    "Quote Finder assistant failed",
    expect.objectContaining({
      stage: "locate",
      status: 400,
      providerStatus: "INVALID_ARGUMENT",
    })
  );
});
