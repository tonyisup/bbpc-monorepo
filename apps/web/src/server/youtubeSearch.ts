import { z } from "zod";
import {
  decodeVideoTitle,
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
    .max(6)
    .default([]),
  nextPageToken: z.string().max(512).optional(),
});

/** Called only by the authenticated route; the API key never reaches the browser. */
export async function searchYouTubeVideos(
  query: string,
  pageToken: string | null,
  apiKey: string
): Promise<YouTubeSearchResponse> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    key: apiKey,
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoSyndicated: "true",
    maxResults: "6",
    q: query,
    fields: "items(id/videoId,snippet(title,channelTitle)),nextPageToken",
    ...(pageToken ? { pageToken } : {}),
  }).toString();
  const response = await fetch(url, {
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
