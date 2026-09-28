import { z } from "zod";
import {
  MAX_QUOTE_TEXT_LENGTH,
  MAX_SOURCE_TITLE_LENGTH,
} from "@/lib/quoteClip";
import { VIDEO_SEARCH_PAGE_SIZE } from "@/lib/youtubeSearch";

/** The assistant checks search results in rank order, one page at a time. */
export const MAX_LOCATE_CANDIDATES = VIDEO_SEARCH_PAGE_SIZE;
// Video length sets the cost of a run; longer videos would break the budget.
export const MAX_ASSISTANT_VIDEO_SECONDS = 180;
export const QUOTE_LOCATE_UNAVAILABLE =
  "The assistant is unavailable right now. You can still search and pick a clip yourself.";

const videoIdSchema = z.string().regex(/^[\w-]{11}$/);
const candidatesSchema = z.array(videoIdSchema).max(MAX_LOCATE_CANDIDATES);
const locatedVideoSchema = z.object({
  id: videoIdSchema,
  title: z.string().max(500),
});

export const quoteLocateRequestSchema = z.object({
  quoteText: z.string().trim().min(1).max(MAX_QUOTE_TEXT_LENGTH),
  sourceTitle: z.string().trim().min(1).max(MAX_SOURCE_TITLE_LENGTH),
  sourceType: z.enum(["MOVIE", "TV", "OTHER"]),
  videoIds: candidatesSchema.min(1),
});

export const quoteLocateResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("found"),
    video: locatedVideoSchema,
    // Padded seconds, ready for the clip editor.
    start: z.number().nonnegative(),
    end: z.number().positive(),
    spokenText: z.string().min(1).max(MAX_QUOTE_TEXT_LENGTH),
    // "possible" when the heard line differs from the listener's wording.
    match: z.enum(["likely", "possible"]),
    remaining: candidatesSchema,
  }),
  z.object({
    status: z.literal("not_found"),
    video: locatedVideoSchema.nullable(),
    reason: z.enum(["not_heard", "unreadable", "timeout", "no_candidates"]),
    remaining: candidatesSchema,
  }),
]);

export const quoteLocateAvailabilitySchema = z.object({
  available: z.boolean(),
});

export const quoteLocateErrorSchema = z.object({
  error: z.string().min(1).max(300),
  // True when retrying won't help: until Retry-After when the response has
  // one, otherwise for the rest of the page.
  disabled: z.boolean().optional(),
});

export type QuoteLocateRequest = z.infer<typeof quoteLocateRequestSchema>;
export type QuoteLocateResponse = z.infer<typeof quoteLocateResponseSchema>;
