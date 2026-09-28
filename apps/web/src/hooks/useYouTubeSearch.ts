"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_VIDEO_RESULTS,
  MAX_VIDEO_SEARCH_LENGTH,
  MIN_VIDEO_SEARCH_LENGTH,
  normalizeVideoQuery,
  youtubeSearchErrorSchema,
  youtubeSearchResponseSchema,
  type YouTubeSearchVideo,
} from "@/lib/youtubeSearch";

const VIDEO_SEARCH_UNAVAILABLE =
  "Video search is unavailable right now. Try again or paste a clip link below.";

/** A message that is safe and specific enough to show the listener. */
class SearchError extends Error {}

type SearchOutcome = YouTubeSearchVideo[] | null | "replaced";

type VideoSearchResults = {
  query: string;
  videos: YouTubeSearchVideo[];
  nextPageToken: string | null;
  loading: boolean;
  error: string | null;
};

/**
 * The Quote Finder's YouTube search, shared by the search box and the
 * assistant so both see the same results and never search twice.
 */
export function useYouTubeSearch(suggestedQuery = "") {
  const [input, setInput] = useState<string | null>(null);
  const query = input ?? suggestedQuery.slice(0, MAX_VIDEO_SEARCH_LENGTH);
  const normalized = normalizeVideoQuery(query);
  const [resultsOpen, setResultsOpen] = useState(true);
  const [state, setState] = useState<VideoSearchResults | null>(null);
  const request = useRef<AbortController | null>(null);
  // Read synchronously, so a second press before the next render still sees
  // the first search.
  const pending = useRef<{
    key: string;
    controller: AbortController | null;
    promise: Promise<SearchOutcome>;
  } | null>(null);
  const results = state?.query === normalized ? state : null;
  const valid =
    normalized.length >= MIN_VIDEO_SEARCH_LENGTH &&
    normalized.length <= MAX_VIDEO_SEARCH_LENGTH;

  useEffect(() => {
    request.current?.abort();
    setState(null);
    return () => request.current?.abort();
  }, [normalized]);

  /**
   * Resolves to the listed videos, null if the search failed or can't run,
   * or "replaced" when a newer search took its place.
   */
  function search(more = false): Promise<SearchOutcome> {
    if (!valid) return Promise.resolve(null);
    const key = `${normalized}\u0000${String(more)}`;
    const current = pending.current;
    if (current?.key === key && !current.controller?.signal.aborted)
      return current.promise;
    const promise = run(more).finally(() => {
      if (pending.current?.promise === promise) pending.current = null;
    });
    pending.current = { key, controller: request.current, promise };
    return promise;
  }

  async function run(more: boolean): Promise<SearchOutcome> {
    setResultsOpen(true);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const prior = more ? results?.videos ?? [] : [];
    const pageToken = more ? results?.nextPageToken ?? null : null;
    setState({
      query: normalized,
      videos: prior,
      nextPageToken: pageToken,
      loading: true,
      error: null,
    });
    try {
      const params = new URLSearchParams({ q: normalized });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await fetch(`/api/youtube/search?${params}`, {
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401)
          throw new SearchError("Sign in to search for videos.");
        // The route explains its own refusals, such as a missing API key.
        const body = youtubeSearchErrorSchema.safeParse(
          await response.json().catch(() => null)
        );
        throw new SearchError(
          body.success ? body.data.error : VIDEO_SEARCH_UNAVAILABLE
        );
      }
      const result = youtubeSearchResponseSchema.parse(await response.json());
      if (controller.signal.aborted) return "replaced";
      const unique = new Map(
        [...prior, ...result.videos].map((video) => [video.id, video])
      );
      const videos = [...unique.values()].slice(0, MAX_VIDEO_RESULTS);
      setState({
        query: normalized,
        videos,
        nextPageToken: result.nextPageToken,
        loading: false,
        error: null,
      });
      return videos;
    } catch (error) {
      if (controller.signal.aborted) return "replaced";
      setState({
        query: normalized,
        videos: prior,
        nextPageToken: pageToken,
        loading: false,
        error:
          error instanceof SearchError
            ? error.message
            : VIDEO_SEARCH_UNAVAILABLE,
      });
      return null;
    }
  }

  return {
    query,
    setQuery: setInput,
    normalized,
    valid,
    results,
    resultsOpen,
    setResultsOpen,
    search,
  };
}

export type YouTubeSearch = ReturnType<typeof useYouTubeSearch>;
