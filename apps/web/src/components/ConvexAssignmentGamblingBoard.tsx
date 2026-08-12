"use client";

import { useConvex } from "convex/react";
import { AlertTriangle, Coins } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FC } from "react";

import BettingCoin, {
  type PayoutTone,
  type WagerInput,
} from "@/components/BettingCoin";
import RatingIcon from "@/components/RatingIcon";
import { Button } from "@/components/ui/button";
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

type WagerOption = {
  lookupId: string;
  label: string;
  description: string;
  targetHostId?: string;
};

const wagerHostIdentifiers = ["mcp", "fonso", "harley"] as const;
type WagerHostIdentifier = (typeof wagerHostIdentifiers)[number];

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
}> = ({ assignmentId, hosts, guesses, episodeStatus, playable }) => {
  const convex = useConvex();
  const [data, setData] = useState<ConvexAssignmentWagerData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const isRoundOpen =
    getPredictionRoundState(episodeStatus, playable) ===
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
        className="rounded-lg bg-white/[0.03] p-4 text-sm text-zinc-400"
        role="status"
      >
        Loading wager options…
      </div>
    );
  }

  if (data === null) {
    return (
      <div
        className="rounded-lg border border-red-500/30 bg-red-500/[0.08] p-4"
        role="alert"
      >
        <p className="font-bold text-white">Couldn&apos;t load wagering.</p>
        <p className="mt-1 text-sm text-zinc-300">{loadError}</p>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => void reload()}
        >
          Try again
        </Button>
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

  const getSingleHostForLookupId = (lookupId: string) => {
    const identifier = getHostIdentifiersForLookupId(lookupId)[0];
    return identifier ? getHostByIdentifier(identifier) : undefined;
  };

  const handleSubmit = async (input: WagerInput) => {
    try {
      await submitConvexWager(convex, input);
      await reload();
    } catch (error) {
      await reload();
      throw error;
    }
  };

  const hostOptions: WagerOption[] = [
    {
      lookupId: "mcp-rating-guess-1x",
      targetHostId: getSingleHostForLookupId("mcp-rating-guess-1x")?.id,
      label: `${getHostLabelForLookupId("mcp-rating-guess-1x")}’s rating`,
      description: "Win if this one host matches your saved pick.",
    },
    {
      lookupId: "fonso-rating-guess-1x",
      targetHostId: getSingleHostForLookupId("fonso-rating-guess-1x")?.id,
      label: `${getHostLabelForLookupId("fonso-rating-guess-1x")}’s rating`,
      description: "Win if this one host matches your saved pick.",
    },
    {
      lookupId: "harley-rating-guess-1x",
      targetHostId: getSingleHostForLookupId("harley-rating-guess-1x")?.id,
      label: `${getHostLabelForLookupId("harley-rating-guess-1x")}’s rating`,
      description: "Win if this one host matches your saved pick.",
    },
  ].filter((option) => option.targetHostId);

  const pairOptions: WagerOption[] = [
    {
      lookupId: "mcp-fonso-rating-guess-2x",
      label: getHostLabelForLookupId("mcp-fonso-rating-guess-2x"),
      description: "Win only if both hosts match your saved picks.",
    },
    {
      lookupId: "mcp-harley-rating-guess-2x",
      label: getHostLabelForLookupId("mcp-harley-rating-guess-2x"),
      description: "Win only if both hosts match your saved picks.",
    },
    {
      lookupId: "fonso-harley-rating-guess-2x",
      label: getHostLabelForLookupId("fonso-harley-rating-guess-2x"),
      description: "Win only if both hosts match your saved picks.",
    },
  ];

  const allOptions: WagerOption[] = [
    {
      lookupId: "all-rating-guess-3x",
      label: getHostLabelForLookupId("all-rating-guess-3x"),
      description: "Win only if every host matches your saved picks.",
    },
  ];

  const getPayoutMultiplier = (options: WagerOption[]) =>
    options
      .map((option) => getTypeFor(option.lookupId)?.multiplier)
      .find((multiplier) => multiplier !== undefined);

  const renderOptions = (options: WagerOption[], payoutTone: PayoutTone) =>
    options.map((option) => {
      const type = getTypeFor(option.lookupId);
      return type ? (
        <BettingCoin
          key={`${option.lookupId}-${option.targetHostId ?? "all"}`}
          type={type}
          targetHostId={option.targetHostId}
          label={option.label}
          description={option.description}
          payoutTone={payoutTone}
          existingBet={getBetFor(option.lookupId, option.targetHostId)}
          assignmentId={assignmentId}
          userPoints={data.availablePoints}
          isRoundOpen={isRoundOpen}
          onSubmit={handleSubmit}
          formatSubmissionError={wagerError}
        />
      ) : null;
    });

  return (
    <div className="space-y-5">
      {loadError !== null ? (
        <div
          className="rounded-lg border border-red-500/30 bg-red-500/[0.08] p-3 text-sm text-red-100"
          role="alert"
        >
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <p className="flex items-center gap-2 font-bold text-white">
            <AlertTriangle
              className="h-4 w-4 text-amber-300"
              aria-hidden="true"
            />
            † Wagers can lose points
          </p>
          <p className="mt-1 text-sm leading-relaxed text-zinc-300">
            A loss deducts your wager. A win returns the wager plus the listed
            multiplier payout.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-black/25 px-3 py-2 text-sm">
          <Coins className="h-4 w-4 text-amber-300" aria-hidden="true" />
          <span className="text-zinc-400">Available</span>
          <strong className="text-white">{data.availablePoints} points</strong>
        </div>
      </div>

      {!isRoundOpen ? (
        <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm font-semibold text-amber-100">
          Betting is closed. Existing wagers are locked and shown below.
        </p>
      ) : null}

      <div className="rounded-lg bg-white/[0.025] p-3">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-500">
          Your saved picks
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          {hosts.map((host) => {
            const guess = guesses.find(
              (candidate) => candidate.hostId === host.id
            );
            return (
              <li
                key={host.id}
                className="flex items-center gap-2 text-sm text-zinc-300"
              >
                <span className="font-semibold text-white">
                  {host.name ?? "Host"}
                </span>
                {guess ? (
                  <RatingIcon value={guess.rating.value} />
                ) : (
                  <span>Not picked</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <WagerGroup
        title="One host"
        payoutMultiplier={getPayoutMultiplier(hostOptions)}
        payoutTone="standard"
        description="Lower risk: one result must match."
      >
        {renderOptions(hostOptions, "standard")}
      </WagerGroup>
      <WagerGroup
        title="Two hosts"
        payoutMultiplier={getPayoutMultiplier(pairOptions)}
        payoutTone="boosted"
        description="Both selected results must match."
      >
        {renderOptions(pairOptions, "boosted")}
      </WagerGroup>
      <WagerGroup
        title="All hosts"
        payoutMultiplier={getPayoutMultiplier(allOptions)}
        payoutTone="maximum"
        description="Highest risk: all three results must match."
      >
        {renderOptions(allOptions, "maximum")}
      </WagerGroup>
    </div>
  );
};

function WagerGroup({
  title,
  payoutMultiplier,
  payoutTone,
  description,
  children,
}: {
  title: string;
  payoutMultiplier: number | undefined;
  payoutTone: PayoutTone;
  description: string;
  children: React.ReactNode;
}) {
  const sectionTone =
    payoutTone === "standard"
      ? "border-cyan-400/20 bg-cyan-400/[0.035]"
      : payoutTone === "boosted"
      ? "border-amber-400/20 bg-amber-400/[0.035]"
      : "border-rose-400/20 bg-rose-400/[0.035]";
  const payoutBadge =
    payoutTone === "standard"
      ? "border-cyan-300/30 bg-cyan-400/10 text-cyan-200"
      : payoutTone === "boosted"
      ? "border-amber-300/30 bg-amber-400/10 text-amber-200"
      : "border-rose-300/30 bg-rose-400/10 text-rose-200";

  return (
    <section className={cn("rounded-xl border p-3 sm:p-4", sectionTone)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 className="font-black text-white">{title}</h4>
        {payoutMultiplier !== undefined ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-black",
              payoutBadge
            )}
          >
            {payoutMultiplier}x payout
          </span>
        ) : null}
        <p className="basis-full text-xs text-zinc-400">{description}</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">{children}</div>
    </section>
  );
}
