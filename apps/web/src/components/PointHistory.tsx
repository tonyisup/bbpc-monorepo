'use client'

import Link from "next/link";
import { Trophy } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { formatInstantLocal, parsePlainDate, toPlainDateString } from "@/lib/dates";
import { getEpisodePath } from "@/lib/routes";

/**
 * Represents an episode of the show.
 */
interface Episode {
  id: string;
  slug?: string | null;
  title: string;
  number: number;
}

/**
 * Represents a movie analyzed in an episode.
 */
interface Movie {
  title: string;
}

/**
 * Represents an assignment consisting of an episode and a movie.
 */
interface Assignment {
  id: string;
  episode: Episode;
  movie: Movie;
}

/**
 * Represents a season.
 */
interface Season {
  id: string;
  title: string;
  startedOn: string | null;
  endedOn: string | null;
}

/**
 * Represents a point entry for a user, which can be linked to assignments, gambles, or guesses.
 */
interface Point {
  id: string;
  reason: string | null;
  earnedOn: Date | string;
  adjustment: number | null;
  season: Season | null;
  gamePointType: {
    title: string;
    points: number;
    description: string | null;
  } | null;
  assignmentPoints: {
    assignment: Assignment;
  }[];
  gamblingPoints: {
    assignment: Assignment | null;
    gamblingType: {
      title: string;
    } | null;
  }[];
  guesses: {
    assignmentReview: {
      assignment: Assignment;
    };
  }[];
}

/**
 * Props for the PointHistory component.
 */
interface PointHistoryProps {
  /** Array of Point objects to display in the history. */
  points: Point[];
  /** The ID of the currently active season */
  currentSeasonId: string | null;
}

interface EpisodeGroup {
  slug?: string | null;
  title: string;
  number: number;
  assignments: Record<string, { title: string; points: Point[] }>;
}

interface SeasonGroup {
  id: string;
  title: string;
  startedOn: Date | null;
  episodes: Record<string, EpisodeGroup>;
}

