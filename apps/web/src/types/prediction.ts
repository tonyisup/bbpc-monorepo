export type PredictionGameAssignment = {
  id: string;
  playable: boolean;
  movie: {
    title: string;
    poster: string | null;
  } | null;
};
