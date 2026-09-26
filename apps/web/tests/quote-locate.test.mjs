import assert from "node:assert/strict";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLocateRequest,
  fetchVideoDetails,
  LocateRequestError,
  locateQuote,
  padLocatedRange,
  parseIsoDuration,
  parseTimestamp,
  quoteCoverage,
  readLocateAnswer,
} from "../src/server/quoteLocate.mjs";
import {
  assertOutsideRepository,
  main,
  readRows,
  selectEvalRows,
  summarize,
  videoSkipReason,
  youtubeVideoId,
} from "../local-tools/quote-locate/spike.mjs";

const VIDEO_ID = "dQw4w9WgXcQ";
const LONG_VIDEO_ID = "aaaaaaaaaaa";
const heard = {
  found: true,
  spokenText: "You talkin' to me?",
  start: "1:05.2",
  end: "1:07",
  confidence: "high",
};

/**
 * @param {unknown} answer
 * @param {Record<string, unknown>} [extra]
 */
const geminiBody = (answer, extra = {}) => ({
  candidates: [
    {
      content: { parts: [{ text: JSON.stringify(answer) }] },
      finishReason: "STOP",
    },
  ],
  ...extra,
});

/**
 * @param {unknown} body
 * @param {number} [status]
 */
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** @param {RequestInfo | URL} input */
const urlOf = (input) =>
  input instanceof Request
    ? input.url
    : input instanceof URL
    ? input.href
    : input;

test("timestamps read seconds, M:SS and H:MM:SS", () => {
  assert.equal(parseTimestamp("75.5"), 75.5);
  assert.equal(parseTimestamp("1:05.2"), 65.2);
  assert.equal(parseTimestamp("01:02:03"), 3723);
  for (const value of [
    "",
    "1:60",
    "1:60:00",
    "1:2:3:4",
    "-1",
    "1:05s",
    "soon",
    "1::05",
  ])
    assert.equal(parseTimestamp(value), null, value);
});

test("YouTube durations ignore zero-length live videos", () => {
  assert.equal(parseIsoDuration("PT3M12S"), 192);
  assert.equal(parseIsoDuration("PT1H"), 3600);
  assert.equal(parseIsoDuration("P1DT1S"), 86_401);
  for (const value of ["P0D", "", "3:12", "PT"])
    assert.equal(parseIsoDuration(value), null, value);
});

test("quote coverage ignores punctuation and extra spoken words", () => {
  assert.equal(quoteCoverage("You talkin' to me?", "you talkin to me"), 1);
  assert.equal(
    quoteCoverage(
      "you talking to me",
      "Are you talking to me? You talking to me?"
    ),
    1
  );
  assert.ok(quoteCoverage("I'll be back", "Hasta la vista, baby") < 0.3);
});

test("requests send the bare watch URL and the quote as data", () => {
  const input = {
    videoId: VIDEO_ID,
    durationSeconds: 192,
    quoteText: 'Say "hello" to my little friend',
    sourceTitle: "Scarface",
    sourceType: "MOVIE",
  };
  const body = buildLocateRequest(input);
  const parts = body.contents[0]?.parts ?? [];
  assert.deepEqual(parts[0], {
    fileData: { fileUri: `https://www.youtube.com/watch?v=${VIDEO_ID}` },
  });
  const prompt = String(parts[1] && "text" in parts[1] ? parts[1].text : "");
  assert.ok(prompt.includes(JSON.stringify(input.quoteText)));
  assert.ok(prompt.includes('movie "Scarface"'));
  assert.ok(prompt.includes("3:12 long"));
  assert.equal(body.generationConfig.mediaResolution, "MEDIA_RESOLUTION_LOW");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal("thinkingConfig" in body.generationConfig, false);
  assert.deepEqual(
    buildLocateRequest({ ...input, thinkingLevel: "low" }).generationConfig
      .thinkingConfig,
    { thinkingLevel: "LOW" }
  );
  assert.throws(() => buildLocateRequest({ ...input, videoId: "watch?v=1" }));
  assert.throws(() =>
    buildLocateRequest({ ...input, mediaResolution: "ultra" })
  );
  assert.throws(() => buildLocateRequest({ ...input, thinkingLevel: "max" }));
});

