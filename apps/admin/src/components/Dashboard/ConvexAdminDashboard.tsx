import { useConvex } from "convex/react";
import {
  Calendar,
  Film,
  Loader2,
  Mic2,
  RefreshCw,
  Star,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  type ConvexAdminDashboard as ConvexAdminDashboardData,
  type ConvexAdminEpisode,
  loadConvexAdminDashboard,
} from "@/convex/dashboard";
import { formatInstantLocal, formatPlainDate } from "@/lib/dates";

import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import GuessesGraph from "./GuessesGraph";

interface ConvexAdminDashboardProps {
  userName: string | null;
}

interface CountCardProps {
  label: string;
  value: number;
  description: string;
  icon: React.ReactNode;
}

function CountCard({ label, value, description, icon }: CountCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function EpisodeSummary({
  description,
  episode,
  emptyMessage,
  title,
}: {
  description: string;
  episode: ConvexAdminEpisode | null;
  emptyMessage: string;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {episode === null ? (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-lg font-semibold">
                Episode {episode.number}: {episode.title}
              </span>
              {episode.date !== null && (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  {formatPlainDate(episode.date)}
                </span>
              )}
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {episode.description ?? "No description available."}
            </p>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Assignments
              </p>
              {episode.assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No assignments.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {episode.assignments.map((assignment) => (
                    <div
                      className="rounded-md border p-3 text-sm"
                      key={assignment.id}
                    >
                      <p className="font-medium">
                        {assignment.movie.title} ({assignment.movie.year})
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {assignment.user.name ?? "Unknown user"} ·{" "}
                        {assignment.type}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {episode.extras.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Extras
                </p>
                <div className="flex flex-wrap gap-2">
                  {episode.extras.map((extra) => {
                    const item = extra.review.movie ?? extra.review.show;
                    return (
                      <span
                        className="rounded-full border px-3 py-1 text-xs"
                        key={extra.id}
                      >
                        {item?.title ?? "Unknown title"}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConvexAdminDashboard({ userName }: ConvexAdminDashboardProps) {
  const convex = useConvex();
  const [dashboard, setDashboard] = useState<ConvexAdminDashboardData | null>(
    null
  );
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  const retry = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setError(false);

    void loadConvexAdminDashboard(convex)
      .then((result) => {
        if (active) {
          setDashboard(result);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      });

    return () => {
      active = false;
    };
  }, [convex, revision]);

  if (error) {
    return (
      <Card className="mx-auto mt-12 max-w-xl">
        <CardHeader>
          <CardTitle>Dashboard unavailable</CardTitle>
          <CardDescription>
            The Convex admin overview could not be loaded. No legacy SQL
            fallback was attempted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={retry} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (dashboard === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2
          aria-label="Loading dashboard"
          className="h-8 w-8 animate-spin text-muted-foreground"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Welcome back, {userName ?? "administrator"}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <CountCard
          description="Podcast episodes"
          icon={<Mic2 className="h-4 w-4 text-muted-foreground" />}
          label="Total Episodes"
          value={dashboard.counts.episodes}
        />
        <CountCard
          description="Canonical BBPC accounts"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          label="Users"
          value={dashboard.counts.users}
        />
        <CountCard
          description="Movies in the catalog"
          icon={<Film className="h-4 w-4 text-muted-foreground" />}
          label="Total Movies"
          value={dashboard.counts.movies}
        />
        <CountCard
          description="Reviews submitted"
          icon={<Star className="h-4 w-4 text-muted-foreground" />}
          label="Total Reviews"
          value={dashboard.counts.reviews}
        />
      </div>

      {dashboard.guessStats.length > 0 && (
        <GuessesGraph
          className="col-span-7"
          data={dashboard.guessStats}
          interactive={false}
        />
      )}

      <EpisodeSummary
        description="The most recent published episode."
        emptyMessage="No published episodes found."
        episode={dashboard.latestEpisode}
        title="Latest Episode"
      />
      <EpisodeSummary
        description="The next scheduled or recording episode."
        emptyMessage="No upcoming episodes found."
        episode={dashboard.upcomingEpisode}
        title="Upcoming Episode"
      />

      <Card>
        <CardHeader>
          <CardTitle>Recent Syllabus Additions</CardTitle>
          <CardDescription>
            Latest movies added to user syllabuses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dashboard.latestSyllabus.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No syllabus items found.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {dashboard.latestSyllabus.map((item) => (
                <a
                  className="rounded-md border p-4 transition hover:bg-muted/50"
                  href={item.movie.url}
                  key={item.id}
                  rel="noreferrer"
                  target="_blank"
                >
                  <p className="font-medium">
                    {item.movie.title} ({item.movie.year})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.user.name ?? "Unknown user"} ·{" "}
                    {formatInstantLocal(new Date(item.createdAt))}
                  </p>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
