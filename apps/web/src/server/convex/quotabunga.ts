import { api } from "@tonyisup/bbpc-convex-api";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import "server-only";

import { z } from "zod";

import { youtubeUrlOrNull } from "@/lib/quotabungaArchive";
import { fetchPublicQuery } from "@/server/convex/client";
import type {
  QuotabungaSeason,
  QuotabungaSeasonDetail,
} from "@/types/quotabunga";

const seasonSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  startedOn: z.string().nullable(),
  endedOn: z.string().nullable(),
  isCurrent: z.boolean(),
});

const listenerNameSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
});

const entrySchema = z.object({
  id: z.string().min(1),
  quoteText: z.string(),
  sourceTitle: z.string(),
  sourceType: z.enum(["MOVIE", "TV", "OTHER"]),
  clipUrl: z.string().nullable().transform(youtubeUrlOrNull),
  clipStartSeconds: z.number().nullable(),
  clipEndSeconds: z.number().nullable(),
  inBracket: z.boolean(),
  placement: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
  user: listenerNameSchema,
});

const seasonDetailSchema = z
  .object({
    season: seasonSchema,
    rounds: z.array(
      z.object({
        episode: z.object({
          id: z.string().min(1),
          number: z.number(),
          title: z.string(),
          date: z.string().nullable(),
          slug: z.string().nullable(),
        }),
        state: z.enum(["open", "locked", "revealed"]),
        entryCount: z.number().int().nonnegative(),
        entries: z.array(entrySchema),
      })
    ),
    listeners: z.array(
      z.object({
        user: listenerNameSchema,
        wins: z.number().int().nonnegative(),
        points: z.number(),
        entryCount: z.number().int().nonnegative(),
      })
    ),
  })
  .nullable();

const quotabungaSeasonsQuery = api.games.public.quotabungaSeasons;
const quotabungaSeasonQuery = api.games.public.quotabungaSeason;

/** Seasons the Quotabunga archive can show, newest first. */
export async function getQuotabungaSeasons(
  today: string
): Promise<QuotabungaSeason[]> {
  return z
    .array(seasonSchema)
    .parse(await fetchPublicQuery(quotabungaSeasonsQuery, { today }));
}

/** One season's rounds and listener tallies; null when the season is gone. */
export async function getQuotabungaSeason(
  seasonId: string,
  today: string,
  now: number
): Promise<QuotabungaSeasonDetail | null> {
  return seasonDetailSchema.parse(
    await fetchPublicQuery(quotabungaSeasonQuery, {
      seasonId: documentId("seasons", seasonId),
      today,
      now,
    })
  );
}
