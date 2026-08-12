import { type FC } from "react";
import type { FuseResultMatch } from "fuse.js";
import Assignment from "./Assignment";
import MovieInlinePreview from "./MovieInlinePreview";
import Link from "next/link";
import { AddExtraToNext } from "./AddExtraToNext";
import {
  fuseIndicesForField,
  highlightText,
  highlightTextByIndices,
  highlightWithFuseOrQuery,
} from "@/utils/text";
import ShowInlinePreview from "./ShowInlinePreview";
import type { PredictionGameAssignment } from "@/types/prediction";
import { getEpisodePath } from "@/lib/routes";
import { formatPlainDate } from "@/lib/dates";
import { GameParticipation } from "./GameParticipation";
import type {
  CompleteEpisode,
  EpisodeAssignment,
  EpisodeExtra,
  EpisodeLink,
} from "@/types/episode";

export type { CompleteEpisode, EpisodeExtra } from "@/types/episode";

const mapEpisodeToPredictionAssignment = (
  assignment: EpisodeAssignment
): PredictionGameAssignment | null => {
  if (!assignment.playable) {
    return null;
  }

  return {
    id: assignment.id,
    playable: assignment.playable,
    movie: assignment.movie
      ? {
          title: assignment.movie.title,
          poster: assignment.movie.poster,
        }
      : null,
  };
};

/**
 * Props for the Episode component.
 */
interface EpisodeProps {
  /** Whether to allow the prediction game (guesses) for this episode. */
  allowGuesses?: boolean;
  /** When false, hides extras list and add-extra affordances (e.g. compact embeds). */
  showExtras?: boolean;
  /** Whether to explicitly show movie titles under the movie/show previews. */
  showMovieTitles?: boolean;
  /** Search query for highlighting relevant text within the episode details. */
  searchQuery?: string;
  /** When set (e.g. fuzzy search), highlights matched character ranges from Fuse `includeMatches`. */
  fuseMatches?: ReadonlyArray<FuseResultMatch>;
  /** The complete episode data. */
  episode: CompleteEpisode;
}

/**
 * Renders a full episode section, including the header (title, date, number), assignments, extras, and links.
 */

export const Episode: FC<EpisodeProps> = ({
  episode,
  allowGuesses: isNextEpisode,
  showExtras = true,
  showMovieTitles = false,
  searchQuery = "",
  fuseMatches,
}) => {
  if (!episode) return null;
  const showGames = isNextEpisode ?? false;
  const predictionAssignments = episode.assignments
    .map(mapEpisodeToPredictionAssignment)
    .filter(
      (assignment): assignment is PredictionGameAssignment =>
        assignment !== null
    );

  return (
    <section className="bbpc-panel flex w-full min-w-0 flex-col justify-between gap-3 overflow-hidden p-3 sm:p-5">
      <div className="min-w-0">
        <div className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 font-bold sm:grid-cols-[auto_1fr_auto]">
          <div className="sm:text-md whitespace-nowrap p-1 text-sm sm:p-2">
            <Link href={getEpisodePath(episode.slug ?? episode.id)}>
              {episode?.number}
            </Link>
          </div>
          <div className="min-w-0 text-center text-lg leading-tight sm:text-xl md:text-2xl">
            {!episode?.recording &&
              highlightWithFuseOrQuery(
                episode?.title ?? "",
                searchQuery,
                fuseMatches,
                "title"
              )}
            {episode?.recording && (
              <a
                className="underline"
                title={episode?.title}
                href={episode.recording ?? ""}
                target="_blank"
                rel="noreferrer"
              >
                {highlightWithFuseOrQuery(
                  episode?.title ?? "",
                  searchQuery,
                  fuseMatches,
                  "title"
                )}
              </a>
            )}
          </div>
          <div className="col-span-2 text-sm text-zinc-400 sm:col-span-1 sm:whitespace-nowrap sm:text-right">
            {episode?.date && (
              <p>{formatPlainDate(episode.date, undefined, "en-US")}</p>
            )}
          </div>
        </div>
        <div className="w-full text-center">
          <p>{highlightText(episode?.description ?? "", searchQuery)}</p>
        </div>
        <EpisodeAssignments
          assignments={episode.assignments}
          showMovieTitles={showMovieTitles}
          searchQuery={searchQuery}
          fuseMatches={fuseMatches}
        />
        {showGames && (
          <GameParticipation
            assignments={predictionAssignments}
            searchQuery={searchQuery}
            episodeStatus={episode.status ?? ""}
          />
        )}
      </div>
      <div>
        {showExtras && episode.extras.length > 0 && (
          <>
            <hr className="my-2 border-gray-500" />
            <span className="text-xs">Extras</span>
            <EpisodeExtras
              extras={episode.extras}
              showMovieTitles={showMovieTitles}
              searchQuery={searchQuery}
              fuseMatches={fuseMatches}
            />
          </>
        )}
        {showGames && showExtras && <AddExtraToNext episode={episode} />}
        <EpisodeLinks links={episode.links} />
      </div>
    </section>
  );
};

