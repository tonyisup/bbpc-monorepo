import { formatPlainDate } from "@/lib/dates";
import { parseYouTubeUrl } from "@/lib/quoteClip";
import { ordinal } from "@/lib/seasonActivity";
import type {
  QuotabungaEntry,
  QuotabungaListener,
  QuotabungaRound,
  QuotabungaSeason,
  QuotabungaSeasonDetail,
} from "@/types/quotabunga";

export const ALL_SEASONS = "all";

/**
 * Points the hosts award for each place, as the game rules list them. The
 * backend's quotePlacementAdjustment awards the same amounts and totals them
 * for the wins board, so the two must change together.
 */
const PLACEMENT_POINTS: Record<1 | 2 | 3, number> = {
  1: 40,
  2: 20,
  3: 10,
};

export type QuotabungaSeasonView =
  | { kind: "all" }
  | { kind: "season"; season: QuotabungaSeason }
  | { kind: "none" };

/**
 * Which seasons the page shows for a `?season=` value. Anything that is not
 * "all" or a listed season falls back to the current season, then the newest.
 */
export function selectSeasonView(
  seasons: QuotabungaSeason[],
  requested: string | undefined
): QuotabungaSeasonView {
  if (requested === ALL_SEASONS && seasons.length > 0) {
    return { kind: "all" };
  }
  const season =
    seasons.find((candidate) => candidate.id === requested) ??
    seasons.find((candidate) => candidate.isCurrent) ??
    seasons[0];
  return season === undefined ? { kind: "none" } : { kind: "season", season };
}

export function placementLabel(placement: 1 | 2 | 3): string {
  return `${ordinal(placement)} · ${PLACEMENT_POINTS[placement]} pts`;
}

/**
 * A quote wrapped in one pair of curly quotes. Listeners often type their own
 * quotation marks, which would otherwise double up.
 */
export function quoted(text: string): string {
  const bare = text
    .trim()
    .replace(/^["\u201C\u201D]+|["\u201C\u201D]+$/gu, "")
    .trim();
  return `\u201C${bare === "" ? text.trim() : bare}\u201D`;
}

export function listenerName(name: string | null): string {
  return name?.trim() || "A listener";
}

export function sourceLabel(
  entry: Pick<QuotabungaEntry, "sourceTitle" | "sourceType">
): string {
  return entry.sourceType === "TV"
    ? `${entry.sourceTitle} (TV)`
    : entry.sourceTitle;
}

export function entryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

/**
 * The entry a revealed round leads with: first place, else its best finisher.
 * Null when the hosts never placed anything in the round.
 */
export function leadEntry(round: QuotabungaRound): QuotabungaEntry | null {
  return (
    round.entries.find((entry) => entry.placement === 1) ??
    round.entries.find((entry) => entry.placement !== null) ??
    null
  );
}

/** "Jul 2026 to now", "Jan to Jun 2026", or empty when the start is unknown. */
export function seasonDateRange(
  season: Pick<QuotabungaSeason, "startedOn" | "endedOn">
): string {
  const { startedOn, endedOn } = season;
  if (startedOn === null) {
    return "";
  }
  const monthYear = { month: "short", year: "numeric" } as const;
  if (endedOn === null) {
    return `${formatPlainDate(startedOn, monthYear, "en-US")} to now`;
  }
  const start =
    startedOn.slice(0, 4) === endedOn.slice(0, 4)
      ? formatPlainDate(startedOn, { month: "short" }, "en-US")
      : formatPlainDate(startedOn, monthYear, "en-US");
  return `${start} to ${formatPlainDate(endedOn, monthYear, "en-US")}`;
}

export interface QuotabungaStats {
  rounds: number;
  quotes: number;
  listeners: number;
}

