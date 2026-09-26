import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env.mjs";
import {
  MAX_PAGE_TOKEN_LENGTH,
  MAX_VIDEO_SEARCH_LENGTH,
  MIN_VIDEO_SEARCH_LENGTH,
  normalizeVideoQuery,
} from "@/lib/youtubeSearch";
import { reserveVideoSearch } from "@/server/convex/quotes";
import { searchYouTubeVideos } from "@/server/youtubeSearch";

function retryWait(retryAt: number) {
  const minutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000));
  if (minutes < 60)
    return `${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
}

export async function GET(request: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const { userId } = await auth();
    if (!userId)
      return NextResponse.json(
        { error: "Sign in to search for videos." },
        { status: 401, headers }
      );
    const query = normalizeVideoQuery(
      request.nextUrl.searchParams.get("q") ?? ""
    );
    const pageToken = request.nextUrl.searchParams.get("pageToken");
    if (
      query.length < MIN_VIDEO_SEARCH_LENGTH ||
      query.length > MAX_VIDEO_SEARCH_LENGTH ||
      (pageToken !== null &&
        (pageToken.length === 0 || pageToken.length > MAX_PAGE_TOKEN_LENGTH))
    ) {
      return NextResponse.json(
        {
          error: `Use a search between ${String(
            MIN_VIDEO_SEARCH_LENGTH
          )} and ${String(MAX_VIDEO_SEARCH_LENGTH)} characters.`,
        },
        { status: 400, headers }
      );
    }
    if (!env.YOUTUBE_API_KEY) {
      return NextResponse.json(
        {
          error:
            "Video search is unavailable right now. You can still paste a clip link below.",
        },
        { status: 503, headers }
      );
    }
    // Every search spends shared API quota, so each listener gets a budget.
    // Failing to reserve (e.g. an older backend) fails closed via the catch.
    const reservation = await reserveVideoSearch();
    if (reservation === null)
      return NextResponse.json(
        { error: "Sign in to search for videos." },
        { status: 401, headers }
      );
    if (!reservation.ok) {
      const wait = retryWait(reservation.retryAt);
      return NextResponse.json(
        {
          error:
            reservation.scope === "user"
              ? `You've used your video searches for now. Try again in ${wait}, or paste a clip link below.`
              : `Video search has hit its limit for today. Try again in ${wait}, or paste a clip link below.`,
        },
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": String(
              Math.max(1, Math.ceil((reservation.retryAt - Date.now()) / 1000))
            ),
          },
        }
      );
    }
    return NextResponse.json(
      await searchYouTubeVideos(query, pageToken, env.YOUTUBE_API_KEY),
      { headers }
    );
  } catch {
    // Never include provider errors: they can contain the credential-bearing URL.
    return NextResponse.json(
      {
        error:
          "Video search is unavailable right now. Try again or paste a clip link below.",
      },
      { status: 503, headers }
    );
  }
}
