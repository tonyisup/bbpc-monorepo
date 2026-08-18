import type {
  ConvexAdminSeasonGamblingEntry,
  ConvexAdminSeasonGuess,
} from "../../convex/seasonDetails";
import type { ConvexAdminUser } from "../../convex/users";

export interface AssignmentPointTotal {
  userId: string;
  assignmentId: string;
  total: number;
}

export interface EpisodePointRow {
  user: { id: string; name: string | null; image: string | null };
  guessPoints: number;
  gamblingPoints: number;
  bonusPoints: number;
  total: number;
}

export interface AssignmentRecordingDisclosure {
  activeHostCount: number;
  ratedHostCount: number;
  allHostsRated: boolean;
}

export interface RecordingGuessGroup {
  user: ConvexAdminSeasonGuess["user"];
  guesses: ConvexAdminSeasonGuess[];
}

export interface RecordingGuessSettlementPreview {
  eligible: boolean;
  correctCount: number | null;
  outcome: "allcorrect" | "all-incorrect" | "mixed" | null;
  message: string;
}

interface RecordingUserPage {
  users: ConvexAdminUser[];
  isDone: boolean;
  continueCursor: string;
}

export function selectRecordingManagementEpisode<
  T extends { number: number; status: string | null },
>(episodes: readonly T[]): T | null {
  const priority = (candidate: T) => {
    switch (candidate.status?.toLowerCase()) {
      case "next":
        return 2;
      case "recording":
        return 1;
      default:
        return 0;
    }
  };
  return episodes.reduce<T | null>((selected, episode) => {
    if (selected === null) {
      return episode;
    }
    const episodePriority = priority(episode);
    const selectedPriority = priority(selected);
    return episodePriority > selectedPriority ||
      (episodePriority === selectedPriority &&
        episode.number > selected.number)
      ? episode
      : selected;
  }, null);
}

export async function collectAllRecordingUsers(
  loadPage: (cursor: string | null) => Promise<RecordingUserPage>
): Promise<ConvexAdminUser[]> {
  const users: ConvexAdminUser[] = [];
  const visitedCursors = new Set<string>();
  let cursor: string | null = null;

  for (;;) {
    const page = await loadPage(cursor);
    users.push(...page.users);
    if (page.isDone) {
      return users;
    }
    if (
      page.continueCursor.length === 0 ||
      page.continueCursor === cursor ||
      visitedCursors.has(page.continueCursor)
    ) {
      throw new Error("The user catalog returned a repeated pagination cursor.");
    }
    visitedCursors.add(page.continueCursor);
    cursor = page.continueCursor;
  }
}

export function chunkRecordingValues<T>(
  values: T[],
  chunkSize: number
): T[][] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error("Recording management chunk size must be a positive integer.");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

export function getAssignmentRecordingDisclosure(
  users: Array<Pick<ConvexAdminUser, "id" | "isAdmin" | "status">>,
  reviews: Array<{
    reviewer: { id: string } | null;
    rating: unknown | null;
  }>
): AssignmentRecordingDisclosure {
  const activeHostIds = users
    .filter((user) => user.isAdmin && user.status === "active")
    .map((user) => user.id);
  const ratedHostIds = new Set(
    reviews.flatMap((review) =>
      review.reviewer !== null && review.rating !== null
        ? [review.reviewer.id]
        : []
    )
  );
  const ratedHostCount = activeHostIds.filter((id) =>
    ratedHostIds.has(id)
  ).length;
  return {
    activeHostCount: activeHostIds.length,
    ratedHostCount,
    allHostsRated:
      activeHostIds.length > 0 && ratedHostCount === activeHostIds.length,
  };
}

export function isRecordingGuessRevealed(
  guess: ConvexAdminSeasonGuess
): boolean {
  return guess.assignmentReview.review.rating !== null;
}

export function groupRecordingGuessesByListener(
  guesses: ConvexAdminSeasonGuess[]
): RecordingGuessGroup[] {
  const groups = new Map<string, RecordingGuessGroup>();

  guesses.forEach((guess) => {
    const group = groups.get(guess.user.id);
    if (group === undefined) {
      groups.set(guess.user.id, {
        user: guess.user,
        guesses: [guess],
      });
      return;
    }
    group.guesses.push(guess);
  });

  return [...groups.values()];
}

export function getRecordingGuessSettlementPreview(
  guesses: ConvexAdminSeasonGuess[]
): RecordingGuessSettlementPreview {
  if (guesses.length !== 3) {
    return {
      eligible: false,
      correctCount: null,
      outcome: null,
      message: `${guesses.length} of 3 guesses recorded`,
    };
  }
  const hostIds = guesses.flatMap((guess) =>
    guess.assignmentReview.review.user === null
      ? []
      : [guess.assignmentReview.review.user.id]
  );
  if (hostIds.length !== 3 || new Set(hostIds).size !== 3) {
    return {
      eligible: false,
      correctCount: null,
      outcome: null,
      message: "Guesses must target 3 distinct hosts",
    };
  }
  if (new Set(guesses.map((guess) => guess.season.id)).size !== 1) {
    return {
      eligible: false,
      correctCount: null,
      outcome: null,
      message: "Guesses must belong to the same season",
    };
  }
  if (
    guesses.some(
      (guess) => guess.assignmentReview.review.rating === null
    )
  ) {
    return {
      eligible: false,
      correctCount: null,
      outcome: null,
      message: "Waiting for all 3 host ratings",
    };
  }
  const correctCount = guesses.filter(
    (guess) =>
      guess.assignmentReview.review.rating?.id === guess.rating.id
  ).length;
  return {
    eligible: true,
    correctCount,
    outcome:
      correctCount === 3
        ? "allcorrect"
        : correctCount === 0
          ? "all-incorrect"
          : "mixed",
    message: `${correctCount} of 3 correct`,
  };
}

export function summarizeEpisodePoints(
  guesses: ConvexAdminSeasonGuess[],
  wagers: ConvexAdminSeasonGamblingEntry[],
  assignmentPoints: AssignmentPointTotal[],
  users: ConvexAdminUser[]
): EpisodePointRow[] {
  const rows = new Map<string, EpisodePointRow>();
  const userCatalog = new Map(users.map((user) => [user.id, user]));
  const rowFor = (user: {
    id: string;
    name: string | null;
    image: string | null;
  }) => {
    const existing = rows.get(user.id);
    if (existing !== undefined) {
      return existing;
    }
    const created = {
      user,
      guessPoints: 0,
      gamblingPoints: 0,
      bonusPoints: 0,
      total: 0,
    };
    rows.set(user.id, created);
    return created;
  };

  guesses.forEach((guess) => {
    if (guess.point === null) {
      return;
    }
    const row = rowFor(guess.user);
    row.guessPoints += guess.point.total;
    row.total += guess.point.total;
  });
  wagers.forEach((wager) => {
    if (wager.awardPoint === null) {
      return;
    }
    const row = rowFor(wager.user);
    row.gamblingPoints += wager.awardPoint.total;
    row.total += wager.awardPoint.total;
  });
  assignmentPoints.forEach((pointTotal) => {
    const user = userCatalog.get(pointTotal.userId);
    if (user === undefined || pointTotal.total === 0) {
      return;
    }
    const row = rowFor(user);
    row.bonusPoints += pointTotal.total;
    row.total += pointTotal.total;
  });
  return [...rows.values()].sort(
    (left, right) =>
      right.total - left.total ||
      (left.user.name ?? "").localeCompare(right.user.name ?? "")
  );
}