/** Totals over revealed rounds only; open and locked rounds stay uncounted. */
export function archiveStats(
  details: QuotabungaSeasonDetail[]
): QuotabungaStats {
  const listeners = new Set<string>();
  let rounds = 0;
  let quotes = 0;
  for (const detail of details) {
    for (const round of detail.rounds) {
      if (round.state !== "revealed") {
        continue;
      }
      rounds += 1;
      quotes += round.entries.length;
    }
    for (const listener of detail.listeners) {
      listeners.add(listener.user.id);
    }
  }
  return { rounds, quotes, listeners: listeners.size };
}

/** The newest revealed round with a first place, and that winning entry. */
export function latestWinner(
  details: QuotabungaSeasonDetail[]
): { round: QuotabungaRound; entry: QuotabungaEntry } | null {
  let latest: { round: QuotabungaRound; entry: QuotabungaEntry } | null = null;
  for (const detail of details) {
    for (const round of detail.rounds) {
      const entry = round.state === "revealed" ? leadEntry(round) : null;
      if (
        entry?.placement === 1 &&
        (latest === null || round.episode.number > latest.round.episode.number)
      ) {
        latest = { round, entry };
      }
    }
  }
  return latest;
}

/** One tally per listener across seasons, most wins first. */
export function mergeListeners(
  details: QuotabungaSeasonDetail[]
): QuotabungaListener[] {
  const merged = new Map<string, QuotabungaListener>();
  for (const detail of details) {
    for (const listener of detail.listeners) {
      const current = merged.get(listener.user.id);
      merged.set(
        listener.user.id,
        current === undefined
          ? { ...listener }
          : {
              user: current.user,
              wins: current.wins + listener.wins,
              points: current.points + listener.points,
              entryCount: current.entryCount + listener.entryCount,
            }
      );
    }
  }
  return [...merged.values()].sort(
    (left, right) =>
      right.wins - left.wins ||
      right.points - left.points ||
      right.entryCount - left.entryCount ||
      listenerName(left.user.name).localeCompare(
        listenerName(right.user.name),
        "en"
      )
  );
}

/**
 * The clip link the public page may use: a YouTube video, or nothing. Any
 * listener can attach a link, so one to another site is never shown.
 */
export function youtubeUrlOrNull(value: string | null): string | null {
  return value !== null && parseYouTubeUrl(value) !== null
    ? value.trim()
    : null;
}

/**
 * Rank numbers for listeners already sorted best first. Listeners level on
 * wins and points share a rank, and the next rank skips past them.
 */
export function listenerRanks(listeners: QuotabungaListener[]): number[] {
  const ranks: number[] = [];
  listeners.forEach((listener, index) => {
    const previous = listeners[index - 1];
    ranks.push(
      previous !== undefined &&
        previous.wins === listener.wins &&
        previous.points === listener.points
        ? ranks[index - 1] ?? index + 1
        : index + 1
    );
  });
  return ranks;
}

type ClipFields = Pick<
  QuotabungaEntry,
  "clipUrl" | "clipStartSeconds" | "clipEndSeconds"
>;

/** "0:07" for a marked range; null when the clip has no end. */
export function clipDurationLabel(clip: ClipFields): string | null {
  const { clipStartSeconds: start, clipEndSeconds: end } = clip;
  if (start === null || end === null || end <= start) {
    return null;
  }
  const seconds = Math.max(1, Math.round(end - start));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A privacy-mode YouTube embed that plays the marked range, or null when the
 * clip is not a YouTube video. The embed only takes whole seconds, so the
 * range widens to the nearest second on each side.
 */
export function clipEmbedUrl(clip: ClipFields): string | null {
  const video = clip.clipUrl === null ? null : parseYouTubeUrl(clip.clipUrl);
  if (video === null) {
    return null;
  }
  const start = Math.floor(clip.clipStartSeconds ?? video.start);
  const params = new URLSearchParams({ autoplay: "1", rel: "0" });
  if (start > 0) {
    params.set("start", String(start));
  }
  if (clip.clipEndSeconds !== null && clip.clipEndSeconds > start) {
    params.set("end", String(Math.ceil(clip.clipEndSeconds)));
  }
  return `https://www.youtube-nocookie.com/embed/${
    video.id
  }?${params.toString()}`;
}