test("answers must be timed lines inside the video", () => {
  const withThought = {
    candidates: [
      {
        content: {
          parts: [
            { text: "thinking about it", thought: true },
            { text: JSON.stringify(heard) },
          ],
        },
        finishReason: "STOP",
      },
    ],
  };
  assert.deepEqual(readLocateAnswer(withThought, 192), {
    status: "found",
    start: 65.2,
    end: 67,
    spokenText: "You talkin' to me?",
    confidence: "high",
  });
  assert.deepEqual(
    readLocateAnswer(
      geminiBody({
        ...heard,
        found: false,
        spokenText: "",
        start: "",
        end: "",
        confidence: "low",
      }),
      192
    ),
    { status: "not_found", confidence: "low" }
  );
  const clamped = readLocateAnswer(geminiBody(heard), 66.8);
  assert.equal(clamped.status === "found" && clamped.end, 66.8);

  /** @param {Partial<typeof heard>} change */
  const reason = (change) => {
    const result = readLocateAnswer(geminiBody({ ...heard, ...change }), 192);
    return result.status === "invalid" ? result.reason : result.status;
  };
  assert.equal(reason({ end: "1:05" }), "end not after start");
  assert.equal(reason({ start: "3:20", end: "3:21" }), "outside the video");
  assert.equal(reason({ start: "0:10", end: "1:30" }), "span too long");
  assert.equal(reason({ start: "soon" }), "unreadable timestamp");
  assert.equal(reason({ spokenText: "  " }), "no spoken text");
  assert.deepEqual(
    readLocateAnswer(
      { candidates: [{ content: { parts: [{ text: "nope" }] } }] },
      192
    ),
    { status: "invalid", reason: "not JSON" }
  );
  assert.deepEqual(
    readLocateAnswer({ promptFeedback: { blockReason: "OTHER" } }, 192),
    { status: "blocked", reason: "OTHER" }
  );
  assert.deepEqual(
    readLocateAnswer({ candidates: [{ finishReason: "RECITATION" }] }, 192),
    { status: "blocked", reason: "RECITATION" }
  );
});

test("padding widens the range without leaving the video", () => {
  assert.deepEqual(padLocatedRange(0.2, 10, 10.5), { start: 0, end: 10.5 });
  assert.deepEqual(padLocatedRange(5, 6, 100), { start: 4.5, end: 6.75 });
});

test("locateQuote keeps the key out of the URL and reports usage by modality", async (t) => {
  /** @type {Array<{ url: string; init: RequestInit | undefined }>} */
  const calls = [];
  t.mock.method(
    globalThis,
    "fetch",
    /**
     * @param {RequestInfo | URL} input
     * @param {RequestInit} [init]
     */
    async (input, init) => {
      calls.push({ url: urlOf(input), init });
      return jsonResponse(
        geminiBody(heard, {
          usageMetadata: {
            promptTokenCount: 19_000,
            candidatesTokenCount: 50,
            thoughtsTokenCount: 300,
            promptTokensDetails: [
              { modality: "VIDEO", tokenCount: 12_000 },
              { modality: "AUDIO", tokenCount: 6000 },
              { modality: "TEXT", tokenCount: 1000 },
            ],
          },
          modelVersion: "gemini-3.8-flash-001",
        })
      );
    }
  );
  const located = await locateQuote({
    apiKey: "secret-key",
    videoId: VIDEO_ID,
    durationSeconds: 192,
    quoteText: "You talking to me?",
    sourceTitle: "Taxi Driver",
    sourceType: "MOVIE",
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
  );
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("x-goog-api-key"),
    "secret-key"
  );
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(located.result.status, "found");
  assert.equal(located.modelVersion, "gemini-3.8-flash-001");
  assert.deepEqual(located.usage, {
    promptTokens: 19_000,
    videoTokens: 12_000,
    audioTokens: 6000,
    textTokens: 1000,
    outputTokens: 50,
    thoughtsTokens: 300,
  });
});

