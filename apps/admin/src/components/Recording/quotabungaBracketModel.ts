import { z } from "zod";

import type { ConvexAdminUser } from "../../convex/users";

/**
 * Three judges vote on every cut and matchup, so a matchup always ends 2–1 or
 * 3–0 and never ties.
 */
export const JUDGE_COUNT = 3;

/** Votes that keep an entry in a cut round, or win a matchup. */
export const MAJORITY = Math.floor(JUDGE_COUNT / 2) + 1;

/** The smallest bracket with semifinals, whose losers play for 3rd place. */
export const MIN_BRACKET_SIZE = 4;

const matchSideSchema = z.enum(["a", "b"]);

/**
 * A bracket is stored as the list of what the admin did, in order. Every view
 * of it is derived by replaying the list, so undo drops the last event and a
 * restored list rebuilds exactly where the round left off. Events that don't
 * fit the bracket's state when replayed are ignored. A matchup vote names its
 * matchup, so a repeated click can't land on the next one.
 */
export const bracketEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start"),
    target: z.number(),
    entryIds: z.array(z.string()),
    /**
     * The judges' names by vote position, fixed when the bracket starts, so a
     * host renamed or added mid-bracket doesn't move anyone's votes.
     */
    judges: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("cutVote"),
    entryId: z.string(),
    judge: z.number(),
    keep: z.boolean(),
  }),
  z.object({ type: z.literal("closeRound") }),
  z.object({ type: z.literal("pick"), entryIds: z.array(z.string()) }),
  z.object({
    type: z.literal("matchVote"),
    matchId: z.string(),
    judge: z.number(),
    side: matchSideSchema,
  }),
]);

export type BracketEvent = z.infer<typeof bracketEventSchema>;
export type MatchSide = z.infer<typeof matchSideSchema>;

export type CutOutcome = "kept" | "back" | "tiebreak" | "cut";

export interface CutRoundResult {
  label: string;
  outcomes: Record<string, CutOutcome>;
  /** Every entry got the same number of keeps, so the round is voted again. */
  stalemate: boolean;
  /** The admin chose who goes through instead of the judges' votes. */
  picked: boolean;
}

export interface CutStage {
  label: string;
  tiebreak: boolean;
  /** Entries still in this stage, in recording order. */
  pool: string[];
  /** How many of the pool go through. */
  need: number;
  /** Each entry's votes by judge: true keeps it, false cuts it. */
  votes: Record<string, (boolean | null)[]>;
  complete: boolean;
}

export interface BracketMatch {
  id: string;
  label: string;
  a: string | null;
  b: string | null;
  votes: (MatchSide | null)[];
  winner: string | null;
  loser: string | null;
}

export interface BracketRound {
  label: string;
  matches: BracketMatch[];
}

export interface BracketView {
  target: number;
  entryIds: string[];
  /** The judges named when the bracket started, if it named them. */
  judges: string[] | null;
  history: CutRoundResult[];
  /** The cut or tiebreak round being voted, until the bracket is set. */
  cut: CutStage | null;
  /** Entry IDs by seed, first seed first, once the bracket is set. */
  seeds: string[] | null;
  rounds: BracketRound[];
  thirdPlace: BracketMatch | null;
  /** The next matchup to vote on, in play order. */
  current: BracketMatch | null;
  /** 1st, 2nd and 3rd once the final and the 3rd-place match are decided. */
  placements: [string, string, string] | null;
}

const isPowerOfTwo = (value: number) =>
  Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;

/** Every bracket size a round of this many entries can cut down to. */
export function bracketTargets(entryCount: number): number[] {
  const targets: number[] = [];
  for (let size = MIN_BRACKET_SIZE; size <= entryCount; size *= 2) {
    targets.push(size);
  }
  return targets;
}

export const bracketRoundCount = (target: number) => Math.log2(target);

