"use client";

// PROTOTYPE ONLY (issue #94). Question: does scoring a movie on 9 criteria
// feel fast and clear on a phone (375px)? Three structurally different cards:
//   A "Stacked rows"  - all 9 criteria, each a 2x5 grid of buttons, scroll.
//   B "One at a time" - one criterion fills the card, tap advances.
//   C "Sliders"       - all 9 on one screen as compact 1-10 sliders.
// Real /year movies; scores live in memory only. No tests, no polish.

import { useConvex } from "convex/react";
import { Check, ChevronRight, EyeOff, Loader2, RotateCcw } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PrototypeSwitcher } from "@/components/PrototypeSwitcher";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { type ConvexYearReview, listConvexYearReviews } from "@/convex/year";
import { getEpisodePath } from "@/lib/routes";

const CRITERIA = [
  { key: "story", label: "Story", hint: "Plot, structure and payoff: does it hold together?" },
  { key: "performance", label: "Performance", hint: "Acting: do you believe these people?" },
  { key: "emotion", label: "Emotion", hint: "Did it make you feel something, and did it earn it?" },
  { key: "visual", label: "Visual", hint: "Cinematography, effects, production design." },
  { key: "audio", label: "Audio", hint: "Score, soundtrack, sound design, mix." },
  { key: "importance", label: "Importance", hint: "Does it matter beyond entertainment: culture, craft, message?" },
  { key: "engagement", label: "Engagement", hint: "Were you locked in, or checking your phone?" },
  { key: "fun", label: "Fun", hint: "How good a time was it?" },
  { key: "replay", label: "Replay", hint: "Would you happily watch it again?" },
] as const;
type Criterion = (typeof CRITERIA)[number]["key"];
type Scores = Partial<Record<Criterion, number>>;
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const VARIANTS = [
  { key: "A", name: "Stacked rows" },
  { key: "B", name: "One at a time" },
  { key: "C", name: "Sliders" },
];

type QueueMovie = {
  id: string;
  title: string;
  year: number;
  poster: string | null;
  firstReviewedAt: number;
  episode: { slug: string | null; number: number } | null;
  myRating: { name: string; value: number } | null;
};

function filledCount(scores: Scores | undefined) {
  return CRITERIA.filter((c) => scores?.[c.key] !== undefined).length;
}

// ---------------------------------------------------------------------------
// Shared in-memory state (what the real page would get from scorecard.mine).

function useScorecardStub(movies: QueueMovie[]) {
  const [scores, setScores] = useState<Record<string, Scores>>({});
  const [unseen, setUnseen] = useState<Set<string>>(new Set());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const queue = useMemo(
    () =>
      movies.filter(
        (m) => !unseen.has(m.id) && (filledCount(scores[m.id]) < 9 || m.id === currentId)
      ),
    [movies, scores, unseen, currentId]
  );
  const current = movies.find((m) => m.id === currentId) ?? queue[0] ?? null;

  useEffect(() => {
    if (currentId === null && queue[0]) setCurrentId(queue[0].id);
  }, [currentId, queue]);

  const nextAfter = useCallback(
    (id: string, extraUnseen?: string) => {
      const candidates = movies.filter(
        (m) =>
          m.id !== id &&
          m.id !== extraUnseen &&
          !unseen.has(m.id) &&
          filledCount(scores[m.id]) < 9
      );
      const index = movies.findIndex((m) => m.id === id);
      const after = candidates.find((m) => movies.indexOf(m) > index) ?? candidates[0];
      return after?.id ?? null;
    },
    [movies, scores, unseen]
  );

  const fakeSave = () => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveState("saved"), 350);
  };

  const setScore = (movieId: string, criterion: Criterion, value: number) => {
    const before = filledCount(scores[movieId]);
    const nextScores = { ...scores[movieId], [criterion]: value };
    setScores((all) => ({ ...all, [movieId]: nextScores }));
    fakeSave();
    // Auto-advance only when the 9th criterion is first filled.
    if (before === 8 && filledCount(nextScores) === 9) {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      advanceTimer.current = setTimeout(() => setCurrentId(nextAfter(movieId)), 700);
    }
  };

  return {
    movies,
    scores,
    unseen,
    queue,
    current,
    saveState,
    setScore,
    skip: () => current && setCurrentId(nextAfter(current.id)),
    markUnseen: () => {
      if (!current) return;
      const next = nextAfter(current.id, current.id);
      setUnseen((set) => new Set(set).add(current.id));
      setCurrentId(next);
    },
    restore: (id: string) =>
      setUnseen((set) => {
        const copy = new Set(set);
        copy.delete(id);
        return copy;
      }),
    clear: () => {
      if (!current) return;
      setScores((all) => {
        const copy = { ...all };
        delete copy[current.id];
        return copy;
      });
      fakeSave();
    },
    jumpTo: (id: string) => setCurrentId(id),
  };
}
type Stub = ReturnType<typeof useScorecardStub>;

