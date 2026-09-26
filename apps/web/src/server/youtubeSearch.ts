import { z } from "zod";
import {
  decodeVideoTitle,
  MAX_PAGE_TOKEN_LENGTH,
  VIDEO_SEARCH_PAGE_SIZE,
  type YouTubeSearchResponse,
} from "@/lib/youtubeSearch";

const providerResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.object({ videoId: z.string().regex(/^[\w-]{11}$/) }),
        snippet: z.object({ title: z.string(), channelTitle: z.string() }),
      })
    )
    .max(VIDEO_SEARCH_PAGE_SIZE)
    .default([]),
  nextPageToken: z.string().max(MAX_PAGE_TOKEN_LENGTH).optional(),
});

/** Called only by the authenticated route; the API key never reaches the browser. */
export async function searchYouTubeVideos(
  query: string,
  pageToken: string | null,
  apiKey: string
): Promise<YouTubeSearchResponse> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    maxResults: String(VIDEO_SEARCH_PAGE_SIZE),
    q: query,
    fields: "items(id/videoId,snippet(title,channelTitle)),nextPageToken",
    ...(pageToken ? { pageToken } : {}),
  }).toString();
  const response = await fetch(url, {
    // A header keeps the key out of the URL that Next's fetch tracing,
    // logging and cache metadata record.
    headers: { "X-Goog-Api-Key": apiKey },
    signal: AbortSignal.timeout(8000),
    // Public video metadata can be reused across signed-in searchers for 5 minutes.
    cache: "force-cache",
    next: { revalidate: 300 },
  });
  if (!response.ok) throw new Error("YouTube search unavailable");
  const data = providerResponse.parse(await response.json());
  return {
    videos: data.items.map(({ id, snippet }) => ({
      id: id.videoId,
      title: decodeVideoTitle(snippet.title),
      channel: decodeVideoTitle(snippet.channelTitle),
    })),
    nextPageToken: data.nextPageToken ?? null,
  };
}
