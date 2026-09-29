import { Hand, RotateCcw, Swords, Trophy, Undo2 } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { ConvexAdminQuoteSubmission } from "../../convex/quotabunga";
import { cn } from "../../lib/utils";

import { Button } from "../ui/button";
import { ConfirmModal } from "../ui/confirm-modal";
import {
  type BracketEvent,
  type BracketMatch,
  type BracketView,
  type CutRoundResult,
  type CutStage,
  type MatchSide,
  JUDGE_COUNT,
  MAJORITY,
  MIN_BRACKET_SIZE,
  bracketRoundCount,
  bracketTargets,
} from "./quotabungaBracketModel";

export type RenderBracketEntry = (
  entryId: string,
  label: string,
  controls: ReactNode
) => ReactNode;

interface BracketProps {
  view: BracketView | null;
  stale: boolean;
  /** The browser couldn't save the bracket, so a reload would lose it. */
  saveFailed: boolean;
  /** Another tab changed the bracket, so this tab's last tap wasn't counted. */
  conflict: boolean;
  /** The admin moved on from a decided matchup. */
  onNextMatchup: () => void;
  /** The placement selects show the finished bracket's results. */
  resultsApplied: boolean;
  onUseResults: () => void;
  /** The round's included entries, in recording order. */
  entryIds: string[];
  entries: ReadonlyMap<string, ConvexAdminQuoteSubmission>;
  judges: string[];
  onDispatch: (event: BracketEvent) => void;
  onUndo: () => void;
  onReset: () => void;
  renderEntry: RenderBracketEntry;
}

/** Vote buttons are tapped live during a recording, so they get a full-size target. */
const VOTE_BUTTON = "h-11 min-w-16 px-4";

const plural = (count: number, word: string) =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/**
 * The cut rounds and bracket for a Quotabunga round. The judges' votes are
 * entered here, the cut rounds bring the entries down to a bracket, and the
 * bracket's final and 3rd-place match decide the placements. Every entry
 * keeps its number in the round's recording order throughout, so two quotes
 * from the same source can't be mixed up.
 */
export function QuotabungaBracket(input: BracketProps) {
  // Votes are stored by position, so a running bracket keeps the judges it
  // started with. Every vote needs all three, whatever names were passed.
  const named = input.view?.judges ?? input.judges;
  const props = {
    ...input,
    // Entries keep the number they had when the bracket started.
    entryIds: input.view?.entryIds ?? input.entryIds,
    judges: Array.from(
      { length: JUDGE_COUNT },
      (_, index) => named[index] ?? `Judge ${String(index + 1)}`
    ),
  };
  const { view, stale, onReset } = props;
  const [resetting, setResetting] = useState(false);

  let body: ReactNode;
  if (view === null) {
    body = <BracketSetup {...props} />;
  } else if (stale) {
    body = (
      <p className="text-sm text-amber-600">
        This round&apos;s included entries changed since the bracket started.
        Reset the bracket to start again with the current entries.
      </p>
    );
  } else if (view.cut !== null) {
    // A new round or tiebreak starts without a half-made pick by hand.
    body = (
      <CutRound
        {...props}
        key={`${view.cut.label}:${view.cut.pool.join(",")}`}
        stage={view.cut}
        view={view}
      />
    );
  } else {
    body = <BracketRounds {...props} view={view} />;
  }

  return (
    <section
      aria-label="Bracket"
      className="space-y-4 rounded-xl border bg-muted/10 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-black">
          <Swords className="h-5 w-5 text-primary" />
          Bracket
        </h3>
        {view !== null && (
          <div className="flex flex-wrap gap-2">
            {!stale && (
              <Button onClick={props.onUndo} size="sm" variant="outline">
                <Undo2 className="mr-2 h-4 w-4" />
                Undo
              </Button>
            )}
            <Button
              onClick={() => setResetting(true)}
              size="sm"
              variant="outline"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset bracket
            </Button>
          </div>
        )}
      </div>
      {props.conflict && (
        <p className="text-sm text-amber-600" role="status">
          Another tab changed the bracket, so your last tap wasn&apos;t
          counted. Check the votes and tap again.
        </p>
      )}
      {props.saveFailed && view !== null && (
        <p className="text-sm text-amber-600" role="status">
          This browser isn&apos;t saving the bracket, so reloading the page
          will lose it.
        </p>
      )}
      {body}
      <ConfirmModal
        confirmText="Reset"
        description="This clears every cut and matchup vote for this round. Saved placements and points don't change."
        isOpen={resetting}
        onClose={() => setResetting(false)}
        onConfirm={onReset}
        title="Reset the bracket?"
      />
    </section>
  );
}