// ---------------------------------------------------------------------------
// Pieces every variant may use (header only; layouts are per variant).

function MovieHeader({ movie, compact = false }: { movie: QueueMovie; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {movie.poster ? (
        <Image
          src={movie.poster}
          alt=""
          width={compact ? 40 : 56}
          height={compact ? 60 : 84}
          className={compact ? "h-[60px] w-10 rounded object-cover" : "h-[84px] w-14 rounded object-cover shadow"}
        />
      ) : (
        <div className={compact ? "h-[60px] w-10 rounded bg-zinc-800" : "h-[84px] w-14 rounded bg-zinc-800"} />
      )}
      <div className="min-w-0">
        <p className={compact ? "truncate text-base font-bold" : "text-lg font-black leading-tight"}>
          {movie.title}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          {movie.year}
          {movie.myRating && <> · Your BBPC rating: <span className="text-zinc-200">{movie.myRating.name}</span></>}
          {movie.episode?.slug && (
            <>
              {" · "}
              <Link className="underline" href={getEpisodePath(movie.episode.slug)}>
                Ep {movie.episode.number}
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function SaveBadge({ state }: { state: Stub["saveState"] }) {
  if (state === "idle") return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
      {state === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 text-emerald-400" />}
      {state === "saving" ? "Saving" : "Saved"}
    </span>
  );
}

function SecondaryActions({ stub }: { stub: Stub }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <button type="button" onClick={stub.markUnseen} className="inline-flex min-h-11 items-center gap-1.5 text-zinc-400">
        <EyeOff className="h-4 w-4" /> Haven&apos;t seen
      </button>
      <button type="button" onClick={stub.clear} className="inline-flex min-h-11 items-center gap-1.5 text-zinc-400">
        <RotateCcw className="h-4 w-4" /> Clear
      </button>
      <button type="button" onClick={stub.skip} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-zinc-700 px-3 font-semibold">
        Skip <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function Progress({ stub }: { stub: Stub }) {
  const done = stub.movies.filter((m) => filledCount(stub.scores[m.id]) === 9).length;
  return (
    <p className="text-xs text-zinc-400">
      {done} of {stub.movies.length - stub.unseen.size} scored · {stub.queue.length} to go
    </p>
  );
}

// ---------------------------------------------------------------------------
// Variant A: Stacked rows. Every criterion visible, 2x5 grid of buttons each.

function VariantA({ stub, movie }: { stub: Stub; movie: QueueMovie }) {
  const scores = stub.scores[movie.id] ?? {};
  return (
    <div className="pb-28">
      <div className="space-y-2 px-4">
        <div className="flex items-center justify-between">
          <Progress stub={stub} />
          <SaveBadge state={stub.saveState} />
        </div>
        <MovieHeader movie={movie} />
      </div>
      <div className="mt-4 divide-y divide-zinc-800 border-y border-zinc-800">
        {CRITERIA.map((criterion) => (
          <div key={criterion.key} className="px-4 py-3">
            <div className="flex items-baseline justify-between">
              <p className="font-bold">{criterion.label}</p>
              <p className="text-sm tabular-nums text-zinc-400">{scores[criterion.key] ?? "–"}</p>
            </div>
            <p className="text-xs text-zinc-500">{criterion.hint}</p>
            <div className="mt-2 grid grid-cols-5 gap-1.5">
              {VALUES.map((value) => {
                const selected = scores[criterion.key] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => stub.setScore(movie.id, criterion.key, value)}
                    className={`h-10 rounded-md border text-sm font-semibold tabular-nums ${
                      selected ? "border-amber-400 bg-amber-400 text-black" : "border-zinc-700 bg-zinc-900"
                    }`}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-zinc-950/95 px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-1 backdrop-blur">
        <p className="text-center text-xs text-zinc-500">{filledCount(scores)} of 9 scored</p>
        <SecondaryActions stub={stub} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant B: One at a time. Big number pad; tap moves to the next criterion.

function VariantB({ stub, movie }: { stub: Stub; movie: QueueMovie }) {
  const scores = stub.scores[movie.id] ?? {};
  const firstEmpty = CRITERIA.findIndex((c) => scores[c.key] === undefined);
  const [step, setStep] = useState(Math.max(0, firstEmpty));
  useEffect(() => {
    const empty = CRITERIA.findIndex((c) => (stub.scores[movie.id] ?? {})[c.key] === undefined);
    setStep(Math.max(0, empty));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie.id]);
  const criterion = CRITERIA[step] ?? CRITERIA[0];

  const choose = (value: number) => {
    stub.setScore(movie.id, criterion.key, value);
    const after = { ...scores, [criterion.key]: value };
    const nextEmpty = CRITERIA.findIndex((c, index) => index > step && after[c.key] === undefined);
    const anyEmpty = CRITERIA.findIndex((c) => after[c.key] === undefined);
    if (nextEmpty !== -1) setStep(nextEmpty);
    else if (anyEmpty !== -1) setStep(anyEmpty);
  };

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] w-full min-w-0 flex-col px-4 pb-4">
      <div className="flex items-center justify-between">
        <Progress stub={stub} />
        <SaveBadge state={stub.saveState} />
      </div>
      <div className="mt-2">
        <MovieHeader movie={movie} compact />
      </div>
      <div className="-mx-4 mt-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-1">
        {CRITERIA.map((c, index) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setStep(index)}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
              index === step
                ? "border-amber-400 text-amber-300"
                : scores[c.key] !== undefined
                  ? "border-zinc-600 bg-zinc-800 text-zinc-200"
                  : "border-zinc-800 text-zinc-500"
            }`}
          >
            {c.label} {scores[c.key] ?? ""}
          </button>
        ))}
      </div>
      <div className="mt-6 text-center">
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          {step + 1} / 9
        </p>
        <p className="mt-1 text-3xl font-black">{criterion.label}</p>
        <p className="mx-auto mt-2 max-w-xs text-sm text-zinc-400">{criterion.hint}</p>
      </div>
      <div className="mt-6 grid grid-cols-5 gap-2">
        {VALUES.map((value) => {
          const selected = scores[criterion.key] === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => choose(value)}
              className={`h-14 rounded-xl text-xl font-black tabular-nums ${
                selected ? "bg-amber-400 text-black" : "bg-zinc-800 active:bg-zinc-700"
              }`}
            >
              {value}
            </button>
          );
        })}
      </div>
      <div className="mt-auto pt-6">
        <SecondaryActions stub={stub} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variant C: Sliders. All 9 on one screen; drag or tap a track position.

function VariantC({ stub, movie }: { stub: Stub; movie: QueueMovie }) {
  const scores = stub.scores[movie.id] ?? {};
  const filled = filledCount(scores);
  const sum = CRITERIA.reduce((total, c) => total + (scores[c.key] ?? 0), 0);
  return (
    <div className="px-4 pb-6">
      <div className="flex items-start justify-between gap-3">
        <MovieHeader movie={movie} compact />
        <div className="shrink-0 text-right">
          <p className="text-2xl font-black tabular-nums">{filled === 9 ? (sum / 9).toFixed(2) : "–"}</p>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">{filled}/9</p>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <Progress stub={stub} />
        <SaveBadge state={stub.saveState} />
      </div>
      <div className="mt-3 space-y-1">
        {CRITERIA.map((criterion) => {
          const value = scores[criterion.key];
          return (
            <label key={criterion.key} className="grid grid-cols-[6.5rem_1fr_1.75rem] items-center gap-2 py-1.5" title={criterion.hint}>
              <span className="truncate text-sm font-semibold">{criterion.label}</span>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={value ?? 5}
                aria-label={criterion.label}
                onChange={(event) => stub.setScore(movie.id, criterion.key, Number(event.target.value))}
                onClick={(event) => stub.setScore(movie.id, criterion.key, Number((event.target as HTMLInputElement).value))}
                className={`h-8 w-full ${value === undefined ? "opacity-25 grayscale" : "accent-amber-400"}`}
              />
              <span className="text-right text-sm font-bold tabular-nums">{value ?? "–"}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-xs text-zinc-500">Faded sliders are unscored. Tap or drag to set.</p>
      <div className="mt-3">
        <SecondaryActions stub={stub} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatePanel({ stub }: { stub: Stub }) {
  return (
    <details className="mx-4 mt-6 rounded border border-dashed border-fuchsia-500/60 p-2 text-xs text-fuchsia-200">
      <summary>Prototype state (in memory, nothing saved)</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
        {JSON.stringify(
          {
            current: stub.current?.title ?? null,
            queue: stub.queue.map((m) => m.title),
            unseen: stub.movies.filter((m) => stub.unseen.has(m.id)).map((m) => m.title),
            scored: Object.fromEntries(
              stub.movies
                .filter((m) => stub.scores[m.id])
                .map((m) => [m.title, stub.scores[m.id]])
            ),
          },
          null,
          2
        )}
      </pre>
      {stub.unseen.size > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {stub.movies
            .filter((m) => stub.unseen.has(m.id))
            .map((m) => (
              <button key={m.id} type="button" className="rounded border border-fuchsia-500/60 px-2 py-1" onClick={() => stub.restore(m.id)}>
                Restore {m.title}
              </button>
            ))}
        </div>
      )}
    </details>
  );
}

function toQueue(reviews: ConvexYearReview[], appUserId: string | null): QueueMovie[] {
  const byMovie = new Map<string, QueueMovie>();
  for (const review of reviews) {
    const existing = byMovie.get(review.movie.id);
    const mine =
      appUserId !== null && review.user?.id === appUserId && review.rating
        ? { name: review.rating.name, value: review.rating.value }
        : null;
    if (!existing) {
      byMovie.set(review.movie.id, {
        id: review.movie.id,
        title: review.movie.title,
        year: review.movie.year,
        poster: review.movie.poster,
        firstReviewedAt: review.reviewedAt,
        episode: review.episode ? { slug: review.episode.slug, number: review.episode.number } : null,
        myRating: mine,
      });
    } else {
      if (review.reviewedAt < existing.firstReviewedAt) existing.firstReviewedAt = review.reviewedAt;
      existing.myRating ??= mine;
    }
  }
  return [...byMovie.values()].sort((a, b) => a.firstReviewedAt - b.firstReviewedAt);
}

export function ScorecardPrototype() {
  const convex = useConvex();
  const searchParams = useSearchParams();
  const { user } = useBbpcAuth();
  const variant = searchParams.get("variant") ?? "A";
  const year = Number(searchParams.get("y") ?? "2026");
  const [reviews, setReviews] = useState<ConvexYearReview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setReviews(null);
    setLoadError(null);
    void listConvexYearReviews(convex, year).then(setReviews, (error: unknown) => {
      setLoadError(String(error).slice(0, 200));
      setReviews([]);
    });
  }, [convex, year]);

  const movies = useMemo(
    () => (reviews ? toQueue(reviews, user?.appUserId ?? null) : []),
    [reviews, user?.appUserId]
  );
  const stub = useScorecardStub(movies);
  const movie = stub.current;

  return (
    <div className="mx-auto w-full max-w-md pt-12 text-zinc-100">
      <PrototypeSwitcher variants={VARIANTS} />
      <p className="px-4 pb-2 text-[11px] uppercase tracking-widest text-zinc-500">
        Scorecard {year} · Score tab
      </p>
      {loadError ? (
        <p className="px-4 text-sm text-red-300">Couldn&apos;t load /year movies: {loadError}</p>
      ) : reviews === null ? (
        <p className="px-4 text-sm text-zinc-400">Loading {year} movies…</p>
      ) : movie === null ? (
        <p className="px-4 text-sm text-zinc-400">
          All scored, or no /year movies for {year}.
        </p>
      ) : (
        <>
          {variant === "A" && <VariantA stub={stub} movie={movie} />}
          {variant === "B" && <VariantB key={movie.id} stub={stub} movie={movie} />}
          {variant === "C" && <VariantC stub={stub} movie={movie} />}
        </>
      )}
      <StatePanel stub={stub} />
    </div>
  );
}
