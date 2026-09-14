import { useEffect, useRef, useState } from "react";

export type TranscriptPassage = { start: number; end: number; text: string };
export type TranscriptSearchResponse<T> = {
  results: { episode: T; passages: TranscriptPassage[] }[];
  limited: boolean;
};

/** Search transcripts after a debounce while suppressing stale responses. */
export function useTranscriptSearch<T>(
  query: string,
  search: (
    query: string,
    signal: AbortSignal
  ) => Promise<TranscriptSearchResponse<T>>
) {
  const normalized = query.trim();
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState({
    query: normalized,
    attempt,
    generation: 0,
  });
  if (request.query !== normalized || request.attempt !== attempt) {
    setRequest({
      query: normalized,
      attempt,
      generation: request.generation + 1,
    });
  }
  const [state, setState] = useState<{
    generation: number;
    data?: TranscriptSearchResponse<T>;
    error?: string;
  } | null>(null);
  const generation = useRef(0);
  const terms = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const invalid =
    normalized.length > 256 ||
    terms.length > 16 ||
    terms.some((t) => t.length > 32);
  const enabled = normalized.length >= 2 && terms.length > 0 && !invalid;
  useEffect(() => {
    const current = ++generation.current;
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void search(normalized, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted && generation.current === current)
            setState({ generation: request.generation, data });
        })
        .catch(() => {
          if (!controller.signal.aborted && generation.current === current) {
            setState({
              generation: request.generation,
              error:
                "Transcript search is unavailable. Your title and movie results are still shown.",
            });
          }
        });
    }, 300);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [normalized, enabled, request.generation, search]);
  const visible =
    enabled &&
    request.query === normalized &&
    request.attempt === attempt &&
    state?.generation === request.generation
      ? state
      : null;
  return {
    data: visible?.data,
    error: invalid
      ? "For transcript search, use up to 16 words, 32 characters per word, and 256 characters total."
      : visible?.error,
    loading: enabled && !visible,
    enabled,
    retry: () => setAttempt((n) => n + 1),
  };
}

/** Format a transcript offset as a compact hours, minutes, and seconds label. */
export function formatTranscriptTime(seconds: number) {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(
        2,
        "0"
      )}:${rest}`
    : `${minutes}:${rest}`;
}
