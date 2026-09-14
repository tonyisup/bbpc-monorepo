import type { CompleteEpisode } from "@/types/episode";
import {
  useTranscriptSearch as useSharedTranscriptSearch,
  formatTranscriptTime,
  type TranscriptSearchResponse as SearchResponse,
  type TranscriptPassage,
} from "@bbpc/episode-search";

export { formatTranscriptTime };
export type { TranscriptPassage };
export type TranscriptSearchResponse = SearchResponse<CompleteEpisode>;

async function searchTranscripts(
  query: string,
  signal: AbortSignal
): Promise<TranscriptSearchResponse> {
  const response = await fetch(
    `/api/episodes/transcripts?q=${encodeURIComponent(query)}`,
    {
      signal,
      cache: "no-store",
    }
  );
  if (!response.ok)
    throw new Error("Transcript search is unavailable. Try again.");
  return (await response.json()) as TranscriptSearchResponse;
}

export function useTranscriptSearch(query: string) {
  return useSharedTranscriptSearch(query, searchTranscripts);
}

/** Highlight exact query terms and the final term's matching prefix. */
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

/** Render matching transcript passages with timestamps and term highlights. */
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