/** Seeds in bracket slot order, so seeds 1 and 2 can only meet in the final. */
export function seedSlots(size: number): number[] {
  let slots = [1];
  while (slots.length < size) {
    const next = slots.length * 2;
    slots = slots.flatMap((seed) => [seed, next + 1 - seed]);
  }
  return slots;
}

function roundName(entrants: number): { round: string; match: string } {
  if (entrants === 2) return { round: "Final", match: "Final" };
  if (entrants === 4) return { round: "Semifinals", match: "Semifinal" };
  if (entrants === 8) return { round: "Quarterfinals", match: "Quarterfinal" };
  return {
    round: `Round of ${String(entrants)}`,
    match: `Round of ${String(entrants)} · Match`,
  };
}

function decide(
  id: string,
  label: string,
  a: string | null,
  b: string | null,
  votes: (MatchSide | null)[] | undefined
): BracketMatch {
  const cast = votes ?? Array<MatchSide | null>(JUDGE_COUNT).fill(null);
  let winner: string | null = null;
  let loser: string | null = null;
  if (a !== null && b !== null && cast.every((vote) => vote !== null)) {
    const forA = cast.filter((vote) => vote === "a").length;
    [winner, loser] = forA >= MAJORITY ? [a, b] : [b, a];
  }
  return { id, label, a, b, votes: cast, winner, loser };
}

function buildBracket(
  seeds: string[],
  matchVotes: ReadonlyMap<string, (MatchSide | null)[]>
) {
  const rounds: BracketRound[] = [];
  let thirdPlace: BracketMatch | null = null;
  let entrants: (string | null)[] = seedSlots(seeds.length).map(
    (seed) => seeds[seed - 1] ?? null
  );
  while (entrants.length >= 2) {
    const names = roundName(entrants.length);
    const pairs = entrants.length / 2;
    const matches: BracketMatch[] = [];
    for (let index = 0; index < pairs; index += 1) {
      const id = `r${String(rounds.length + 1)}m${String(index + 1)}`;
      matches.push(
        decide(
          id,
          pairs === 1 ? names.match : `${names.match} ${String(index + 1)}`,
          entrants[index * 2] ?? null,
          entrants[index * 2 + 1] ?? null,
          matchVotes.get(id)
        )
      );
    }
    rounds.push({ label: names.round, matches });
    if (entrants.length === 4) {
      thirdPlace = decide(
        "third",
        "3rd-place match",
        matches[0]?.loser ?? null,
        matches[1]?.loser ?? null,
        matchVotes.get("third")
      );
    }
    entrants = matches.map((match) => match.winner);
  }
  const final = rounds.at(-1)?.matches[0] ?? null;
  const playOrder = [
    ...rounds.slice(0, -1).flatMap((round) => round.matches),
    ...(thirdPlace === null ? [] : [thirdPlace]),
    ...(final === null ? [] : [final]),
  ];
  const current =
    playOrder.find(
      (match) => match.a !== null && match.b !== null && match.winner === null
    ) ?? null;
  const third = thirdPlace?.winner ?? null;
  const placements: [string, string, string] | null =
    final !== null && final.winner !== null && final.loser !== null && third !== null
      ? [final.winner, final.loser, third]
      : null;
  return { rounds, thirdPlace, current, placements };
}

interface Frame {
  pool: string[];
  need: number;
  /** Entries this frame's parent already put through before calling it. */
  carried: string[];
  round: number;
  /** A tiebreak's number among the bracket's tiebreaks; 0 for the main cut. */
  tiebreak: number;
  votes: Map<string, (boolean | null)[]>;
}

const emptyVotes = (pool: readonly string[]) =>
  new Map(
    pool.map((id) => [id, Array<boolean | null>(JUDGE_COUNT).fill(null)])
  );

function frameLabel(frame: Frame): string {
  if (frame.tiebreak === 0) return `Cut round ${String(frame.round)}`;
  const label = `Tiebreak ${String(frame.tiebreak)}`;
  return frame.round === 1 ? label : `${label}, round ${String(frame.round)}`;
}

