import { LatestEpisode } from "@/components/LatestEpisode";
import { Episode } from "@/components/Episode";
import { EpisodeSkeleton } from "@/components/EpisodeSkeleton";
import { Suspense } from "react";
import {
  getLatestPublishedEpisode,
  getNextScheduledEpisode,
} from "@/server/convex/episodes";
import { hasSignedInUserWonForEpisode } from "@/server/convex/gambling";
import { getPacificTodayPlainDate } from "@/lib/dates";

async function loadHomeEpisode() {
  const [latestEpisode, nextEpisode] = await Promise.all([
    getLatestPublishedEpisode(getPacificTodayPlainDate()),
    getNextScheduledEpisode(),
  ]);
  return {
    latestEpisode,
    nextEpisode,
    hasWon:
      latestEpisode === null
        ? false
        : await hasSignedInUserWonForEpisode(latestEpisode.id),
  };
}

export default async function HomePage() {
  const { latestEpisode, nextEpisode, hasWon } =
    await loadHomeEpisode();
  return (
    <div className="bbpc-page space-y-12 text-white">
      <section aria-labelledby="latest-episode-heading" className="space-y-4">
        <div>
          <p className="bbpc-kicker">Listen now</p>
          <h1
            id="latest-episode-heading"
            className="text-3xl font-black tracking-tight sm:text-4xl"
          >
            Latest episode
          </h1>
        </div>
        <Suspense fallback={<EpisodeSkeleton />}>
          {latestEpisode && (
            <LatestEpisode episode={latestEpisode} hasWon={hasWon} />
          )}
        </Suspense>
      </section>

      <section aria-labelledby="up-next-heading" className="space-y-4">
        <div>
          <p className="bbpc-kicker">Play this week</p>
          <h2
            id="up-next-heading"
            className="text-3xl font-black tracking-tight sm:text-4xl"
          >
            Up next
          </h2>
        </div>
        <Suspense fallback={<EpisodeSkeleton />}>
          {nextEpisode && <Episode episode={nextEpisode} allowGuesses={true} />}
        </Suspense>
      </section>
    </div>
  );
}
