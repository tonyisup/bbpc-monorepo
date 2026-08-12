import Link from "next/link";

import { Episode } from "@/components/Episode";
import RatingIcon from "@/components/RatingIcon";
import { SeasonStandingsDisclosure } from "@/components/SeasonStandingsDisclosure";
import { getPacificTodayPlainDate } from "@/lib/dates";
import { getNextScheduledEpisode } from "@/server/convex/episodes";
import {
  getConvexCurrentPerformance,
  getConvexPredictionScoring,
} from "@/server/convex/games";

const ruleDetailsClass =
  "group border-b border-white/10 py-1 last:border-b-0 [&_summary::-webkit-details-marker]:hidden";
const summaryClass =
  "flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-3 text-lg font-bold text-white transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500";

async function loadGamePageData() {
  const today = getPacificTodayPlainDate();
  const [episode, predictionScoring, performance] = await Promise.all([
    getNextScheduledEpisode(),
    getConvexPredictionScoring(),
    getConvexCurrentPerformance(today),
  ]);
  return { episode, predictionScoring, performance };
}

export default async function GamePage() {
  const { episode, performance, predictionScoring } = await loadGamePageData();
  const formatPoints = (points: number | null) => {
    if (points === null) return "an unavailable number of points";
    const absolutePoints = Math.abs(points);
    return `${absolutePoints} ${absolutePoints === 1 ? "point" : "points"}`;
  };

  return (
    <div className="bbpc-page max-w-5xl space-y-10">
      <header className="max-w-2xl">
        <p className="bbpc-kicker">Listener competition</p>
        <h1 className="mt-1 text-4xl font-black tracking-tight text-white sm:text-5xl">
          <span title="Who The Fuck Is Reggie">WTFIR</span> Game
        </h1>
        <p className="mt-3 text-base leading-relaxed text-zinc-300">
          Predict the hosts&apos; ratings, send in a memorable quote, and climb
          the season standings.
        </p>
      </header>

      <section aria-labelledby="current-round-heading" className="space-y-4">
        <h2
          id="current-round-heading"
          className="text-2xl font-black text-white sm:text-3xl"
        >
          Play the current round
        </h2>
        {episode ? (
          <Episode episode={episode} showExtras={false} allowGuesses />
        ) : (
          <div className="bbpc-panel p-5 text-zinc-300" role="status">
            No current round is available.
          </div>
        )}
      </section>

      <SeasonStandingsDisclosure data={performance} />

      <section aria-labelledby="rules-heading" className="space-y-4">
        <div>
          <p className="bbpc-kicker">Reference</p>
          <h2
            id="rules-heading"
            className="text-3xl font-black tracking-tight text-white"
          >
            How the game works
          </h2>
        </div>

        <div className="bbpc-panel divide-y divide-white/10 p-2 sm:p-3">
          <details className={ruleDetailsClass} open>
            <summary className={summaryClass}>
              Win the season
              <span aria-hidden="true" className="text-red-300">
                +
              </span>
            </summary>
            <div className="space-y-3 px-3 pb-5 text-zinc-300">
              <p>
                Each season lasts 8 weeks. The player with the most points wins.
              </p>
              <p>
                The winner picks a movie and joins the hosts to discuss it on
                the show.
              </p>
            </div>
          </details>

          <details className={ruleDetailsClass}>
            <summary className={summaryClass}>
              Predict the ratings
              <span aria-hidden="true" className="text-red-300">
                +
              </span>
            </summary>
            <div className="space-y-4 px-3 pb-5 text-zinc-300">
              <p>
                Two movies are assigned for the next episode. Predict the rating
                each host will give each movie.
              </p>
              <p>
                Each correct host rating earns{" "}
                {formatPoints(predictionScoring.correctHost)}. Guessing every
                host correctly earns an additional{" "}
                {formatPoints(predictionScoring.allCorrectBonus)}. Missing every
                host costs {formatPoints(predictionScoring.allIncorrect)}.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { value: 4, label: "Slater", note: "the best" },
                  { value: 3, label: "Dollar", note: "ok" },
                  { value: 2, label: "Waste", note: "not ok" },
                  { value: 1, label: "Goldbloom", note: "the worst" },
                ].map((rating) => (
                  <div
                    key={rating.value}
                    className="flex items-center gap-3 rounded-lg bg-white/[0.04] p-3"
                  >
                    <RatingIcon value={rating.value} />
                    <p>
                      <strong className="text-white">{rating.label}</strong>:{" "}
                      {rating.note}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </details>

          <details className={ruleDetailsClass}>
            <summary className={summaryClass}>
              Submit to Quotabunga
              <span aria-hidden="true" className="text-red-300">
                +
              </span>
            </summary>
            <div className="space-y-3 px-3 pb-5 text-zinc-300">
              <p>
                Each listener may submit one memorable movie or television quote
                per week.
              </p>
              <p>
                With four entries, the hosts play two semifinals and a final.
                With fewer entries, they rank the available quotes directly.
              </p>
              <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-5 gap-y-2 rounded-lg bg-white/[0.04] p-4">
                <dt>First place</dt>
                <dd className="font-bold text-white">40 points</dd>
                <dt>Second place</dt>
                <dd className="font-bold text-white">20 points</dd>
                <dt>Third place</dt>
                <dd className="font-bold text-white">10 points</dd>
              </dl>
              <p>
                You can also email{" "}
                <a
                  href="mailto:badboyspodcasts@gmail.com"
                  className="font-semibold text-red-300 underline"
                >
                  badboyspodcasts@gmail.com
                </a>
                .
              </p>
            </div>
          </details>

          <details className={ruleDetailsClass}>
            <summary className={summaryClass}>
              Earn bonus points
              <span aria-hidden="true" className="text-red-300">
                +
              </span>
            </summary>
            <div className="space-y-3 px-3 pb-5 text-zinc-300">
              <p>
                A committed accent or impersonation can earn 1 point at the Game
                Master&apos;s discretion.
              </p>
              <p>
                It must last for most of one movie message and cannot carry into
                the next movie.
              </p>
              <p>
                Phone and voice messages may unlock bonuses that are not
                available through the website.
              </p>
            </div>
          </details>

          <details className={ruleDetailsClass}>
            <summary className={summaryClass}>
              Assignments and the wheel
              <span aria-hidden="true" className="text-red-300">
                +
              </span>
            </summary>
            <div className="space-y-3 px-3 pb-5 text-zinc-300">
              <p>
                Homework is a movie none of the hosts have seen. Extra Credit is
                a movie at least one host has seen.
              </p>
              <p>
                The wheel selects the next assignment from host entries and the
                week&apos;s top player.
              </p>
              <p>
                A winning player assignment comes from that listener&apos;s{" "}
                <Link
                  href="/syllabus"
                  className="font-semibold text-red-300 underline"
                >
                  syllabus
                </Link>
                .
              </p>
            </div>
          </details>

          <details className={ruleDetailsClass}>
            <summary className={summaryClass}>
              Gambling and fine print
              <span aria-hidden="true" className="text-red-300">
                +
              </span>
            </summary>
            <div className="space-y-4 px-3 pb-5 text-zinc-300">
              <p>
                For each assignment, wager points on specific host outcomes.
              </p>
              <dl className="grid gap-3 rounded-lg bg-white/[0.04] p-4 sm:grid-cols-[auto_1fr]">
                <dt className="font-bold text-white">1x multiplier</dt>
                <dd>Guess one host&apos;s rating.</dd>
                <dt className="font-bold text-white">2x multiplier</dt>
                <dd>Guess a pair of hosts&apos; ratings.</dd>
                <dt className="font-bold text-white">3x multiplier</dt>
                <dd>Guess all three hosts&apos; ratings.</dd>
              </dl>
              <p>
                A winning bet returns the wager plus the points wagered
                multiplied by the bet multiplier. A losing bet loses the points
                wagered.
              </p>
              <p>
                <strong className="text-white">Bonus Harley:</strong> on a phone
                or voice-message wager of all your points, a win earns 4 extra
                points before the wager is doubled or tripled.
              </p>
              <p>
                Confirmed bets are locked. Before January 12, 2026, the retired
                format used a 1x return for guessing all three hosts&apos;
                ratings.
              </p>
              <p>
                Missing two episodes in a row begins a 1-point penalty for each
                additional missed episode. If the season ends in a tie, the
                player who earned the most points in the final episode wins.
              </p>
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}