const EpisodeList = ({ episodes }: { episodes: Record<string, EpisodeGroup> }) => {

  // Sort episodes by number (descending)
  const sortedEpisodes = Object.entries(episodes).sort(([, a], [, b]) => b.number - a.number);

  return (
    <div className="space-y-6">
      {sortedEpisodes.map(([episodeId, episode]) => {
        const hasWonGamble = Object.values(episode.assignments).some(a => a.points.some(p => p.gamblingPoints.length > 0));
        const episodePath = episode.slug ? getEpisodePath(episode.slug) : null;

        return (
          <div key={episodeId} className="border border-gray-700 rounded-xl overflow-hidden bg-gray-900/40 backdrop-blur-sm shadow-lg transition-all hover:shadow-xl hover:bg-gray-900/60">
            <div className="p-4 bg-gradient-to-r from-gray-800 to-gray-900 border-b border-gray-700 flex justify-between items-center group">
              {episodeId !== 'misc' && episodePath ? (
                <Link href={episodePath} className="hover:text-indigo-400 transition-colors">
                  <h4 className="text-xl font-bold text-white">{episode.title}</h4>
                </Link>
              ) : (
                <h4 className="text-xl font-bold text-white">{episode.title}</h4>
              )}
              {hasWonGamble && episodePath && (
                <Link href={episodePath} className="flex items-center gap-2 px-3 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded-full text-yellow-500 text-xs font-black uppercase tracking-widest animate-pulse hover:bg-yellow-500/20 transition-all shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                  <Trophy className="w-3.5 h-3.5" />
                  <span>Winning Episode</span>
                </Link>
              )}
            </div>
            <div className="p-4 space-y-6">
              {Object.entries(episode.assignments).map(([assignmentId, assignment]) => (
                <div key={assignmentId} className="relative pl-6 border-l-2 border-indigo-500/50">
                  <h5 className="text-lg font-semibold mb-3 text-indigo-300">{assignment.title}</h5>
                  <div className="grid gap-3">
                    {assignment.points.map(point => {
                      const totalPoints = (point.gamePointType?.points ?? 0) + (point.adjustment ?? 0);
                      return (
                        <div key={point.id} className="flex justify-between items-center bg-gray-800/50 p-4 rounded-lg border border-gray-700/50 hover:border-indigo-500/30 transition-colors">
                          <div className="flex-1">
                            <div className="font-medium text-white text-lg flex items-center gap-2">
                              {point.reason ?? point.gamePointType?.title}
                            </div>
                            {point.gamePointType?.description && (
                              <div className="text-sm text-gray-400 mt-1">
                                {point.gamePointType.description}
                              </div>
                            )}
                            <div className="text-xs text-gray-500 mt-2 font-mono">
                              {formatInstantLocal(point.earnedOn, { dateStyle: "long" })}
                            </div>
                          </div>
                          <div className={`text-2xl font-bold ml-4 ${totalPoints > 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                            }`}>
                            {totalPoints > 0 ? '+' : ''}
                            {totalPoints}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Render a point history grouped by Season -> Episode -> Assignment.
 */
export default function PointHistory({ points, currentSeasonId }: PointHistoryProps) {
  // Group points by Season -> Episode -> Assignment
  const groupedSeasons = points.reduce((acc, point) => {
    const seasonId = point.season?.id ?? "legacy";
    const seasonTitle = point.season?.title ?? "Legacy";
    // For legacy, use a very old date for sorting if needed, but we'll handle legacy explicitly
    const seasonStartedOnPlain = toPlainDateString(point.season?.startedOn);
    const seasonStartedOn = seasonStartedOnPlain ? parsePlainDate(seasonStartedOnPlain) : null;

    if (!acc[seasonId]) {
      acc[seasonId] = {
        id: seasonId,
        title: seasonTitle,
        startedOn: seasonStartedOn,
        episodes: {}
      };
    }

    const seasonGroup = acc[seasonId];

    // Try to find associated assignment and episode
    let assignment: Assignment | null | undefined;
    if (point.assignmentPoints.length > 0) {
      assignment = point.assignmentPoints[0]?.assignment;
    } else if (point.gamblingPoints.length > 0) {
      assignment = point.gamblingPoints[0]?.assignment;
    } else if (point.guesses.length > 0) {
      assignment = point.guesses[0]?.assignmentReview.assignment;
    }

    let episodeId = "misc";
    let episodeTitle = "Miscellaneous";
    let episodeNumber = -1;
    let assignmentId = "misc";
    let assignmentTitle = "General";

    if (assignment) {
      episodeId = assignment.episode.id;
      episodeTitle = `Episode ${assignment.episode.number}: ${assignment.episode.title}`;
      episodeNumber = assignment.episode.number;
      assignmentId = assignment.id;
      assignmentTitle = assignment.movie.title;
    }

    if (!seasonGroup.episodes[episodeId]) {
      seasonGroup.episodes[episodeId] = {
        slug: assignment?.episode.slug ?? null,
        title: episodeTitle,
        number: episodeNumber,
        assignments: {}
      };
    }

    const episodeGroup = seasonGroup.episodes[episodeId];
    if (episodeGroup) {
      if (!episodeGroup.assignments[assignmentId]) {
        episodeGroup.assignments[assignmentId] = {
          title: assignmentTitle,
          points: []
        };
      }
      episodeGroup.assignments[assignmentId]?.points.push(point);
    }

    return acc;
  }, {} as Record<string, SeasonGroup>);

  // Split into active, older, and legacy
  let activeSeason: SeasonGroup | undefined;
  const olderSeasons: SeasonGroup[] = [];
  let legacySeason: SeasonGroup | undefined;

  Object.values(groupedSeasons).forEach(season => {
    if (season.id === "legacy") {
      legacySeason = season;
    } else if (season.id === currentSeasonId) {
      activeSeason = season;
    } else {
      olderSeasons.push(season);
    }
  });

  // Sort older seasons by date descending
  olderSeasons.sort((a, b) => {
    if (!a.startedOn && !b.startedOn) return 0;
    if (!a.startedOn) return 1;
    if (!b.startedOn) return -1;
    return b.startedOn.getTime() - a.startedOn.getTime();
  });

  // If there is legacy data, append it to the end of older seasons list for the accordion
  if (legacySeason) {
    olderSeasons.push(legacySeason);
  }

  return (
    <div className="w-full max-w-4xl space-y-8">
      <h3 className="text-2xl font-bold text-white mb-6">Point History</h3>

      {/* Active Season Section */}
      <div className="space-y-4">
        {activeSeason ? (
          <>
            <div className="flex items-center gap-3 pb-2 border-b border-gray-700">
              <Trophy className="w-6 h-6 text-yellow-500" />
              <h2 className="text-2xl font-bold text-white">{activeSeason.title}</h2>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                CURRENT SEASON
              </span>
            </div>
            <EpisodeList episodes={activeSeason.episodes} />
          </>
        ) : (
          <div className="flex items-center gap-3 pb-2 border-b border-gray-700">
            <h2 className="text-xl font-bold text-gray-400">No active season</h2>
          </div>
        )}
      </div>

      {/* Older Seasons Accordion */}
      {olderSeasons.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-gray-400 mb-4">Past Seasons</h3>
          <Accordion type="multiple" className="w-full space-y-4">
            {olderSeasons.map((season) => (
              <AccordionItem key={season.id} value={season.id} className="border border-gray-700 rounded-lg bg-gray-900/20 overflow-hidden px-4">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-3">
                    <Trophy className={`w-5 h-5 ${season.id === 'legacy' ? 'text-gray-500' : 'text-yellow-500/50'}`} />
                    <span className="text-lg font-bold text-white">{season.title}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  <EpisodeList episodes={season.episodes} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}
    </div>
  );
}