test("locateQuote reports provider errors with their status", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ error: { message: "Resource exhausted" } }, 429)
  );
  await assert.rejects(
    locateQuote({
      apiKey: "secret-key",
      videoId: VIDEO_ID,
      durationSeconds: 192,
      quoteText: "You talking to me?",
      sourceTitle: "Taxi Driver",
      sourceType: "MOVIE",
    }),
    (error) =>
      error instanceof LocateRequestError &&
      error.status === 429 &&
      error.message === "HTTP 429: Resource exhausted"
  );
});

test("video details are read 50 IDs per request", async (t) => {
  /** @type {string[]} */
  const urls = [];
  t.mock.method(
    globalThis,
    "fetch",
    /**
     * @param {RequestInfo | URL} input
     * @param {RequestInit} [init]
     */
    async (input, init) => {
      urls.push(urlOf(input));
      assert.equal(new Headers(init?.headers).get("X-Goog-Api-Key"), "yt-key");
      return jsonResponse({
        items:
          urls.length === 1
            ? [
                {
                  id: VIDEO_ID,
                  snippet: { title: "Taxi Driver - mirror scene" },
                  contentDetails: {
                    duration: "PT3M12S",
                    contentRating: { ytRating: "ytAgeRestricted" },
                  },
                  status: { privacyStatus: "public", embeddable: true },
                },
              ]
            : [],
      });
    }
  );
  const ids = [
    VIDEO_ID,
    ...Array.from(
      { length: 50 },
      (_, index) => `video${String(index).padStart(6, "0")}`
    ),
  ];
  const details = await fetchVideoDetails(ids, "yt-key");
  assert.equal(urls.length, 2);
  assert.equal(
    new URL(urls[0] ?? "").searchParams.get("id")?.split(",").length,
    50
  );
  assert.ok(!urls.some((url) => url.includes("yt-key")));
  assert.deepEqual(details.get(VIDEO_ID), {
    title: "Taxi Driver - mirror scene",
    durationSeconds: 192,
    isPublic: true,
    embeddable: true,
    ageRestricted: true,
  });
});

test("saved clip links resolve to YouTube video IDs", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${VIDEO_ID}&t=65s`,
    `https://youtu.be/${VIDEO_ID}?t=65`,
    `https://m.youtube.com/shorts/${VIDEO_ID}`,
    `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
  ])
    assert.equal(youtubeVideoId(url), VIDEO_ID, url);
  for (const url of [
    "https://vimeo.com/123",
    "https://youtube.com/watch?v=short",
    "not a url",
  ])
    assert.equal(youtubeVideoId(url), null, url);
});

test("exports read as JSON arrays or JSON Lines", () => {
  assert.deepEqual(readRows('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(readRows('{"a":1}\n\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
  assert.throws(() => readRows('{"a":1}\n{oops'), /Line 2/);
});

test("only YouTube entries with a saved start are evaluated", () => {
  const clipUrl = `https://www.youtube.com/watch?v=${VIDEO_ID}&t=65s`;
  const { eligible, skipped } = selectEvalRows([
    {
      _id: "a",
      quoteText: " Line ",
      sourceTitle: "Heat",
      sourceType: "MOVIE",
      clipUrl,
      clipStartSeconds: 65,
      clipEndSeconds: 68,
    },
    {
      _id: "b",
      quoteText: "Line",
      sourceTitle: "Heat",
      clipUrl,
      clipStartSeconds: 65,
      clipEndSeconds: 60,
    },
    {
      quoteText: "Line",
      sourceTitle: "Heat",
      clipUrl: null,
      clipStartSeconds: 65,
    },
    {
      quoteText: "Line",
      sourceTitle: "Heat",
      clipUrl: "https://vimeo.com/1",
      clipStartSeconds: 65,
    },
    { quoteText: "Line", sourceTitle: "Heat", clipUrl },
    { quoteText: " ", sourceTitle: "Heat", clipUrl, clipStartSeconds: 65 },
    { sourceTitle: "Heat" },
  ]);
  assert.deepEqual(eligible, [
    {
      id: "a",
      quoteText: "Line",
      sourceTitle: "Heat",
      sourceType: "MOVIE",
      videoId: VIDEO_ID,
      truthStart: 65,
      truthEnd: 68,
    },
    {
      id: "b",
      quoteText: "Line",
      sourceTitle: "Heat",
      sourceType: "OTHER",
      videoId: VIDEO_ID,
      truthStart: 65,
      truthEnd: null,
    },
  ]);
  assert.deepEqual(skipped, {
    "no YouTube link": 2,
    "no start time": 1,
    "no quote text": 1,
    "unreadable row": 1,
  });
});

