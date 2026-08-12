export interface PredictionScoring {
  correctHost: number | null;
  allCorrectBonus: number | null;
  allIncorrect: number | null;
}

export interface GamePerformanceData {
  season: {
    id: string;
    title: string;
    endedOn: string | null;
  };
  userSummary: Array<{
    id: string;
    name: string | null;
    total: number;
  }>;
  points: Array<{
    userId: string;
    earnedAt: number;
    pointValue: number;
  }>;
}
