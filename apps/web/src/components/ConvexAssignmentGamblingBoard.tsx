"use client";

import { useConvex } from "convex/react";
import { Coins, Lock } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";

import BettingCoin, {
  type ExistingWager,
  type WagerInput,
  type WagerType,
  linkButton,
  wagerProfit,
} from "@/components/BettingCoin";
import RatingIcon from "@/components/RatingIcon";
import {
  type ConvexAssignmentWagerData,
  loadConvexAssignmentWagers,
  submitConvexWager,
} from "@/convex/wagers";
import { getConvexDomainErrorCode } from "@/convex/identity";
import type {
  ConvexPredictionGuess,
  ConvexPredictionHost,
} from "@/convex/predictions";
import {
  PredictionRoundState,
  getPredictionRoundState,
} from "@/lib/predictionRound.mjs";
import { cn } from "@/lib/utils";

const wagerHostIdentifiers = ["mcp", "fonso", "harley"] as const;
type WagerHostIdentifier = (typeof wagerHostIdentifiers)[number];

type WagerOption = {
  key: string;
  type: WagerType;
  targetHostId?: string;
  identifiers: WagerHostIdentifier[];
  /** The hosts in plain words, such as "MCP + Fonso". */
  name: string;
  bet: ExistingWager | undefined;
};

const fallbackHostNames: Record<WagerHostIdentifier, string> = {
  mcp: "MCP",
  fonso: "Fonso",
  harley: "Harley",
};

function firstName(host: ConvexPredictionHost | undefined, fallback: string) {
  return host?.name?.split(" ")[0] ?? fallback;
}

function wagerError(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Wager changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "Betting closed or your available point balance changed. Review the latest state and retry.";
    case "VALIDATION_FAILED":
      return "That wager is not valid for this assignment.";
    default:
      return "Couldn’t save this wager. Check your connection and retry.";
  }
}