/** Replays a bracket's events into what the recording panel shows. */
export function deriveBracket(
  events: readonly BracketEvent[]
): BracketView | null {
  const [start, ...rest] = events;
  if (start?.type !== "start") return null;
  const { target, entryIds } = start;
  if (
    !isPowerOfTwo(target) ||
    target < MIN_BRACKET_SIZE ||
    target > entryIds.length ||
    new Set(entryIds).size !== entryIds.length
  ) {
    return null;
  }

  const order = new Map(entryIds.map((id, index) => [id, index]));
  const byOrder = (left: string, right: string) =>
    (order.get(left) ?? 0) - (order.get(right) ?? 0);
  const mainKeeps = new Map<string, number>();
  const history: CutRoundResult[] = [];
  const frames: Frame[] = [];
  const matchVotes = new Map<string, (MatchSide | null)[]>();
  let seeds: string[] | null = null;
  let tiebreaks = 0;

  const setSeeds = (entries: string[]) => {
    // The entries the judges kept most often are seeded highest, so the
    // strongest don't meet before the late rounds; recording order breaks ties.
    seeds = [...entries].sort(
      (left, right) =>
        (mainKeeps.get(right) ?? 0) - (mainKeeps.get(left) ?? 0) ||
        byOrder(left, right)
    );
  };
  const pushFrame = (
    pool: string[],
    need: number,
    carried: string[],
    main: boolean
  ) => {
    if (!main) tiebreaks += 1;
    frames.push({
      pool: [...pool].sort(byOrder),
      need,
      carried,
      round: 1,
      tiebreak: main ? 0 : tiebreaks,
      votes: emptyVotes(pool),
    });
  };
  const resolve = (result: string[]) => {
    const frame = frames.pop();
    if (frame === undefined) return;
    const through = [...frame.carried, ...result];
    if (frames.length === 0) setSeeds(through);
    else resolve(through);
  };
  const nextRound = (frame: Frame, pool: string[]) => {
    frame.pool = pool;
    frame.round += 1;
    frame.votes = emptyVotes(pool);
  };

  const closeRound = (frame: Frame) => {
    const keeps = new Map(
      frame.pool.map((id) => [
        id,
        (frame.votes.get(id) ?? []).filter((vote) => vote === true).length,
      ])
    );
    const keepsOf = (id: string) => keeps.get(id) ?? 0;
    if (frame.tiebreak === 0) {
      keeps.forEach((count, id) =>
        mainKeeps.set(id, (mainKeeps.get(id) ?? 0) + count)
      );
    }
    const outcomes: Record<string, CutOutcome> = {};
    const record = (stalemate: boolean) =>
      history.push({
        label: frameLabel(frame),
        outcomes,
        stalemate,
        picked: false,
      });

    // An entry stays with keeps from two of the three judges. A round that
    // would cut nobody cuts the entries with the fewest keeps instead.
    let survivors = frame.pool.filter((id) => keepsOf(id) >= MAJORITY);
    if (survivors.length === frame.pool.length) {
      const fewest = Math.min(...frame.pool.map(keepsOf));
      survivors = frame.pool.filter((id) => keepsOf(id) > fewest);
    }
    const survived = new Set(survivors);
    const cut = frame.pool
      .filter((id) => !survived.has(id))
      .sort((left, right) => keepsOf(right) - keepsOf(left) || byOrder(left, right));
    survivors.forEach((id) => (outcomes[id] = "kept"));
    cut.forEach((id) => (outcomes[id] = "cut"));

    if (survivors.length > frame.need) {
      record(false);
      nextRound(frame, survivors);
      return;
    }
    if (survivors.length === frame.need) {
      record(false);
      resolve(survivors);
      return;
    }
    // Too few survived, so cut entries come back by keeps. Entries tied for
    // the last spots go to a tiebreak round among themselves.
    const boundary = keepsOf(cut[frame.need - survivors.length - 1] ?? "");
    const back = cut.filter((id) => keepsOf(id) > boundary);
    const tied = cut.filter((id) => keepsOf(id) === boundary);
    const open = frame.need - survivors.length - back.length;
    back.forEach((id) => (outcomes[id] = "back"));
    if (tied.length === open) {
      tied.forEach((id) => (outcomes[id] = "back"));
      record(false);
      resolve([...survivors, ...back, ...tied]);
      return;
    }
    if (tied.length === frame.pool.length) {
      tied.forEach((id) => (outcomes[id] = "tiebreak"));
      record(true);
      nextRound(frame, frame.pool);
      return;
    }
    tied.forEach((id) => (outcomes[id] = "tiebreak"));
    record(false);
    pushFrame(tied, open, [...survivors, ...back], false);
  };

  if (entryIds.length === target) setSeeds(entryIds);
  else pushFrame(entryIds, target, [], true);

  for (const event of rest) {
    const frame = frames.at(-1);
    if (event.type === "matchVote") {
      if (seeds === null || !validJudge(event.judge)) continue;
      const { current } = buildBracket(seeds, matchVotes);
      if (current?.id !== event.matchId) continue;
      const votes = [...current.votes];
      votes[event.judge] = event.side;
      matchVotes.set(current.id, votes);
      continue;
    }
    if (frame === undefined) continue;
    if (event.type === "cutVote") {
      const votes = frame.votes.get(event.entryId);
      if (votes === undefined || !validJudge(event.judge)) continue;
      votes[event.judge] = event.keep;
    } else if (event.type === "closeRound") {
      if (votesComplete(frame)) closeRound(frame);
    } else if (event.type === "pick") {
      const picked = new Set(event.entryIds);
      if (
        picked.size !== event.entryIds.length ||
        picked.size !== frame.need ||
        event.entryIds.some((id) => !frame.votes.has(id))
      ) {
        continue;
      }
      history.push({
        label: frameLabel(frame),
        outcomes: Object.fromEntries(
          frame.pool.map((id) => [id, picked.has(id) ? "kept" : "cut"])
        ),
        stalemate: false,
        picked: true,
      });
      resolve(frame.pool.filter((id) => picked.has(id)));
    }
  }

  const frame = frames.at(-1);
  const bracket =
    seeds === null
      ? { rounds: [], thirdPlace: null, current: null, placements: null }
      : buildBracket(seeds, matchVotes);
  return {
    target,
    entryIds,
    judges: start.judges ?? null,
    history,
    cut:
      frame === undefined
        ? null
        : {
            label: frameLabel(frame),
            tiebreak: frame.tiebreak > 0,
            pool: frame.pool,
            need: frame.need,
            votes: Object.fromEntries(frame.votes),
            complete: votesComplete(frame),
          },
    seeds,
    ...bracket,
  };
}

const validJudge = (judge: number) =>
  Number.isInteger(judge) && judge >= 0 && judge < JUDGE_COUNT;

const votesComplete = (frame: Frame) =>
  [...frame.votes.values()].every((votes) =>
    votes.every((vote) => vote !== null)
  );

/**
 * The judges are the active users with the Host role, by name. Votes need
 * exactly three, so any other count falls back to numbered judges. The names
 * are on screen during the recording, so a host without one shows the part of
 * their email before the @, never the whole address.
 */
export function bracketJudgeNames(
  users: readonly Pick<ConvexAdminUser, "name" | "email" | "status" | "roles">[]
): string[] {
  const hosts = users
    .filter(
      (user) =>
        user.status === "active" &&
        user.roles.some(
          (membership) => membership.role.name.trim().toLowerCase() === "host"
        )
    )
    .map(
      (user) =>
        user.name?.trim() || user.email?.split("@")[0]?.trim() || "Unnamed host"
    )
    .sort((left, right) => left.localeCompare(right, "en"));
  return hosts.length === JUDGE_COUNT
    ? hosts
    : Array.from({ length: JUDGE_COUNT }, (_, index) => `Judge ${String(index + 1)}`);
}
