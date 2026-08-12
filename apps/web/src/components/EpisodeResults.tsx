"use client";

import { Trophy, Target, Coins } from "lucide-react";
import Image from "next/image";
import RatingIcon from "./RatingIcon";
import type { EpisodeResultsData } from "@/types/episode";

interface EpisodeResultsProps {
  results: EpisodeResultsData;
}

export default function EpisodeResults({ results }: EpisodeResultsProps) {
  const { gamblingWinners, guessWinners } = results;

  if (gamblingWinners.length === 0 && guessWinners.length === 0) {
    return null;
  }

  return (
    <div className="mt-12 space-y-8 duration-700 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex items-center gap-3 border-l-4 border-yellow-500 pl-4">
        <Trophy className="h-8 w-8 text-yellow-500" />
        <h2 className="text-3xl font-black uppercase tracking-tighter text-white">
          Episode Results
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Winning Gambles */}
        {gamblingWinners.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-purple-400">
              <Coins className="h-4 w-4" />
              Big Winners (Gambles)
            </div>
            <div className="grid gap-3">
              {gamblingWinners.map((win) => (
                <div
                  key={win.id}
                  className="group flex items-center gap-4 rounded-xl border border-purple-500/20 bg-purple-900/10 p-3 backdrop-blur-sm transition-all hover:bg-purple-900/20"
                >
                  <div className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded shadow-lg transition-transform group-hover:scale-105">
                    {win.movie.poster && (
                      <Image
                        src={win.movie.poster}
                        alt={win.movie.title}
                        fill
                        className="object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-bold text-white">
                        {win.user.name}
                      </span>
                      <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-purple-300">
                        +{Math.floor(win.points * win.gamblingType.multiplier)}{" "}
                        PTS
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-400">
                      on{" "}
                      <span className="font-medium text-gray-300">
                        {win.movie.title}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-purple-400/70">
                      {win.gamblingType.title}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Winning Guesses */}
        {guessWinners.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-400">
              <Target className="h-4 w-4" />
              Sharp Shooters (Guesses)
            </div>
            <div className="grid gap-3">
              {guessWinners.map((guess) => (
                <div
                  key={guess.id}
                  className="group flex items-center gap-4 rounded-xl border border-indigo-500/20 bg-indigo-900/10 p-3 backdrop-blur-sm transition-all hover:bg-indigo-900/20"
                >
                  <div className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded shadow-lg transition-transform group-hover:scale-105">
                    {guess.movie.poster && (
                      <Image
                        src={guess.movie.poster}
                        alt={guess.movie.title}
                        fill
                        className="object-cover opacity-40 grayscale-[0.5] transition-all group-hover:opacity-60 group-hover:grayscale-0"
                      />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center transition-transform group-hover:rotate-12">
                      <RatingIcon value={guess.actualRating} />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-bold text-white">
                        {guess.user.name}
                      </span>
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-300">
                        CORRECT
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-gray-400">
                      Predicted{" "}
                      <span className="font-medium text-gray-300">
                        {guess.host.name ?? "Host"}&apos;s
                      </span>{" "}
                      rating
                    </div>
                    <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-indigo-400/70">
                      for {guess.movie.title}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
