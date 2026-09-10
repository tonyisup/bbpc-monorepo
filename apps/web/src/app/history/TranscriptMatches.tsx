import type { CompleteEpisode } from "@/types/episode";
import { useEffect, useRef, useState } from "react";

export type TranscriptPassage = { start: number; end: number; text: string };
export type TranscriptSearchResponse = {
  results: { episode: CompleteEpisode; passages: TranscriptPassage[] }[];
  limited: boolean;
};

export function useTranscriptSearch(query: string) {
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
    data?: TranscriptSearchResponse;
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
      void fetch(
        `/api/episodes/transcripts?q=${encodeURIComponent(normalized)}`,
        {
          signal: controller.signal,
          cache: "no-store",
        }
      )
        .then(async (response) => {
          if (!response.ok)
            throw new Error("Transcript search is unavailable. Try again.");
          return (await response.json()) as TranscriptSearchResponse;
        })
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
  }, [normalized, enabled, request.generation]);
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

function highlight(text: string, query: string) {
  const terms: string[] = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const prefix = terms.at(-1);
  return text.split(/([\p{L}\p{N}]+)/gu).map((part, index) => {
    const word = part.toLowerCase();
    return terms.includes(word) || (prefix && word.startsWith(prefix)) ? (
      <mark key={index} className="rounded bg-red-300/20 text-red-100">
        {part}
      </mark>
    ) : (
      part
    );
  });
}

export function TranscriptMatches({
  passages,
  query,
}: {
  passages: TranscriptPassage[];
  query: string;
}) {
  return (
    <div className="mt-3 space-y-3 border-l-2 border-red-400/50 pl-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Transcript · Automatically generated
      </p>
      {passages.map((passage, index) => (
        <div key={`${passage.start}-${index}`} className="space-y-1">
          <span
            className="font-mono text-xs text-red-300"
            aria-label={`Timestamp ${formatTranscriptTime(passage.start)}`}
          >
            {formatTranscriptTime(passage.start)}
          </span>
          <p className="break-words text-sm leading-relaxed text-zinc-300">
            {highlight(passage.text, query)}
          </p>
        </div>
      ))}
    </div>
  );
}
