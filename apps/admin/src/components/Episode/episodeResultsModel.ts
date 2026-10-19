import type { ConvexReactClient } from "convex/react";

import {
  type ConvexAssignmentWorkbench,
  loadConvexAssignmentWorkbenchById,
} from "@/convex/assignmentDetails";
import type { ConvexAdminEpisodeDetail } from "@/convex/episodeDetails";
import { loadConvexAdminEpisodesPage } from "@/convex/episodes";
import {
  type ConvexAdminQuoteSubmission,
  loadConvexAdminQuoteSubmissions,
} from "@/convex/quotabunga";
import {
  type ConvexAdminSeason,
  loadConvexAdminSeasonsPage,
} from "@/convex/seasons";

import {
  collectAllRecordingEpisodes,
  collectAllRecordingSeasons,
  findEpisodeSeason,
  getEpisodeSeasonPosition,
} from "../Recording/recordingManagementModel";

export interface EpisodeResults {
  season: ConvexAdminSeason | null;
  seasonPosition: number | null;
  quotes: ConvexAdminQuoteSubmission[];
  workbenches: ConvexAssignmentWorkbench[];
}

const QUOTE_STATUS_ORDER = { INCLUDED: 0, SUBMITTED: 1, REJECTED: 2 };

/** Placed entries first, by place; then the rest by status, oldest first. */
export function orderEpisodeQuotes(
  quotes: readonly ConvexAdminQuoteSubmission[]
): ConvexAdminQuoteSubmission[] {
  return [...quotes].sort(
    (left, right) =>
      (left.placement ?? 4) - (right.placement ?? 4) ||
      QUOTE_STATUS_ORDER[left.status] - QUOTE_STATUS_ORDER[right.status] ||
      left.createdAt - right.createdAt
  );
}

export async function loadEpisodeResults(
  client: ConvexReactClient,
  episode: Pick<ConvexAdminEpisodeDetail, "id" | "number" | "date"> & {
    assignments: readonly { id: string }[];
  },
  today: string
): Promise<EpisodeResults> {
  const [seasons, quotes, workbenches] = await Promise.all([
    collectAllRecordingSeasons((cursor) =>
      loadConvexAdminSeasonsPage(client, cursor)
    ),
    loadConvexAdminQuoteSubmissions(client, episode.id),
    Promise.all(
      episode.assignments.map(async ({ id }) => {
        const workbench = await loadConvexAssignmentWorkbenchById(client, id);
        if (workbench === null) {
          throw new Error(
            "An episode assignment became unavailable while loading results."
          );
        }
        return workbench;
      })
    ),
  ]);
  const season = findEpisodeSeason(episode, seasons, today);
  const seasonEpisodes =
    season?.startedOn == null
      ? null
      : // The season position is a label; never let it block the results.
        await collectAllRecordingEpisodes((cursor) =>
          loadConvexAdminEpisodesPage(client, cursor, {
            dateFrom: season.startedOn ?? undefined,
            dateTo: season.endedOn ?? undefined,
          })
        ).catch((error: unknown) => {
          console.error("Season episodes could not be loaded.", error);
          return null;
        });
  return {
    season,
    seasonPosition:
      season === null || seasonEpisodes === null
        ? null
        : getEpisodeSeasonPosition(episode, season, seasonEpisodes, today),
    quotes: orderEpisodeQuotes(quotes),
    workbenches,
  };
}
