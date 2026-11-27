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

export interface ScoreCardProps {
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
}

/** All nine criteria as a list of sliders. */
export function ScoreCard(props: ScoreCardProps) {
  const { movie, scores, busy, onCommit } = props;
  const [openHint, setOpenHint] = useState<ScorecardCriterion | null>(null);
  const scored = countScored(scores);

  return (
    <section aria-label={`Score ${movie.title}`} className="space-y-3">
      <ScoreCardHeader {...props} />

      <ul>
        {SCORECARD_CRITERIA.map((criterion) => (
          <li key={criterion.key}>
            <div className="grid grid-cols-[6.75rem_1fr_1.75rem] items-center gap-2">
              <button
                type="button"
                className="flex min-h-10 items-center gap-1 text-left text-sm font-semibold"
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

      <ScoreCardActions {...props} />
    </section>
  );
}

/** Poster, title, running average, progress and save state. */
export function ScoreCardHeader({
  movie,
  scores,
  myRatingName,
  episode,
  saveState,
  progressText,
}: ScoreCardProps) {
  const scored = countScored(scores);
  const complete = scored === SCORECARD_CRITERIA.length;
  const sum = SCORECARD_CRITERIA.reduce(
    (total, criterion) => total + (scores[criterion.key] ?? 0),
    0
  );

  return (
    <>
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
            <p className="text-xs text-muted-foreground">{progressText}</p>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-2xl font-black tabular-nums" aria-live="polite">
            {complete ? (sum / SCORECARD_CRITERIA.length).toFixed(2) : "–"}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {scored}/9 scored
          </p>
          <p className="text-xs text-muted-foreground">
            <SaveIndicator state={saveState} />
          </p>
        </div>
      </div>
    </>
  );
}

/** Next movie, Skip, Haven't seen and Clear. */
export function ScoreCardActions({
  scores,
  busy,
  canGoNext,
  nextLabel,
  onNext,
  onSkip,
  onUnseen,
  onClear,
}: ScoreCardProps) {
  const scored = countScored(scores);
  const complete = scored === SCORECARD_CRITERIA.length;

  return (
    // One row, so the whole card fits on a phone screen. The right padding
    // keeps it clear of the site's floating feedback button; on a phone the
    // two movie-level actions show as icons, with their names for screen readers.
    <div className="flex flex-wrap items-center gap-1.5 pr-16 pt-1 sm:gap-3">
      <Button
        type="button"
        className="min-h-11 flex-1 px-3"
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
          className="min-h-11 px-3 sm:px-4"
          disabled={busy}
          onClick={onSkip}
        >
          Skip
        </Button>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={onUnseen}
        title="Haven't seen"
        className="inline-flex min-h-11 min-w-10 items-center justify-center gap-1.5 text-sm text-muted-foreground disabled:opacity-50"
      >
        <EyeOff className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">Haven&apos;t seen</span>
      </button>
      <button
        type="button"
        disabled={busy || scored === 0}
        onClick={onClear}
        title="Clear this movie"
        className="inline-flex min-h-11 min-w-10 items-center justify-center gap-1.5 text-sm text-muted-foreground disabled:opacity-50"
      >
        <RotateCcw className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">Clear this movie</span>
      </button>
    </div>
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
