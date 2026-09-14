"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Episode, type CompleteEpisode } from "@/components/Episode";
import SearchFilter from "@/components/common/SearchFilter";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  mergeEpisodeSearchResults,
  useEpisodeMetadataSearch,
  type EpisodeSearchRow,
} from "@bbpc/episode-search";
import { debounce } from "lodash";
import { TranscriptMatches, useTranscriptSearch } from "./TranscriptMatches";

const FUZZY_SEARCH_STORAGE_KEY = "bbpc-history-fuzzy-search";

type HistoryEpisode = CompleteEpisode;

type HistorySearchRow = EpisodeSearchRow<HistoryEpisode>;

/** Render the current title and transcript search results and empty states. */
function SearchResults({
  rows,
  query,
  isLoading,
}: {
  rows: HistorySearchRow[];
  query: string;
  isLoading: boolean;
}) {
  if (!query) {
    return (
      <div className="bbpc-panel flex flex-col items-center gap-3 p-8 text-center">
        <h2 className="text-xl font-bold text-white">
          Find a movie, title, or episode
        </h2>
        <p className="max-w-lg text-sm text-zinc-300">
          Search the archive, or browse every episode in reverse chronological
          order.
        </p>
        <Link
          href="/episodes"
          className="font-semibold text-red-300 underline underline-offset-4"
        >
          Browse all episodes
        </Link>
      </div>
    );
  }

  if (isLoading && rows.length === 0) {
    return <div className="text-center text-zinc-300">Searching...</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-center text-zinc-400">
        No episodes found matching your search.
      </div>
    );
  }

  return (
    <ul>
      {rows.map(({ episode, fuseMatches, passages }) => (
        <li className="mb-8" key={episode.id}>
          <Episode
            episode={episode}
            showMovieTitles={true}
            searchQuery={query}
            fuseMatches={fuseMatches}
          />
          {passages && passages.length > 0 && (
            <TranscriptMatches passages={passages} query={query} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Coordinate episode metadata and transcript search on the history page. */
export function HistoryPageClient({
  allEpisodes,
  isLoading = false,
}: {
  allEpisodes: HistoryEpisode[] | undefined;
  isLoading?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Initialize local query state from URL to allow immediate UI updates
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [fuzzySearch, setFuzzySearch] = useState(true);
  const transcripts = useTranscriptSearch(query);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FUZZY_SEARCH_STORAGE_KEY);
      if (stored === "true") setFuzzySearch(true);
      else if (stored === "false") setFuzzySearch(false);
    } catch {
      // ignore
    }
  }, []);

  const handleFuzzySearchChange = (enabled: boolean) => {
    setFuzzySearch(enabled);
    try {
      localStorage.setItem(
        FUZZY_SEARCH_STORAGE_KEY,
        enabled ? "true" : "false"
      );
    } catch {
      // ignore
    }
  };

  const filteredRows = useEpisodeMetadataSearch(
    allEpisodes,
    query,
    fuzzySearch
  );
  const combinedRows = useMemo(
    () => mergeEpisodeSearchResults(filteredRows, transcripts.data),
    [filteredRows, transcripts.data]
  );

  // Debounced URL updater to prevent browser history spam
  const debouncedUpdateUrl = useMemo(
    () =>
      debounce((newQuery: string, currentParamsString: string) => {
        const params = new URLSearchParams(currentParamsString);
        if (newQuery) {
          params.set("q", newQuery);
        } else {
          params.delete("q");
        }
        router.push(`/history?${params.toString()}`, { scroll: false });
      }, 500),
    [router]
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      debouncedUpdateUrl.cancel();
    };
  }, [debouncedUpdateUrl]);

  const handleSearch = (newQuery: string) => {
    setQuery(newQuery);
    // Pass the current params string to preserve other potential params
    debouncedUpdateUrl(newQuery, searchParams.toString());
  };

  const trimmedQuery = query.trim();

  return (
    <div className="bbpc-page flex max-w-5xl flex-col items-center gap-8">
      <div className="flex w-full max-w-4xl flex-col items-start justify-between gap-3 sm:flex-row sm:items-end sm:gap-4">
        <div>
          <p className="bbpc-kicker">Archive</p>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
            Search episodes
          </h1>
        </div>
        <Link
          href="/episodes"
          className="whitespace-nowrap font-semibold text-red-300 hover:text-red-200"
        >
          Browse all episodes
        </Link>
      </div>
      <div className="w-full max-w-4xl">
        <label className="mb-3 flex cursor-pointer items-start gap-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={fuzzySearch}
            onChange={(e) => handleFuzzySearchChange(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span>
            <span className="block font-semibold">
              Match close spellings in titles
            </span>
            <span className="block text-xs text-zinc-400">
              Useful for names and movie titles you only half remember.
            </span>
          </span>
        </label>
        <div className="mb-6 space-y-2">
          <SearchFilter onSearch={handleSearch} initialValue={query} />
          <p className="text-sm text-zinc-400" aria-live="polite">
            {trimmedQuery
              ? isLoading
                ? "Searching..."
                : `${combinedRows.length} ${
                    combinedRows.length === 1 ? "result" : "results"
                  }${transcripts.loading ? " · Searching transcripts…" : ""}`
              : "Search by episode title, movie name, or words from a transcript."}
          </p>
          <p className="text-xs text-zinc-400">
            Transcripts match words, including the beginning of the last word.
            Coverage depends on available transcripts.
          </p>
          {transcripts.error && (
            <div role="alert" className="text-sm text-red-200">
              {transcripts.error}
              {transcripts.enabled && (
                <button
                  type="button"
                  onClick={transcripts.retry}
                  className="ml-2 underline underline-offset-4"
                >
                  Retry transcript search
                </button>
              )}
            </div>
          )}
          {transcripts.data?.limited && (
            <p role="status" className="text-sm text-zinc-300">
              Showing the top transcript matches. Narrow your search to find
              more specific passages.
            </p>
          )}
          {transcripts.data?.results.length === 0 && (
            <p className="text-xs text-zinc-400">No transcript matches.</p>
          )}
        </div>
      </div>
      <div className="w-full max-w-4xl">
        <SearchResults
          rows={combinedRows}
          query={trimmedQuery}
          isLoading={isLoading || transcripts.loading}
        />
      </div>
    </div>
  );
}
