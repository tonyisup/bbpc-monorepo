export interface QuotabungaSeason {
  id: string;
  title: string;
  startedOn: string | null;
  endedOn: string | null;
  isCurrent: boolean;
}

export interface QuotabungaListenerName {
  id: string;
  name: string | null;
}

export interface QuotabungaEntry {
  id: string;
  quoteText: string;
  sourceTitle: string;
  sourceType: "MOVIE" | "TV" | "OTHER";
  clipUrl: string | null;
  clipStartSeconds: number | null;
  clipEndSeconds: number | null;
  inBracket: boolean;
  placement: 1 | 2 | 3 | null;
  user: QuotabungaListenerName;
}

export interface QuotabungaRound {
  episode: {
    id: string;
    number: number;
    title: string;
    date: string | null;
    slug: string | null;
  };
  /** Entries are present only once the round's episode is published. */
  state: "open" | "locked" | "revealed";
  entryCount: number;
  entries: QuotabungaEntry[];
}

export interface QuotabungaListener {
  user: QuotabungaListenerName;
  wins: number;
  points: number;
  entryCount: number;
}

export interface QuotabungaSeasonDetail {
  season: QuotabungaSeason;
  /** Newest episode first. */
  rounds: QuotabungaRound[];
  /** Most wins first. */
  listeners: QuotabungaListener[];
}
