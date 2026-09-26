import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/env.mjs";
import {
  MAX_VIDEO_SEARCH_LENGTH,
  normalizeVideoQuery,
} from "@/lib/youtubeSearch";
import { searchYouTubeVideos } from "@/server/youtubeSearch";

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
      query.length < 2 ||
      query.length > MAX_VIDEO_SEARCH_LENGTH ||
      (pageToken !== null && (pageToken.length === 0 || pageToken.length > 512))
    ) {
      return NextResponse.json(
        { error: "Use a search between 2 and 200 characters." },
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
