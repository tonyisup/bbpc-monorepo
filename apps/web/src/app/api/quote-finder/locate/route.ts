import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env.mjs";
import {
  MAX_ASSISTANT_VIDEO_SECONDS,
  QUOTE_LOCATE_UNAVAILABLE as UNAVAILABLE,
  quoteLocateRequestSchema,
  type QuoteLocateResponse,
} from "@/lib/quoteLocate";
import { retryAfterSeconds, retryWait } from "@/server/budget";
import { reserveQuoteLocate } from "@/server/convex/quotes";
import {
  assistantCandidates,
  fetchVideoDetails,
  LocateRequestError,
  locateQuote,
  padLocatedRange,
  quoteCoverage,
} from "@/server/quoteLocate.mjs";

// Most runs answer in a few seconds, but a few take 40 s or never answer.
// Gemini gets whatever is left of a deadline inside the route's own limit, so
// a slow run still returns "try again" instead of a platform timeout.
export const maxDuration = 60;
const ROUTE_DEADLINE_MS = 55_000;
const LOCATE_TIMEOUT_MS = 45_000;
const DETAILS_TIMEOUT_MS = 8000;
// Less than this left, and starting a Gemini request only wastes it.
const MIN_LOCATE_MS = 10_000;
// Share of the listener's wording that must be heard for a likely match.
const LIKELY_MATCH_COVERAGE = 0.5;

const headers = { "Cache-Control": "private, no-store" };
const SIGN_IN = "Sign in to use the Quote Finder assistant.";
const OUT_OF_BUDGET =
  "The assistant has used its budget for now. You can still search and pick a clip yourself.";

function located(body: QuoteLocateResponse) {
  return NextResponse.json(body, { headers });
}

function refused(error: string, status: number, disabled = false) {
  return NextResponse.json(disabled ? { error, disabled } : { error }, {
    status,
    headers,
  });
}

function isTimeout(error: unknown) {
  return error instanceof Error && error.name === "TimeoutError";
}

// A bad or unauthorized key, an unsupported region or a retired model fails
// every run, so it must not pass for a video Gemini couldn't read.
function failsEveryRun(error: LocateRequestError) {
  return (
    error.status === 401 ||
    error.status === 403 ||
    error.status === 404 ||
    error.reason === "API_KEY_INVALID" ||
    error.providerStatus === "FAILED_PRECONDITION"
  );
}

// An older backend has no reservation function; retrying won't help until
// it is deployed. Other reservation errors may pass.
function backendLacksBudget(error: unknown) {
  return (
    error instanceof Error &&
    /Could not find public function/i.test(error.message)
  );
}

/** For operators; never the message, which can echo the request. */
function logFailure(stage: string, error: unknown) {
  console.error("Quote Finder assistant failed", {
    stage,
    name: error instanceof Error ? error.name : typeof error,
    ...(error instanceof LocateRequestError
      ? {
          status: error.status,
          providerStatus: error.providerStatus,
          reason: error.reason,
        }
      : {}),
  });
}

/**
 * Whether to offer the assistant; spends nothing. Only a 200 is a definite
 * answer; the finder asks again after a sign-in or server hiccup.
 */
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId)
      return NextResponse.json({ available: false }, { status: 401, headers });
    return NextResponse.json(
      { available: Boolean(env.GEMINI_API_KEY && env.YOUTUBE_API_KEY) },
      { headers }
    );
  } catch {
    return NextResponse.json({ available: false }, { status: 503, headers });
  }
}

