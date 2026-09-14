import Fuse, { type FuseResultMatch } from "fuse.js";
import { useMemo } from "react";
import type {
  TranscriptSearchResponse,
  TranscriptPassage,
} from "./transcripts";

export interface SearchableEpisode {
  id: string;
  title: string;
  assignments: { movie: { title: string } | null }[];
  extras: {
    review: {
      movie?: { title: string } | null | undefined;
      show?: { title: string } | null | undefined;
    };
  }[];
}

export type EpisodeSearchRow<T> = {
  episode: T;
  fuseMatches?: ReadonlyArray<FuseResultMatch> | undefined;
  passages?: TranscriptPassage[];
};

export function createEpisodeSearch<T extends SearchableEpisode>(
  episodes: T[]
) {
  return new Fuse(episodes, {
    keys: [
      "title",
      "assignments.movie.title",
      "extras.review.movie.title",
      "extras.review.show.title",
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeMatches: true,
  });
}

function episodeMatchesSubstring(
  episode: SearchableEpisode,
  needleLower: string
): boolean {
  if (episode.title.toLowerCase().includes(needleLower)) {
    return true;
  }
  for (const a of episode.assignments) {
    const t = a.movie?.title;
    if (
      t !== undefined &&
      t !== null &&
      t.toLowerCase().includes(needleLower)
    ) {
      return true;
    }
  }
  for (const e of episode.extras) {
    const movieTitle = e.review.movie?.title;
    if (
      movieTitle !== undefined &&
      movieTitle !== null &&
      movieTitle.toLowerCase().includes(needleLower)
    ) {
      return true;
    }
    const showTitle = e.review.show?.title;
    if (
      showTitle !== undefined &&
      showTitle !== null &&
      showTitle.toLowerCase().includes(needleLower)
    ) {
      return true;
    }
  }
  return false;
}

export function searchEpisodeMetadata<T extends SearchableEpisode>(
  episodes: T[],
  query: string,
  fuzzy: boolean,
  index: Fuse<T>
): EpisodeSearchRow<T>[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return fuzzy
    ? index
        .search(trimmed)
        .map((result) => ({
          episode: result.item,
          fuseMatches: result.matches,
        }))
    : episodes
        .filter((episode) =>
          episodeMatchesSubstring(episode, trimmed.toLowerCase())
        )
        .map((episode) => ({ episode }));
}

export function useEpisodeMetadataSearch<T extends SearchableEpisode>(
  episodes: T[] | undefined,
  query: string,
  fuzzy: boolean
) {
  const index = useMemo(
    () => (episodes ? createEpisodeSearch(episodes) : null),
    [episodes]
  );
  return useMemo(
    () =>
      episodes && index
        ? searchEpisodeMetadata(episodes, query, fuzzy, index)
        : [],
    [episodes, index, query, fuzzy]
  );
}

export function mergeEpisodeSearchResults<T extends { id: string }>(
  metadata: EpisodeSearchRow<T>[],
  transcripts?: TranscriptSearchResponse<T>
): EpisodeSearchRow<T>[] {
  const rows = metadata.map((row) => ({ ...row }));
  const byId = new Map(rows.map((row) => [row.episode.id, row]));
  for (const match of transcripts?.results ?? []) {
    const existing = byId.get(match.episode.id);
    if (existing) existing.passages = match.passages;
    else {
      const row = { episode: match.episode, passages: match.passages };
      rows.push(row);
      byId.set(match.episode.id, row);
    }
  }
  return rows;
}
