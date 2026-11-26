"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  SCORECARD_CRITERIA,
  SCORECARD_MAX_SCORE,
  SCORECARD_MIN_SCORE,
} from "@/lib/scorecard";
import {
  scorecardIllustrationCaption,
  scorecardIllustrationSrc,
} from "@/lib/scorecard-illustrations";

import {
  ScoreCardActions,
  ScoreCardHeader,
  type ScoreCardProps,
} from "./ScoreCard";
import { ScoreSlider } from "./ScoreSlider";

const SCORES = Array.from(
  { length: SCORECARD_MAX_SCORE - SCORECARD_MIN_SCORE + 1 },
  (_, index) => SCORECARD_MIN_SCORE + index
);

/**
 * One criterion at a time, with a picture of what the score means above the
 * slider. The picture follows the slider while dragging; the score saves on
 * release, exactly as in the list view.
 */
export function IllustratedScoreCard(props: ScoreCardProps) {
  const { movie, scores, busy, onCommit } = props;
  const [step, setStep] = useState(() => {
    const firstUnscored = SCORECARD_CRITERIA.findIndex(
      (criterion) => scores[criterion.key] === undefined
    );
    return firstUnscored === -1 ? 0 : firstUnscored;
  });
  const [preview, setPreview] = useState<number | null>(null);
  const criterion = SCORECARD_CRITERIA[step] ?? SCORECARD_CRITERIA[0];
  const shown = preview ?? scores[criterion.key];
  const next = SCORECARD_CRITERIA[step + 1];

  // Warm this criterion's ten images (and the next one's) so dragging swaps instantly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    for (const key of [criterion.key, next?.key]) {
      if (!key) continue;
      for (const score of SCORES) {
        const image = new window.Image();
        image.src = scorecardIllustrationSrc(key, score);
      }
    }
  }, [criterion.key, next?.key]);

  const goToStep = (index: number) => {
    setPreview(null);
    setStep(index);
  };

  return (
    <section aria-label={`Score ${movie.title}`} className="space-y-3">
      <ScoreCardHeader {...props} />

      <nav aria-label="Criteria" className="grid grid-cols-9 gap-1">
        {SCORECARD_CRITERIA.map((item, index) => {
          const value = scores[item.key];
          return (
            <button
              key={item.key}
              type="button"
              aria-current={index === step ? "step" : undefined}
              aria-label={`${item.label}: ${
                value === undefined ? "not scored" : String(value)
              }`}
              onClick={() => goToStep(index)}
              className={`flex min-h-11 flex-col items-center justify-center rounded tabular-nums leading-tight ${
                index === step
                  ? "bg-amber-400 text-zinc-950"
                  : value === undefined
                  ? "border border-dashed border-zinc-700 text-muted-foreground"
                  : "bg-zinc-800 text-zinc-100"
              }`}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide opacity-80">
                {item.label.slice(0, 3)}
              </span>
              <span className="text-sm font-black">{value ?? "–"}</span>
            </button>
          );
        })}
      </nav>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xl font-black">{criterion.label}</h3>
          <span className="text-xs text-muted-foreground">
            {step + 1} of {SCORECARD_CRITERIA.length}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{criterion.hint}</p>
      </div>

      <figure className="space-y-2">
        {/* Capped at 40% of the screen height so the slider stays in view on a phone. */}
        <div className="relative mx-auto aspect-[672/496] w-full max-w-[calc(40svh*672/496)] overflow-hidden rounded-lg bg-zinc-900">
          {shown === undefined ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-zinc-700 p-6 text-center text-sm text-muted-foreground">
              Drag the slider to see what each score looks like.
            </div>
          ) : (
            <Image
              src={scorecardIllustrationSrc(criterion.key, shown)}
              alt={scorecardIllustrationCaption(criterion.key, shown)}
              width={672}
              height={496}
              sizes="(max-width: 672px) 100vw, 672px"
              unoptimized
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <figcaption
          className="flex min-h-7 items-baseline gap-2"
          aria-live="polite"
        >
          {shown !== undefined && (
            <>
              <span className="text-2xl font-black tabular-nums text-amber-400">
                {shown}
              </span>
              <span className="text-sm">
                {scorecardIllustrationCaption(criterion.key, shown)}
              </span>
            </>
          )}
        </figcaption>
      </figure>

      <div>
        <ScoreSlider
          key={criterion.key}
          label={criterion.label}
          value={scores[criterion.key]}
          disabled={busy}
          onCommit={(value) => onCommit(criterion.key, value)}
          onPreview={setPreview}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{SCORECARD_MIN_SCORE}</span>
          <span>{SCORECARD_MAX_SCORE}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={step === 0}
          onClick={() => goToStep(step - 1)}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        {next && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11 flex-1"
            onClick={() => goToStep(step + 1)}
          >
            Next: {next.label}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>

      <ScoreCardActions {...props} />
    </section>
  );
}
