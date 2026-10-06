import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { isPublishedEpisode } from "../lib/transcriptVisibility.js";
import {
  MAX_QUOTE_SUBMISSIONS_PER_SEASON,
  MAX_SEASONS_TO_INSPECT,
} from "./limits.js";
import { findSubmissionEpisode } from "./quoteReadModel.js";
import { quotePlacementAdjustment } from "./quoteWriteModel.js";
import { findCurrentSeason } from "./readModel.js";
import { isEpisodeRoundOpen } from "./roundWindow.js";
import type {
  quoteArchiveEntryValidator,
  quoteArchiveListenerValidator,
  quoteArchiveRoundValidator,
  quoteArchiveSeasonDetailValidator,
  quoteArchiveSeasonValidator,
} from "./validators.js";

type ArchiveReadContext = Pick<QueryCtx, "db">;
type ArchiveSeason = Infer<typeof quoteArchiveSeasonValidator>;
type ArchiveEntry = Infer<typeof quoteArchiveEntryValidator>;
type ArchiveRound = Infer<typeof quoteArchiveRoundValidator>;
type ArchiveListener = Infer<typeof quoteArchiveListenerValidator>;
type ArchiveSeasonDetail = Infer<typeof quoteArchiveSeasonDetailValidator>;
type Placement = 1 | 2 | 3;

function toArchiveSeason(
  season: Doc<"seasons">,
  isCurrent: boolean,
): ArchiveSeason {
  return {
    id: season._id,
    title: season.title,
    startedOn: season.startedOn ?? null,
    endedOn: season.endedOn ?? null,
    isCurrent,
  };
}

function placementOf(submission: Doc<"quoteSubmissions">): Placement | null {
  const { placement } = submission;
  return placement === 1 || placement === 2 || placement === 3
    ? placement
    : null;
}

/** Winners first, then the rest of the bracket, then entries left out of it. */
function compareEntries(
  left: Doc<"quoteSubmissions">,
  right: Doc<"quoteSubmissions">,
): number {
  const rank = (submission: Doc<"quoteSubmissions">) =>
    placementOf(submission) ?? (submission.status === "INCLUDED" ? 4 : 5);
  return (
    rank(left) - rank(right) ||
    (left.bracketOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.bracketOrder ?? Number.MAX_SAFE_INTEGER) ||
    left.createdAt - right.createdAt
  );
}

/**
 * Seasons the public archive can show, newest first: any season with a quote
 * submission, plus the current season so its open round has somewhere to go.
 */
export async function listQuoteArchiveSeasons(
  ctx: ArchiveReadContext,
  today: string,
): Promise<ArchiveSeason[]> {
  const [seasons, current] = await Promise.all([
    ctx.db
      .query("seasons")
      .withIndex("by_startedOn")
      .order("desc")
      .take(MAX_SEASONS_TO_INSPECT + 1),
    findCurrentSeason(ctx, today),
  ]);
  if (seasons.length > MAX_SEASONS_TO_INSPECT) {
    domainError(
      "CONFLICT",
      "Season list exceeds its bounded inspection limit.",
      { details: { limit: MAX_SEASONS_TO_INSPECT } },
    );
  }
  const listed = await Promise.all(
    seasons.map(async (season) => {
      const isCurrent = season._id === current?._id;
      const hasQuotes =
        isCurrent ||
        (await ctx.db
          .query("quoteSubmissions")
          .withIndex("by_seasonId", (index) =>
            index.eq("seasonId", season._id),
          )
          .first()) !== null;
      return hasQuotes ? [toArchiveSeason(season, isCurrent)] : [];
    }),
  );
  return listed.flat();
}

/**
 * One season of Quotabunga for anonymous readers. Quotes and listener names
 * appear only once the round's episode is published; until then a round
 * reports how many entries it has and nothing else, so the episode stays the
 * first place anyone hears the result. A published round the hosts never
 * awarded still shows its entries, just without places. Rejected entries,
 * listener notes and admin notes never leave here.
 */
