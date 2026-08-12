export type EpisodeMovie = {
  id: string;
  title: string;
  year: number;
  poster: string | null;
  url: string;
  tmdbId?: number | null;
};

export type EpisodeShow = {
  id: string;
  title: string;
  year: number;
  poster: string | null;
  url: string;
};

export type EpisodeUser = {
  id: string;
  name: string | null;
  image: string | null;
};

export type EpisodeAssignment = {
  id: string;
  type: string;
  playable: boolean;
  slug: string | null;
  movie: EpisodeMovie;
  user: EpisodeUser;
};

export type EpisodeExtra = {
  id: string;
  review: {
    id?: string;
    movie?: EpisodeMovie | null;
    show?: EpisodeShow | null;
  };
};

export type EpisodeLink = {
  id: string;
  url: string;
  text: string;
};

/**
 * The presentation contract shared by the temporary SQL and Convex adapters.
 * It intentionally contains only fields used by public episode surfaces.
 */
export type CompleteEpisode = {
  id: string;
  slug?: string | null;
  number: number;
  title: string;
  recording: string | null;
  date: Date | string | null;
  description: string | null;
  status: string | null;
  assignments: EpisodeAssignment[];
  extras: EpisodeExtra[];
  links: EpisodeLink[];
};

export type EpisodeGamblingWinner = {
  id: string;
  user: EpisodeUser;
  points: number;
  gamblingType: {
    title: string;
    multiplier: number;
  };
  movie: EpisodeMovie;
};

export type EpisodeGuessWinner = {
  id: string;
  user: EpisodeUser;
  host: EpisodeUser;
  actualRating: number;
  movie: EpisodeMovie;
};

export type EpisodeResultsData = {
  gamblingWinners: EpisodeGamblingWinner[];
  guessWinners: EpisodeGuessWinner[];
};