test("videos Gemini can't read, or that run too long, are skipped", () => {
  const row = {
    id: "a",
    quoteText: "Line",
    sourceTitle: "Heat",
    sourceType: "MOVIE",
    videoId: VIDEO_ID,
    truthStart: 65,
    truthEnd: null,
  };
  const video = {
    title: "",
    durationSeconds: 192,
    isPublic: true,
    embeddable: true,
    ageRestricted: false,
  };
  assert.equal(videoSkipReason(row, video, 600), null);
  assert.equal(videoSkipReason(row, undefined, 600), "video unavailable");
  assert.equal(
    videoSkipReason(row, { ...video, isPublic: false }, 600),
    "video not public"
  );
  assert.equal(
    videoSkipReason(row, { ...video, durationSeconds: null }, 600),
    "video length unknown"
  );
  assert.equal(videoSkipReason(row, video, 120), "video too long");
  assert.equal(
    videoSkipReason({ ...row, truthStart: 200 }, video, 600),
    "saved start outside video"
  );
});

test("exports and results must stay outside the repository", () => {
  assert.throws(
    () => assertOutsideRepository("/repo/quotes.jsonl", "/repo"),
    /inside the repository/
  );
  assert.throws(
    () => assertOutsideRepository("/repo", "/repo"),
    /inside the repository/
  );
  assert.throws(
    () => assertOutsideRepository("/repo/..data/quotes.jsonl", "/repo"),
    /inside the repository/
  );
  assert.doesNotThrow(() =>
    assertOutsideRepository("/elsewhere/quotes.jsonl", "/repo")
  );
  assert.doesNotThrow(() =>
    assertOutsideRepository("/repo/../quotes.jsonl", "/repo")
  );
  assert.throws(() =>
    assertOutsideRepository(
      new URL("../package.json", import.meta.url).pathname
    )
  );
});

