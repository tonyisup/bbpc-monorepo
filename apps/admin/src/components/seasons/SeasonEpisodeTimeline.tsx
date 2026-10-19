import Link from "next/link";

import type { ConvexAdminSeasonTimelineEpisode } from "@/convex/seasonDetails";
import { formatPlainDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

import { initials, plural } from "./activityFormat";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/30 p-3">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="text-lg font-black">{value}</dd>
      <dd className="text-xs text-muted-foreground">{detail}</dd>
    </div>
  );
}

function EpisodeHeading({
  episode,
}: {
  episode: ConvexAdminSeasonTimelineEpisode["episode"];
}) {
  const heading = (
    <h3 className="min-w-0 truncate text-sm font-black">
      <span className="text-primary">Episode {episode.number}</span>
      <span className="font-medium text-muted-foreground">
        {" "}
        · {episode.title}
      </span>
    </h3>
  );
  if (episode.slug === null) {
    return heading;
  }
  return (
    <Link
      className="min-w-0 rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href={`/episode/${encodeURIComponent(episode.slug)}`}
    >
      {heading}
    </Link>
  );
}

/**
 * One card per episode of the season so far, newest first, summing the game
 * activity each episode produced.
 */
export function SeasonEpisodeTimeline({
  episodes,
  episodeCount,
}: {
  episodes: ConvexAdminSeasonTimelineEpisode[];
  episodeCount: number | null;
}) {
  return (
    <ol className="space-y-4">
      {episodes.map((entry, index) => {
        // The list holds every episode since the season began, newest first.
        const position = episodes.length - index;
        const { points, guesses, wagers, quotes, players } = entry;
        const hasActivity =
          points.count + guesses.count + wagers.count + quotes.count > 0;
        return (
          <li key={entry.episode.id}>
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <EpisodeHeading episode={entry.episode} />
                  <div className="flex shrink-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Badge variant="outline">
                      #{position}
                      {episodeCount === null ? "" : ` of ${episodeCount}`}
                    </Badge>
                    {formatPlainDate(entry.episode.date)}
                  </div>
                </div>
                {hasActivity ? (
                  <>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat
                        label="Points"
                        value={signed(points.total)}
                        detail={plural(points.count, "award", "awards")}
                      />
                      <Stat
                        label="Guesses"
                        value={String(guesses.count)}
                        detail={`${guesses.scored} scored`}
                      />
                      <Stat
                        label="Wagers"
                        value={String(wagers.count)}
                        detail={`${wagers.pointsWagered} pts · ${wagers.won} won · ${wagers.lost} lost`}
                      />
                      <Stat
                        label="Quotes"
                        value={String(quotes.count)}
                        detail="submitted"
                      />
                    </dl>
                    {players.length > 0 && (
                      <ul
                        aria-label="Points by player"
                        className="flex flex-wrap gap-2"
                      >
                        {players.map(({ user, total }) => (
                          <li
                            className="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3"
                            key={user.id}
                          >
                            <Avatar className="h-6 w-6">
                              <AvatarImage src={user.image ?? ""} />
                              <AvatarFallback className="text-[10px]">
                                {initials(user.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-xs font-bold">
                              {user.name ?? "Unnamed user"}
                            </span>
                            <span
                              className={cn(
                                "font-mono text-xs font-bold",
                                total > 0 && "text-emerald-700",
                                total < 0 && "text-rose-700",
                                total === 0 && "text-muted-foreground"
                              )}
                            >
                              {signed(total)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No game activity recorded for this episode.
                  </p>
                )}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