export const ConvexAssignmentGamblingBoard: FC<{
  assignmentId: string;
  hosts: ConvexPredictionHost[];
  guesses: ConvexPredictionGuess[];
  episodeStatus: string;
  playable: boolean;
  closesAt: number | null;
  now: number;
}> = ({
  assignmentId,
  hosts,
  guesses,
  episodeStatus,
  playable,
  closesAt,
  now,
}) => {
  const convex = useConvex();
  const [data, setData] = useState<ConvexAssignmentWagerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  // One bet is edited at a time.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // While a bet saves, the other bets and Done wait, so its result always
  // has its own open form to land in.
  const [isSaving, setIsSaving] = useState(false);
  // Opening and closing the list swaps its toggle button; focus follows it.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusToggleRef = useRef(false);
  useEffect(() => {
    if (!focusToggleRef.current) return;
    focusToggleRef.current = false;
    toggleRef.current?.focus();
  }, [isEditorOpen]);
  const isRoundOpen =
    getPredictionRoundState(episodeStatus, playable, closesAt, now) ===
    PredictionRoundState.OPEN;

  const reload = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await loadConvexAssignmentWagers(convex, assignmentId);
      if (loadGenerationRef.current === generation) {
        setData(result);
      }
    } catch {
      if (loadGenerationRef.current === generation) {
        setLoadError("Couldn’t load wagering. Your wagers were not changed.");
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [assignmentId, convex]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (isLoading && data === null) {
    return (
      <div
        className="flex min-h-12 items-center gap-2.5 text-sm text-zinc-400"
        role="status"
      >
        <span className="bbpc-label sm:w-16">Wager</span>
        Loading wager options…
      </div>
    );
  }

  if (data === null) {
    return (
      <div
        className="flex min-h-12 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm"
        role="alert"
      >
        <span className="bbpc-label sm:w-16">Wager</span>
        <span className="text-red-100">{loadError}</span>
        <button
          type="button"
          className={cn(linkButton, "ml-auto")}
          onClick={() => void reload()}
        >
          Try again
        </button>
      </div>
    );
  }

  const getTypeFor = (lookupId: string) =>
    data.types.find((candidate) => candidate.lookupId === lookupId);

  const getBetFor = (lookupId: string, targetHostId?: string) => {
    const type = getTypeFor(lookupId);
    if (type === undefined) {
      return undefined;
    }
    return data.entries.find(
      (entry) =>
        entry.gamblingType.id === type.id &&
        (targetHostId
          ? entry.targetUser?.id === targetHostId
          : entry.targetUser === null)
    );
  };

  const getHostByIdentifier = (identifier: WagerHostIdentifier) =>
    hosts.find(
      (host) => firstName(host, "").toLowerCase() === identifier.toLowerCase()
    );

  const getHostIdentifiersForLookupId = (
    lookupId: string
  ): WagerHostIdentifier[] => {
    if (lookupId.startsWith("all-rating-guess-")) {
      return [...wagerHostIdentifiers];
    }
    const encodedHosts = lookupId.split("-rating-guess-")[0]?.split("-") ?? [];
    return encodedHosts.filter(
      (identifier): identifier is WagerHostIdentifier =>
        wagerHostIdentifiers.includes(identifier as WagerHostIdentifier)
    );
  };

  const getHostLabelForLookupId = (lookupId: string) =>
    getHostIdentifiersForLookupId(lookupId)
      .map((identifier) =>
        firstName(
          getHostByIdentifier(identifier),
          fallbackHostNames[identifier]
        )
      )
      .join(" + ");

  const handleSubmit = async (input: WagerInput) => {
    setIsSaving(true);
    try {
      await submitConvexWager(convex, input);
      await reload();
    } catch (error) {
      await reload();
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const groups = [
    {
      title: "One host",
      lookupIds: [
        "mcp-rating-guess-1x",
        "fonso-rating-guess-1x",
        "harley-rating-guess-1x",
      ],
    },
    {
      title: "Two hosts",
      lookupIds: [
        "mcp-fonso-rating-guess-2x",
        "mcp-harley-rating-guess-2x",
        "fonso-harley-rating-guess-2x",
      ],
    },
    { title: "All three", lookupIds: ["all-rating-guess-3x"] },
  ].map((group) => ({
    title: group.title,
    options: group.lookupIds.flatMap((lookupId): WagerOption[] => {
      const type = getTypeFor(lookupId);
      const identifiers = getHostIdentifiersForLookupId(lookupId);
      const [onlyHost] = identifiers;
      // A one-host bet names its host; the others cover the hosts together.
      const targetHostId =
        identifiers.length === 1 && onlyHost !== undefined
          ? getHostByIdentifier(onlyHost)?.id
          : undefined;
      if (type === undefined || (identifiers.length === 1 && !targetHostId)) {
        return [];
      }
      return [
        {
          key: `${lookupId}-${targetHostId ?? "all"}`,
          type,
          targetHostId,
          identifiers,
          name: getHostLabelForLookupId(lookupId),
          bet: getBetFor(lookupId, targetHostId),
        },
      ];
    }),
  }));
  const placed = groups
    .flatMap((group) => group.options)
    .filter((option) => (option.bet?.points ?? 0) > 0);
  // Only a pending bet is still at stake; a rejected or settled one is not.
  const live = placed.filter((option) => option.bet?.status === "pending");
  const staked = live.reduce(
    (total, option) => total + (option.bet?.points ?? 0),
    0
  );
  const possibleWin = live.reduce(
    (total, option) =>
      total + wagerProfit(option.bet?.points ?? 0, option.type.multiplier),
    0
  );

  /** The hosts a bet rides on, each with the rating the listener picked. */
  const renderHosts = (option: WagerOption) => (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold text-white">
      {option.identifiers.map((identifier, index) => {
        const host = getHostByIdentifier(identifier);
        const guess = guesses.find(
          (candidate) => candidate.hostId === host?.id
        );
        return (
          <span
            key={identifier}
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {index > 0 ? (
              <span className="mr-0.5 font-normal text-zinc-500">+</span>
            ) : null}
            {firstName(host, fallbackHostNames[identifier])}
            {guess ? <RatingIcon value={guess.rating.value} /> : null}
          </span>
        );
      })}
    </p>
  );

  const describeBet = (option: WagerOption) =>
    option.identifiers.length === wagerHostIdentifiers.length
      ? "all three hosts"
      : option.name;

  if (!isRoundOpen) {
    return (
      <div className="flex min-h-12 flex-wrap items-baseline gap-x-2.5 gap-y-1 py-3 text-sm">
        <span className="bbpc-label sm:w-16">Wager</span>
        {placed.length === 0 ? (
          <span className="text-zinc-400">No wagers</span>
        ) : (
          <ul className="space-y-1.5">
            {placed.map((option) => (
              <li
                key={option.key}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
              >
                <span className="text-zinc-300">
                  <b className="text-white">{option.bet?.points} pts</b> on{" "}
                  {describeBet(option)}
                </span>
                <Multiplier value={option.type.multiplier} />
                <span className="inline-flex items-center gap-1.5 text-zinc-400">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {option.bet?.status === "pending"
                    ? "locked"
                    : option.bet?.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (!isEditorOpen) {
    const only = live.length === 1 ? live[0] : undefined;
    return (
      <div className="flex min-h-12 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
        <span className="bbpc-label sm:w-16">Wager</span>
        {only ? (
          <>
            <span className="text-zinc-300">
              <b className="text-white">{staked} pts</b> on {describeBet(only)}
            </span>
            <Multiplier value={only.type.multiplier} />
            <span className="text-zinc-400">
              +{possibleWin} if{" "}
              {only.identifiers.length === 1
                ? "it matches"
                : only.identifiers.length === 2
                ? "both match"
                : "they all match"}
            </span>
          </>
        ) : live.length > 1 ? (
          <>
            <span className="text-zinc-300">
              <b className="text-white">{staked} pts</b> on {live.length} bets
            </span>
            <span className="text-zinc-400">up to +{possibleWin}</span>
          </>
        ) : (
          <span className="text-zinc-400">
            {placed.length > 0
              ? "None at stake."
              : "Optional. None placed yet."}
          </span>
        )}
        <button
          ref={toggleRef}
          type="button"
          className={cn(linkButton, "ml-auto")}
          aria-expanded={false}
          onClick={() => {
            focusToggleRef.current = true;
            setIsEditorOpen(true);
            // Another movie's wager may have changed the balance since.
            void reload();
          }}
        >
          {placed.length > 0 ? "Change" : "Add a wager"}
        </button>
      </div>
    );
  }

  return (
    <div className="pb-1 pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="bbpc-label">Wager</span>
        <span className="inline-flex items-center gap-1.5 text-sm text-zinc-400 sm:ml-auto">
          <Coins className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
          <b className="text-white">{data.availablePoints}</b> pts available
        </span>
        <button
          ref={toggleRef}
          type="button"
          className={cn(linkButton, "ml-auto min-w-11 justify-end sm:ml-0")}
          aria-expanded
          disabled={isSaving}
          onClick={() => {
            focusToggleRef.current = true;
            setEditingKey(null);
            setIsEditorOpen(false);
          }}
        >
          Done
        </button>
      </div>
      <p className="mt-0.5 text-[0.8125rem] text-zinc-400">
        Optional. Each line is its own bet on your saved picks, and a miss costs
        the points you risked.
      </p>

      {loadError !== null ? (
        <p
          className="mt-3 rounded-lg border border-red-500/30 bg-red-500/[0.08] p-3 text-sm text-red-100"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {groups.map((group) => {
        const multiplier = group.options[0]?.type.multiplier;
        return multiplier === undefined ? null : (
          <section key={group.title} className="mt-3.5">
            <h4 className="bbpc-label flex items-center gap-2 pb-1.5">
              {group.title}
              <Multiplier value={multiplier} />
            </h4>
            {group.options.map((option) => (
              <BettingCoin
                key={option.key}
                type={option.type}
                targetHostId={option.targetHostId}
                label={renderHosts(option)}
                name={option.name}
                existingBet={option.bet}
                assignmentId={assignmentId}
                userPoints={data.availablePoints}
                isEditing={editingKey === option.key}
                disabled={isSaving}
                onEdit={() => setEditingKey(option.key)}
                onClose={() =>
                  setEditingKey((current) =>
                    current === option.key ? null : current
                  )
                }
                onSubmit={handleSubmit}
                formatSubmissionError={wagerError}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
};

function Multiplier({ value }: { value: number }) {
  return (
    <span className="rounded-full border border-white/[0.12] px-1.5 py-px text-[0.6875rem] font-extrabold normal-case tracking-normal text-zinc-300">
      {value}x
    </span>
  );
}
