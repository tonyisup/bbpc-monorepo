import { z } from "zod";

export const MIN_VIDEO_SEARCH_LENGTH = 2;
export const MAX_VIDEO_SEARCH_LENGTH = 200;
export const MAX_PAGE_TOKEN_LENGTH = 512;
export const VIDEO_SEARCH_PAGE_SIZE = 6;
export const MAX_VIDEO_RESULTS = 24;
export const youtubeSearchResponseSchema = z.object({
  videos: z
    .array(
      z.object({
        id: z.string().regex(/^[\w-]{11}$/),
        title: z.string(),
        channel: z.string(),
      })
    )
    .max(VIDEO_SEARCH_PAGE_SIZE),
  nextPageToken: z.string().max(MAX_PAGE_TOKEN_LENGTH).nullable(),
});
export const youtubeSearchErrorSchema = z.object({
  error: z.string().min(1).max(300),
});

export type YouTubeSearchResponse = z.infer<typeof youtubeSearchResponseSchema>;
export type YouTubeSearchVideo = YouTubeSearchResponse["videos"][number];

export function normalizeVideoQuery(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Search snippets contain HTML entities, but never render their text as HTML. */
export function decodeVideoTitle(value: string) {
  return value.replace(
    /&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
      };
      if (named[entity.toLowerCase()])
        return named[entity.toLowerCase()] ?? entity;
      const code = entity.toLowerCase().startsWith("&#x")
        ? parseInt(entity.slice(3, -1), 16)
        : parseInt(entity.slice(2, -1), 10);
      return Number.isInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    }
  );
}
