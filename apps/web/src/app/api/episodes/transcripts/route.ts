import { NextResponse, type NextRequest } from "next/server";
import { searchEpisodeTranscripts } from "@/server/convex/episodes";

/** Validate a public transcript query and return its bounded search results. */
export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  const headers = { "Cache-Control": "no-store" };
  if (
    query.length > 256 ||
    terms.length > 16 ||
    terms.some((word) => word.length > 32)
  ) {
    return NextResponse.json(
      {
        error:
          "Use at most 16 words, 32 characters per word, and 256 characters total.",
      },
      { status: 400, headers }
    );
  }
  if (query.length < 2 || !terms.length)
    return NextResponse.json({ results: [], limited: false }, { headers });
  try {
    return NextResponse.json(await searchEpisodeTranscripts(query), {
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: "Transcript search is unavailable." },
      { status: 503, headers }
    );
  }
}