/** Checks one video for the listener's line and suggests where it's spoken. */
export async function POST(request: NextRequest) {
  const deadline = Date.now() + ROUTE_DEADLINE_MS;
  let stage = "auth";
  // A JSON content type forces a CORS preflight, so another origin's form
  // post can't spend a listener's runs.
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return refused("Send the request as JSON.", 415);
  try {
    const { userId } = await auth();
    if (!userId) return refused(SIGN_IN, 401);
    const input = quoteLocateRequestSchema.safeParse(
      await request.json().catch(() => null)
    );
    if (!input.success)
      return refused("Add a quote, its movie or show, and a video.", 400);
    const geminiKey = env.GEMINI_API_KEY;
    const youtubeKey = env.YOUTUBE_API_KEY;
    if (!geminiKey || !youtubeKey) return refused(UNAVAILABLE, 503, true);

    // Every run costs money, so each listener and the site have a budget.
    // Failing to reserve fails closed.
    let reservation: Awaited<ReturnType<typeof reserveQuoteLocate>>;
    try {
      reservation = await reserveQuoteLocate();
    } catch (error) {
      logFailure("reserve", error);
      return refused(UNAVAILABLE, 503, backendLacksBudget(error));
    }
    if (reservation === null) return refused(SIGN_IN, 401);
    if (!reservation.ok) {
      const wait = retryWait(reservation.retryAt);
      return NextResponse.json(
        {
          error:
            reservation.scope === "user"
              ? `You've used your assistant runs for now. Try again in ${wait}, or search and pick a clip yourself.`
              : `The assistant has hit its limit for now. Try again in ${wait}, or search and pick a clip yourself.`,
          disabled: true,
        },
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": retryAfterSeconds(reservation.retryAt),
          },
        }
      );
    }

    const { quoteText, sourceTitle, sourceType, videoIds } = input.data;
    stage = "details";
    let details: Awaited<ReturnType<typeof fetchVideoDetails>>;
    try {
      details = await fetchVideoDetails(
        videoIds,
        youtubeKey,
        AbortSignal.any([
          request.signal,
          AbortSignal.timeout(
            Math.max(0, Math.min(DETAILS_TIMEOUT_MS, deadline - Date.now()))
          ),
        ])
      );
    } catch (error) {
      // A bad key, a disabled API or a spent YouTube quota fails every run.
      if (
        error instanceof LocateRequestError &&
        [400, 401, 403].includes(error.status)
      ) {
        logFailure(stage, error);
        return refused(UNAVAILABLE, 503, true);
      }
      throw error;
    }
    const [candidate, ...rest] = assistantCandidates(
      videoIds,
      details,
      MAX_ASSISTANT_VIDEO_SECONDS
    );
    const remaining = rest.map(({ id }) => id);
    const miss = (
      reason: Extract<QuoteLocateResponse, { status: "not_found" }>["reason"],
      video: { id: string; title: string } | null
    ) => located({ status: "not_found", video, reason, remaining });
    if (!candidate) return miss("no_candidates", null);
    const video = { id: candidate.id, title: candidate.title };

    stage = "locate";
    // A slow sign-in, reservation or lookup used the time; say "try again"
    // rather than pay for a request that can't finish.
    if (deadline - Date.now() < MIN_LOCATE_MS) {
      logFailure(stage, new Error("Deadline"));
      return miss("timeout", video);
    }
    let answer: Awaited<ReturnType<typeof locateQuote>>;
    try {
      answer = await locateQuote({
        apiKey: geminiKey,
        videoId: candidate.id,
        durationSeconds: candidate.durationSeconds,
        quoteText,
        sourceTitle,
        sourceType,
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(
            Math.max(0, Math.min(LOCATE_TIMEOUT_MS, deadline - Date.now()))
          ),
        ]),
      });
    } catch (error) {
      if (isTimeout(error)) return miss("timeout", video);
      if (!(error instanceof LocateRequestError)) throw error;
      // The prepaid balance is the spending limit; it ran out.
      if (error.status === 402) {
        logFailure(stage, error);
        return refused(OUT_OF_BUDGET, 503, true);
      }
      if (failsEveryRun(error)) {
        logFailure(stage, error);
        return refused(UNAVAILABLE, 503, true);
      }
      // Gemini refuses a video it can't fetch; move on to the next one. It is
      // logged too, since a request Gemini rejects for every video looks alike.
      if (error.status === 400) {
        logFailure(stage, error);
        return miss("unreadable", video);
      }
      throw error;
    }

    const { result, usage } = answer;
    // Tokens, never text, so operators can see what runs cost.
    console.info("Quote Finder assistant run", {
      status: result.status,
      promptTokens: usage.promptTokens,
      outputTokens: usage.outputTokens,
      thoughtsTokens: usage.thoughtsTokens,
    });
    if (result.status === "not_found") return miss("not_heard", video);
    if (result.status !== "found") {
      // A cut-off (MAX_TOKENS), blocked or malformed answer still cost money.
      console.error("Quote Finder assistant failed", {
        stage: "answer",
        status: result.status,
        reason: result.reason,
      });
      return miss("unreadable", video);
    }
    const range = padLocatedRange(
      result.start,
      result.end,
      candidate.durationSeconds
    );
    return located({
      status: "found",
      video,
      start: range.start,
      end: range.end,
      spokenText: result.spokenText,
      match:
        result.confidence === "high" &&
        quoteCoverage(quoteText, result.spokenText) >= LIKELY_MATCH_COVERAGE
          ? "likely"
          : "possible",
      remaining,
    });
  } catch (error) {
    // Never include provider errors: they can echo the request or the key.
    // A listener who cancelled is gone; that isn't a failure to log.
    if (!request.signal.aborted) logFailure(stage, error);
    return refused(UNAVAILABLE, 503);
  }
}