/**
 * Props for the EpisodeAssignments component.
 */
interface EpisodeAssignments {
  showMovieTitles?: boolean;
  assignments: EpisodeAssignment[];
  searchQuery?: string;
  fuseMatches?: ReadonlyArray<FuseResultMatch>;
}

/**
 * Renders a list of assignments for an episode, sorted by type (Homework -> Extra Credit -> Bonus).
 */

const EpisodeAssignments: FC<EpisodeAssignments> = ({
  assignments,
  showMovieTitles = false,
  searchQuery = "",
  fuseMatches,
}) => {
  if (!assignments || assignments.length == 0) return null;
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 sm:flex sm:justify-around">
      {assignments
        .sort((a, b) => {
          const typeOrder = { HOMEWORK: 0, EXTRA_CREDIT: 1, BONUS: 2 };
          return (
            typeOrder[a.type as keyof typeof typeOrder] -
            typeOrder[b.type as keyof typeof typeOrder]
          );
        })
        .map((assignment) => {
          const assignmentRefIndex = assignments.findIndex(
            (a) => a.id === assignment.id
          );
          return (
            <div
              key={assignment.id}
              className="flex flex-col items-center justify-between gap-2"
            >
              <Assignment
                assignment={assignment}
                showMovieTitles={showMovieTitles}
                searchQuery={searchQuery}
                fuseMatches={fuseMatches}
                assignmentRefIndex={assignmentRefIndex}
              />
            </div>
          );
        })}
    </div>
  );
};

/**
 * Props for the EpisodeExtras component.
 */
interface EpisodeExtras {
  showMovieTitles?: boolean;
  searchQuery?: string;
  extras: EpisodeExtra[];
  fuseMatches?: ReadonlyArray<FuseResultMatch>;
}

/**
 * Renders the "Extras" section for an episode, showing previews of additional movies or shows discussed.
 */

const EpisodeExtras: FC<EpisodeExtras> = ({
  extras,
  showMovieTitles = false,
  searchQuery = "",
  fuseMatches,
}) => {
  if (!extras || extras.length == 0) return null;
  return (
    <div className="py-2">
      <div className="flex flex-wrap justify-center gap-2 pb-2">
        {extras.map((extra, extraIndex) => {
          const movieTitleIdx = fuseIndicesForField(
            fuseMatches,
            "extras.review.movie.title",
            extraIndex
          );
          const showTitleIdx = fuseIndicesForField(
            fuseMatches,
            "extras.review.show.title",
            extraIndex
          );

          return (
            <div
              key={extra.id}
              className="flex w-12 items-center gap-2 sm:w-36"
            >
              <div className="flex flex-col items-center gap-2">
                {extra.review.movie && (
                  <MovieInlinePreview
                    movie={extra.review.movie}
                    searchQuery={searchQuery}
                    titleHighlightIndices={movieTitleIdx}
                    responsive
                  />
                )}
                {extra.review.show && (
                  <ShowInlinePreview
                    show={extra.review.show}
                    searchQuery={searchQuery}
                    titleHighlightIndices={showTitleIdx}
                    responsive
                  />
                )}
                {showMovieTitles && extra.review.movie && (
                  <div className="text-sm text-gray-500">
                    {movieTitleIdx.length > 0
                      ? highlightTextByIndices(
                          extra.review.movie.title,
                          movieTitleIdx
                        )
                      : highlightText(
                          extra.review.movie.title,
                          searchQuery
                        )}{" "}
                    ({extra.review.movie.year})
                  </div>
                )}
                {showMovieTitles &&
                  extra.review.show &&
                  !extra.review.movie && (
                    <div className="text-sm text-gray-500">
                      {showTitleIdx.length > 0
                        ? highlightTextByIndices(
                            extra.review.show.title,
                            showTitleIdx
                          )
                        : highlightText(
                            extra.review.show.title,
                            searchQuery
                          )}{" "}
                      ({extra.review.show.year})
                    </div>
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Props for the EpisodeLinks component.
 */
interface EpisodeLinkProps {
  links: EpisodeLink[];
}

/**
 * Renders a list of links associated with an episode (e.g., social media or reference links).
 */
const EpisodeLinks: FC<EpisodeLinkProps> = ({ links }) => {
  if (!links || links.length == 0) return null;
  return (
    <div className="mt-4 w-full">
      <div className="flex flex-col flex-wrap items-center justify-center gap-2">
        {links.map((link) => {
          return (
            <a key={link.id} href={link.url}>
              {link.text}
            </a>
          );
        })}
      </div>
    </div>
  );
};
