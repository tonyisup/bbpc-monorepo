"use client";

import {
  AlertCircle,
  Check,
  ChevronRight,
  EyeOff,
  Info,
  Loader2,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getEpisodePath } from "@/lib/routes";
import {
  countScored,
  SCORECARD_CRITERIA,
  type ScorecardCriterion,
  type ScorecardScores,
} from "@/lib/scorecard";

import { MoviePosterLink } from "./MoviePosterLink";
import { ScoreSlider } from "./ScoreSlider";

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface ScoreCardMovie {
  id: string;
  title: string;
  year: number;
  poster: string | null;
  url: string;
  tmdbId: number | null;
}

export function ScoreCard({
  movie,
  scores,
  myRatingName,
  episode,
  saveState,
  progressText,
  busy,
  canGoNext,
  nextLabel,
  onCommit,
  onNext,
  onSkip,
  onUnseen,
  onClear,
}: {
  movie: ScoreCardMovie;
  scores: ScorecardScores;
  myRatingName: string | null;
  episode: { slug: string; number: number } | null;
  saveState: SaveState;
  progressText: string;
  busy: boolean;
  canGoNext: boolean;
  nextLabel: string;
  onCommit: (criterion: ScorecardCriterion, value: number) => void;
  onNext: () => void;
  onSkip: () => void;
  onUnseen: () => void;
  onClear: () => void;
}) {
  const [openHint, setOpenHint] = useState<ScorecardCriterion | null>(null);
  const scored = countScored(scores);
  const complete = scored === SCORECARD_CRITERIA.length;
  const sum = SCORECARD_CRITERIA.reduce(
    (total, criterion) => total + (scores[criterion.key] ?? 0),
    0
  );

  return (
    <section aria-label={`Score ${movie.title}`} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <MoviePosterLink movie={movie} width={40} height={60} />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{movie.title}</h2>
            <p className="text-xs text-muted-foreground">
              {movie.year}
              {myRatingName && (
                <>
                  {" · Your BBPC rating: "}
                  <span className="text-foreground">{myRatingName}</span>
                </>
              )}
              {episode && (
                <>
                  {" · "}
                  <Link
                    className="underline"
                    href={getEpisodePath(episode.slug)}
                  >
                    Ep {episode.number}
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-2xl font-black tabular-nums" aria-live="polite">
            {complete ? (sum / SCORECARD_CRITERIA.length).toFixed(2) : "–"}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {scored}/9 scored
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{progressText}</span>
        <SaveIndicator state={saveState} />
      </div>

      <ul className="space-y-0.5">
        {SCORECARD_CRITERIA.map((criterion) => (
          <li key={criterion.key}>
            <div className="grid grid-cols-[6.75rem_1fr_1.75rem] items-center gap-2">
              <button
                type="button"
                className="flex min-h-11 items-center gap-1 text-left text-sm font-semibold"
                aria-expanded={openHint === criterion.key}
                onClick={() =>
                  setOpenHint((open) =>
                    open === criterion.key ? null : criterion.key
                  )
                }
              >
                {criterion.label}
                <Info className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
              </button>
              <ScoreSlider
                label={criterion.label}
                value={scores[criterion.key]}
                disabled={busy}
                onCommit={(value) => onCommit(criterion.key, value)}
              />
              <span className="text-right text-sm font-bold tabular-nums">
                {scores[criterion.key] ?? "–"}
              </span>
            </div>
            {openHint === criterion.key && (
              <p className="pb-1 text-xs text-muted-foreground">
                {criterion.hint}
              </p>
            )}
          </li>
        ))}
      </ul>
      {scored === 0 && (
        <p className="text-xs text-muted-foreground">
          Tap or drag a track to score. Tap a name for what it means.
        </p>
      )}

      {/* Right padding keeps the row clear of the site's floating feedback button. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-16 pt-1">
        <Button
          type="button"
          className="min-h-11 flex-1"
          disabled={!canGoNext || busy}
          onClick={onNext}
        >
          {nextLabel}
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
        {!complete && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={onSkip}
          >
            Skip
          </Button>
        )}
      </div>
      <div className="flex items-center gap-4 pr-16 text-sm">
        <button
          type="button"
          disabled={busy}
          onClick={onUnseen}
          className="inline-flex min-h-11 items-center gap-1.5 text-muted-foreground disabled:opacity-50"
        >
          <EyeOff className="h-4 w-4" /> Haven&apos;t seen
        </button>
        <button
          type="button"
          disabled={busy || scored === 0}
          onClick={onClear}
          className="inline-flex min-h-11 items-center gap-1.5 text-muted-foreground disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" /> Clear this movie
        </button>
      </div>
    </section>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-red-400">
        <AlertCircle className="h-3 w-3" /> Not saved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" aria-live="polite">
      {state === "saving" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Check className="h-3 w-3 text-emerald-400" />
      )}
      {state === "saving" ? "Saving" : "Saved"}
    </span>
  );
}
