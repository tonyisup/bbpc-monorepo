import type { FC } from "react";
import Link from "next/link";
import { Trophy } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatPlainDate } from "@/lib/dates";
import { getEpisodePath } from "@/lib/routes";
import type { CompleteEpisode } from "@/types/episode";

import MovieInlinePreview from "./MovieInlinePreview";
import ShowInlinePreview from "./ShowInlinePreview";

interface EpisodeProps {
  episode: CompleteEpisode;
  hasWon?: boolean;
}

export const LatestEpisode: FC<EpisodeProps> = ({ episode, hasWon }) => {
  const sortedAssignments = [...episode.assignments].sort((a, b) => {
    const typeOrder = { HOMEWORK: 0, EXTRA_CREDIT: 1, BONUS: 2 };
    return (
      (typeOrder[a.type as keyof typeof typeOrder] ?? 99) -
      (typeOrder[b.type as keyof typeof typeOrder] ?? 99)
    );
  });

  return (
    <article className="bbpc-panel relative flex w-full min-w-0 flex-col gap-5 overflow-hidden p-4 sm:p-6">
      {hasWon && (
        <Link
          href={getEpisodePath(episode.slug ?? episode.id)}
          className="-mx-4 -mt-4 flex min-h-11 items-center justify-center gap-2 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-400/15 sm:-mx-6 sm:-mt-6"
        >
          <Trophy className="h-4 w-4" aria-hidden="true" />
          You won a gamble. View the results.
        </Link>
      )}

      <div className="grid min-w-0 gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <Link
          href={getEpisodePath(episode.slug ?? episode.id)}
          className="text-sm font-semibold text-zinc-400 hover:text-red-300 sm:order-1"
        >
          Episode {episode.number}
        </Link>
        <h2 className="min-w-0 text-2xl font-black leading-tight tracking-tight sm:order-3 sm:col-span-3 sm:text-4xl">
          <Link
            href={getEpisodePath(episode.slug ?? episode.id)}
            className="hover:text-red-300"
          >
            {episode.title}
          </Link>
        </h2>
        {episode.date && (
          <p className="text-sm text-zinc-400 sm:order-2 sm:text-right">
            {formatPlainDate(episode.date, undefined, "en-US")}
          </p>
        )}
      </div>

      {episode.description && (
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-300 sm:text-base">
          {episode.description}
        </p>
      )}

      <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-auto pb-1">
        {sortedAssignments.map((assignment, index) => (
          <div key={assignment.id} className="flex-none">
            {assignment.movie && (
              <MovieInlinePreview
                movie={assignment.movie}
                responsive
                priority={index === 0}
                imageClassName="h-[108px] w-[72px] rounded-lg sm:h-[162px] sm:w-[108px]"
                sizes="(max-width: 639px) 72px, 108px"
              />
            )}
          </div>
        ))}

        {episode.extras.length > 0 && (
          <div
            className="mx-1 h-20 w-px flex-none bg-white/15 sm:h-32"
            aria-hidden="true"
          />
        )}

        {episode.extras.map((extra) => (
          <div
            key={extra.id}
            className="flex-none opacity-80 transition-opacity hover:opacity-100"
          >
            {extra.review.movie && (
              <MovieInlinePreview
                movie={extra.review.movie}
                responsive
                imageClassName="h-[108px] w-[72px] rounded-lg sm:h-[162px] sm:w-[108px]"
                sizes="(max-width: 639px) 72px, 108px"
              />
            )}
            {extra.review.show && (
              <ShowInlinePreview
                show={extra.review.show}
                responsive
                imageClassName="h-[108px] w-[72px] rounded-lg sm:h-[162px] sm:w-[108px]"
              />
            )}
          </div>
        ))}
      </div>

      {episode.recording && (
        <div className={cn("w-full", !episode.description && "mt-1")}>
          <audio
            controls
            preload="metadata"
            className="block h-11 w-full"
            src={episode.recording}
          >
            Your browser does not support the audio element.
          </audio>
        </div>
      )}
    </article>
  );
};