test("summaries score answered rows and leave request errors out", () => {
  /**
   * @param {Partial<import("../local-tools/quote-locate/spike.mjs").SpikeRecord>} change
   * @returns {import("../local-tools/quote-locate/spike.mjs").SpikeRecord}
   */
  const record = (change) => ({
    id: "row",
    videoId: VIDEO_ID,
    title: "",
    durationSeconds: 192,
    quoteText: "Line",
    sourceTitle: "Heat",
    truthStart: 65,
    truthEnd: null,
    status: "found",
    hit: false,
    latencyMs: 10_000,
    usage: {
      promptTokens: 20_000,
      videoTokens: 13_000,
      audioTokens: 6000,
      textTokens: 1000,
      outputTokens: 100,
      thoughtsTokens: 900,
    },
    ...change,
  });
  const summary = summarize(
    [
      record({ hit: true, startError: 0.5, confidence: "high" }),
      record({ hit: true, startError: -1, confidence: "high" }),
      record({
        hit: true,
        startError: 1.9,
        endError: 0.4,
        confidence: "medium",
      }),
      record({ startError: 4, confidence: "high" }),
      record({ status: "not_found" }),
      record({ status: "blocked", reason: "RECITATION" }),
      record({ status: "error", usage: undefined }),
    ],
    { inputPrice: 0.5, outputPrice: 2 }
  );
  assert.equal(summary.run, 7);
  assert.equal(summary.answered, 6);
  assert.equal(summary.found, 4);
  assert.equal(summary.hits, 3);
  assert.equal(summary.within5, 4);
  assert.equal(summary.hitRate, 0.5);
  assert.deepEqual(summary.unusable, { "blocked RECITATION": 1 });
  assert.equal(summary.passes, false);
  assert.deepEqual(summary.confidence, {
    high: { found: 3, hits: 2 },
    medium: { found: 1, hits: 1 },
  });
  assert.equal(summary.endError.count, 1);
  assert.equal(summary.tokensPerRun?.prompt, 20_000);
  // Six answered runs of 20k input at $0.50 and 1k output at $2 per million.
  assert.equal(summary.cost?.total.toFixed(4), "0.0720");
});

test("a run writes private results next to the input and skips long videos", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "quote-locate-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "quotes.jsonl");
  await writeFile(
    input,
    [
      {
        _id: "short",
        quoteText: "You talking to me?",
        sourceTitle: "Taxi Driver",
        sourceType: "MOVIE",
        clipUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=65s`,
        clipStartSeconds: 65,
      },
      {
        _id: "long",
        quoteText: "Line",
        sourceTitle: "Heat",
        clipUrl: `https://youtu.be/${LONG_VIDEO_ID}`,
        clipStartSeconds: 10,
      },
    ]
      .map((row) => JSON.stringify(row))
      .join("\n")
  );
  /** @type {string[]} */
  const requested = [];
  t.mock.method(
    globalThis,
    "fetch",
    /** @param {RequestInfo | URL} request */
    async (request) => {
      const url = urlOf(request);
      requested.push(url);
      if (url.startsWith("https://www.googleapis.com/youtube/v3/videos"))
        return jsonResponse({
          items: [
            {
              id: VIDEO_ID,
              contentDetails: { duration: "PT3M12S" },
              status: { privacyStatus: "public" },
            },
            {
              id: LONG_VIDEO_ID,
              contentDetails: { duration: "PT2H" },
              status: { privacyStatus: "public" },
            },
          ],
        });
      return jsonResponse(geminiBody(heard));
    }
  );
  /** @type {string[]} */
  const logged = [];
  t.mock.method(console, "log", (/** @type {unknown} */ line) => {
    logged.push(String(line));
  });

  const env = { YOUTUBE_API_KEY: "yt-key", GEMINI_API_KEY: "gemini-key" };
  assert.equal(await main(["--input", input, "--dry-run"], env), null);
  assert.ok(!requested.some((url) => url.includes("generativelanguage")));

  const summary = await main(["--input", input], env);
  assert.equal(summary?.run, 1);
  assert.equal(summary?.hits, 1);
  assert.ok(logged.some((line) => line.includes("video too long 1")));
  const outputs = (await readdir(directory)).filter((name) =>
    name.includes(".locate-gemini-3.8-flash-")
  );
  assert.equal(outputs.length, 1);
  const output = path.join(directory, outputs[0] ?? "");
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  const lines = (await readFile(output, "utf8")).trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(
    (({ id, status, hit, start, startError }) => ({
      id,
      status,
      hit,
      start,
      startError,
    }))(JSON.parse(lines[0] ?? "{}")),
    { id: "short", status: "found", hit: true, start: 65.2, startError: 0.2 }
  );
  await assert.rejects(
    main(["--input", input, "--output", output], env),
    /EEXIST/
  );
});