function BracketSetup({ entryIds, judges, onDispatch }: BracketProps) {
  const targets = bracketTargets(entryIds.length);
  const [chosen, setChosen] = useState<number | null>(null);
  const target =
    chosen !== null && targets.includes(chosen) ? chosen : targets.at(-1);
  if (target === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        A bracket needs at least {MIN_BRACKET_SIZE} entries. Choose placements
        below instead.
      </p>
    );
  }
  const rounds = bracketRoundCount(target);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Bracket size</span>
        {targets.map((size) => (
          <Button
            aria-pressed={size === target}
            key={size}
            onClick={() => setChosen(size)}
            size="sm"
            variant={size === target ? "default" : "outline"}
          >
            {size}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {entryIds.length === target
          ? `No cuts: all ${String(target)} entries go straight into `
          : `Cut ${String(entryIds.length)} → ${String(target)}, then `}
        {plural(rounds, "bracket round")} and a 3rd-place match (
        {plural(target, "matchup")}).
      </p>
      <Button
        onClick={() =>
          onDispatch({ type: "start", target, entryIds, judges })
        }
        size="sm"
      >
        Start bracket
      </Button>
    </div>
  );
}

function summarize(result: CutRoundResult): string {
  if (result.picked) return `${result.label}: picked by hand.`;
  if (result.stalemate) {
    return `${result.label}: every entry got the same number of keeps, so the round is voted again.`;
  }
  const outcomes = Object.values(result.outcomes);
  const count = (outcome: string) =>
    outcomes.filter((value) => value === outcome).length;
  const parts = [
    `${String(count("kept"))} kept`,
    count("back") > 0 ? `${String(count("back"))} back in` : null,
    count("tiebreak") > 0
      ? `${String(count("tiebreak"))} to a tiebreak`
      : null,
    `${String(count("cut"))} cut`,
  ].filter((part) => part !== null);
  return `${result.label}: ${parts.join(", ")}.`;
}

/** How an entry is named everywhere in the bracket: its number and source. */
function entryNames({ entries, entryIds }: BracketProps) {
  const number = (entryId: string) => entryIds.indexOf(entryId) + 1;
  const title = (entryId: string) =>
    entries.get(entryId)?.sourceTitle ?? "Missing entry";
  return {
    label: (entryId: string) => `Entry ${String(number(entryId))}`,
    /** For boxes, results and screen readers. */
    name: (entryId: string) =>
      `#${String(number(entryId))} ${title(entryId)}`,
  };
}

function CutRound(props: BracketProps & { stage: CutStage; view: BracketView }) {
  const { judges, onDispatch, renderEntry, stage, view } = props;
  const names = entryNames(props);
  const [picking, setPicking] = useState<string[] | null>(null);
  const last = view.history.at(-1);
  const cast = Object.values(stage.votes)
    .flat()
    .filter((vote) => vote !== null).length;
  const total = stage.pool.length * JUDGE_COUNT;

  const controls = (entryId: string) => {
    if (picking !== null) {
      const picked = picking.includes(entryId);
      return (
        <Button
          aria-label={`Put ${names.name(entryId)} through`}
          aria-pressed={picked}
          className={cn("w-full", VOTE_BUTTON)}
          onClick={() =>
            setPicking(
              picked
                ? picking.filter((id) => id !== entryId)
                : [...picking, entryId]
            )
          }
          variant={picked ? "default" : "outline"}
        >
          {picked ? "Going through" : "Put through"}
        </Button>
      );
    }
    const votes = stage.votes[entryId] ?? [];
    const waiting = judges.filter((_, index) => (votes[index] ?? null) === null);
    return (
      <div className="space-y-2">
        {judges.map((judge, index) => {
          const vote = votes[index] ?? null;
          return (
            <div
              className="flex items-center justify-between gap-2"
              key={index}
            >
              <span className="text-sm font-semibold">{judge}</span>
              <div className="flex gap-3">
                <Button
                  aria-label={`${judge}: keep ${names.name(entryId)}`}
                  aria-pressed={vote === true}
                  className={VOTE_BUTTON}
                  onClick={() =>
                    onDispatch({
                      type: "cutVote",
                      entryId,
                      judge: index,
                      keep: true,
                    })
                  }
                  variant={vote === true ? "default" : "outline"}
                >
                  Keep
                </Button>
                <Button
                  aria-label={`${judge}: cut ${names.name(entryId)}`}
                  aria-pressed={vote === false}
                  className={VOTE_BUTTON}
                  onClick={() =>
                    onDispatch({
                      type: "cutVote",
                      entryId,
                      judge: index,
                      keep: false,
                    })
                  }
                  variant={vote === false ? "destructive" : "outline"}
                >
                  Cut
                </Button>
              </div>
            </div>
          );
        })}
        {waiting.length > 0 && (
          <p className="text-xs font-semibold text-amber-600">
            Waiting on {waiting.join(", ")}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="font-bold">
          {stage.label}: {stage.need} of {stage.pool.length}{" "}
          {stage.need === 1 ? "goes" : "go"} through
        </p>
        <p className="text-sm text-muted-foreground">
          {stage.tiebreak
            ? "These entries tied for the last spots. "
            : `The bracket has ${String(view.target)} spots. `}
          An entry stays with keeps from {MAJORITY} of the {JUDGE_COUNT}{" "}
          judges.
        </p>
        {last !== undefined && (
          <p className="text-sm text-muted-foreground">{summarize(last)}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {picking === null ? (
          <>
            <Button
              disabled={!stage.complete}
              onClick={() => onDispatch({ type: "closeRound" })}
              size="sm"
            >
              Finish round
            </Button>
            <span className="text-sm text-muted-foreground">
              {cast} of {total} votes in
            </span>
            <Button
              onClick={() => setPicking([])}
              size="sm"
              variant="ghost"
            >
              <Hand className="mr-2 h-4 w-4" />
              Pick by hand
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={picking.length !== stage.need}
              onClick={() => {
                onDispatch({ type: "pick", entryIds: picking });
                setPicking(null);
              }}
              size="sm"
            >
              Put {picking.length} of {stage.need} through
            </Button>
            <Button
              onClick={() => setPicking(null)}
              size="sm"
              variant="ghost"
            >
              Back to voting
            </Button>
          </>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {stage.pool.map((entryId) => (
          <div key={entryId}>
            {renderEntry(entryId, names.label(entryId), controls(entryId))}
          </div>
        ))}
      </div>
    </div>
  );
}

function score(match: BracketMatch): string | null {
  if (match.winner === null) return null;
  const forA = match.votes.filter((vote) => vote === "a").length;
  const forB = match.votes.length - forA;
  return `${String(Math.max(forA, forB))}–${String(Math.min(forA, forB))}`;
}

function BracketRounds(props: BracketProps & { view: BracketView }) {
  const { judges, onDispatch, renderEntry, view } = props;
  const names = entryNames(props);
  const { current, placements } = view;
  // A decided matchup stays on screen, its buttons inactive, until the admin
  // moves on, so a repeated tap can't vote in the next matchup.
  const [heldId, setHeldId] = useState<string | null>(null);
  const held =
    [...view.rounds.flatMap((round) => round.matches), view.thirdPlace].find(
      (match) => match !== null && match.id === heldId && match.winner !== null
    ) ?? null;
  const shown = held ?? current;
  const seed = (entryId: string) =>
    `Seed ${String((view.seeds ?? []).indexOf(entryId) + 1)}`;

  const matchBox = (match: BracketMatch) => (
    <div
      className={cn(
        "space-y-1 rounded-lg border bg-background p-2 text-sm",
        match.id === shown?.id && "border-primary ring-1 ring-primary"
      )}
      key={match.id}
    >
      <div className="flex justify-between gap-2 text-xs font-bold uppercase text-muted-foreground">
        <span>{match.label}</span>
        {score(match) !== null && <span>{score(match)}</span>}
      </div>
      {[match.a, match.b].map((entryId, index) => (
        <p
          className={cn(
            "truncate",
            match.winner !== null &&
              (entryId === match.winner
                ? "font-bold"
                : "text-muted-foreground")
          )}
          key={index}
          title={
            entryId === null ? undefined : props.entries.get(entryId)?.quoteText
          }
        >
          {entryId === null ? "To be decided" : names.name(entryId)}
        </p>
      ))}
    </div>
  );

  const sideControls = (match: BracketMatch, side: MatchSide) => {
    const entryId = side === "a" ? match.a : match.b;
    if (entryId === null) return null;
    const decided = match.winner !== null;
    return (
      <div className="flex flex-wrap gap-3">
        {judges.map((judge, index) => (
          <Button
            aria-label={`${judge}: vote for ${names.name(entryId)}`}
            aria-pressed={match.votes[index] === side}
            className={VOTE_BUTTON}
            disabled={decided}
            key={index}
            onClick={() => {
              const othersIn = match.votes.every(
                (vote, other) => other === index || vote !== null
              );
              if (othersIn) setHeldId(match.id);
              onDispatch({
                type: "matchVote",
                matchId: match.id,
                judge: index,
                side,
              });
            }}
            variant={match.votes[index] === side ? "default" : "outline"}
          >
            {judge}
          </Button>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 overflow-x-auto pb-2">
        {view.rounds.map((round, index) => (
          <div className="w-44 shrink-0 space-y-2" key={round.label}>
            <p className="text-xs font-black uppercase text-muted-foreground">
              {round.label}
            </p>
            {round.matches.map(matchBox)}
            {index === view.rounds.length - 1 &&
              view.thirdPlace !== null &&
              matchBox(view.thirdPlace)}
          </div>
        ))}
      </div>

      {placements !== null ? (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="flex items-center gap-2 font-bold">
            <Trophy className="h-4 w-4 text-primary" />
            Bracket results
          </p>
          <ol className="space-y-1 text-sm">
            {placements.map((entryId, index) => (
              <li key={entryId}>
                {["1st", "2nd", "3rd"][index]}: {names.name(entryId)}
              </li>
            ))}
          </ol>
          {props.resultsApplied ? (
            <p className="text-sm text-muted-foreground">
              The placements below are filled in from the bracket. Award
              points to save them.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={props.onUseResults} size="sm">
                Use bracket results
              </Button>
              <span className="text-sm text-muted-foreground">
                The placements below don&apos;t match the bracket.
              </span>
            </div>
          )}
        </div>
      ) : (
        shown !== null && (
          <div className="space-y-3">
            <div
              aria-live="polite"
              className="flex min-h-9 flex-wrap items-center gap-3"
            >
              {held !== null && held.winner !== null ? (
                <>
                  <p className="font-bold">
                    {held.label}: {names.name(held.winner)} wins {score(held)}
                  </p>
                  <Button
                    onClick={() => {
                      setHeldId(null);
                      props.onNextMatchup();
                    }}
                    size="sm"
                  >
                    Next matchup
                  </Button>
                </>
              ) : (
                <p className="font-bold">
                  {shown.label}: each judge votes for one entry
                </p>
              )}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[shown.a, shown.b].map((entryId, index) =>
                entryId === null ? null : (
                  <div key={entryId}>
                    {renderEntry(
                      entryId,
                      `${names.label(entryId)} · ${seed(entryId)}`,
                      sideControls(shown, index === 0 ? "a" : "b")
                    )}
                  </div>
                )
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