export async function loadQuoteArchiveSeason(
  ctx: ArchiveReadContext,
  season: Doc<"seasons">,
  clock: { today: string; now: number },
): Promise<ArchiveSeasonDetail> {
  const [submissions, current] = await Promise.all([
    ctx.db
      .query("quoteSubmissions")
      .withIndex("by_seasonId", (index) => index.eq("seasonId", season._id))
      .take(MAX_QUOTE_SUBMISSIONS_PER_SEASON + 1),
    findCurrentSeason(ctx, clock.today),
  ]);
  if (submissions.length > MAX_QUOTE_SUBMISSIONS_PER_SEASON) {
    domainError(
      "CONFLICT",
      "Quote archive exceeds the supported season limit.",
      { details: { limit: MAX_QUOTE_SUBMISSIONS_PER_SEASON } },
    );
  }
  const isCurrent = season._id === current?._id;

  const byEpisode = new Map<
    Id<"episodes">,
    { entries: Array<Doc<"quoteSubmissions">>; submitted: number }
  >();
  for (const submission of submissions) {
    const round = byEpisode.get(submission.episodeId) ?? {
      entries: [],
      submitted: 0,
    };
    round.submitted += 1;
    if (submission.status !== "REJECTED") {
      round.entries.push(submission);
    }
    byEpisode.set(submission.episodeId, round);
  }
  // The round listeners can enter right now belongs on the current season
  // even before anyone has entered it.
  if (isCurrent) {
    const active = await findSubmissionEpisode(ctx);
    if (active !== null && !byEpisode.has(active._id)) {
      const entered = await ctx.db
        .query("quoteSubmissions")
        .withIndex("by_episodeId_and_createdAt", (index) =>
          index.eq("episodeId", active._id),
        )
        .first();
      if (entered === null) {
        byEpisode.set(active._id, { entries: [], submitted: 0 });
      }
    }
  }

  const grouped = await Promise.all(
    [...byEpisode].map(async ([episodeId, { entries, submitted }]) => {
      const episode = await ctx.db.get("episodes", episodeId);
      if (episode === null) {
        domainError(
          "CONFLICT",
          "Quote submission references a missing episode.",
          { details: { episodeId } },
        );
      }
      const published = isPublishedEpisode(episode);
      const state: ArchiveRound["state"] = published
        ? "revealed"
        : isEpisodeRoundOpen(episode, clock.now)
          ? "open"
          : "locked";
      // Until the reveal the count covers every submission, so it does not
      // move when the hosts reject or cut an entry.
      const entryCount = published ? entries.length : submitted;
      return { episode, entries, state, entryCount };
    }),
  );

  const userIds = new Set<Id<"users">>();
  for (const { entries, state } of grouped) {
    if (state === "revealed") {
      for (const submission of entries) {
        userIds.add(submission.userId);
      }
    }
  }
  const users = new Map(
    await Promise.all(
      [...userIds].map(async (userId) => {
        const user = await ctx.db.get("users", userId);
        if (user === null) {
          domainError(
            "CONFLICT",
            "Quote submission has a missing canonical relationship.",
            { details: { userId } },
          );
        }
        return [userId, { id: userId, name: user.name ?? null }] as const;
      }),
    ),
  );

  const listeners = new Map<Id<"users">, ArchiveListener>();
  const rounds: ArchiveRound[] = [];
  for (const { episode, entries, state, entryCount } of grouped) {
    // A closed round with nothing to show or count is not worth a row.
    if (entryCount === 0 && state !== "open") {
      continue;
    }
    const visible: ArchiveEntry[] = [];
    if (state === "revealed") {
      for (const submission of [...entries].sort(compareEntries)) {
        const user = users.get(submission.userId);
        if (user === undefined) {
          continue;
        }
        const placement = placementOf(submission);
        visible.push({
          id: submission._id,
          quoteText: submission.quoteText,
          sourceTitle: submission.sourceTitle,
          sourceType: submission.sourceType,
          clipUrl: submission.clipUrl ?? null,
          clipStartSeconds: submission.clipStartSeconds ?? null,
          clipEndSeconds: submission.clipEndSeconds ?? null,
          inBracket: submission.status === "INCLUDED",
          placement,
          user,
        });
        const listener = listeners.get(user.id) ?? {
          user,
          wins: 0,
          points: 0,
          entryCount: 0,
        };
        listener.entryCount += 1;
        if (placement !== null) {
          listener.wins += placement === 1 ? 1 : 0;
          listener.points += quotePlacementAdjustment(placement);
        }
        listeners.set(user.id, listener);
      }
    }
    rounds.push({
      episode: {
        id: episode._id,
        number: episode.number,
        title: episode.title,
        date: episode.date ?? null,
        // Only a published episode has a public page to link to.
        slug: state === "revealed" ? (episode.slug ?? null) : null,
      },
      state,
      entryCount,
      entries: visible,
    });
  }
  rounds.sort((left, right) => right.episode.number - left.episode.number);

  return {
    season: toArchiveSeason(season, isCurrent),
    rounds,
    listeners: [...listeners.values()].sort(
      (left, right) =>
        right.wins - left.wins ||
        right.points - left.points ||
        right.entryCount - left.entryCount ||
        (left.user.name ?? "").localeCompare(right.user.name ?? "", "en"),
    ),
  };
}
