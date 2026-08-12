"use client";

import { Loader2 } from "lucide-react";
import { type FormEvent, type FC, useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "./ui/button";
import { Input } from "./ui/input";

export type WagerInput = {
  gamblingTypeId: string;
  points: number;
  assignmentId: string;
  targetUserId?: string;
};

export type PayoutTone = "standard" | "boosted" | "maximum";

export interface WagerType {
  id: string;
  multiplier: number;
}

export interface ExistingWager {
  points: number;
  status: string;
}

interface BettingCoinProps {
  type: WagerType;
  targetHostId?: string;
  label: string;
  description: string;
  payoutTone: PayoutTone;
  existingBet: ExistingWager | undefined;
  assignmentId: string;
  userPoints: number;
  isRoundOpen: boolean;
  onSubmit: (input: WagerInput) => Promise<void>;
  formatSubmissionError?: (error: unknown) => string;
}

const BettingCoin: FC<BettingCoinProps> = ({
  type,
  targetHostId,
  label,
  description,
  payoutTone,
  existingBet,
  assignmentId,
  userPoints,
  isRoundOpen,
  onSubmit,
  formatSubmissionError,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [amount, setAmount] = useState(existingBet?.points.toString() ?? "");
  const [reviewAmount, setReviewAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isResolved = Boolean(existingBet && existingBet.status !== "pending");
  const isLocked = !isRoundOpen || isResolved;
  const currentAmount = existingBet?.points ?? 0;
  const maximumAmount = userPoints + currentAmount;
  const payoutBorder =
    payoutTone === "standard"
      ? "border-cyan-400/20"
      : payoutTone === "boosted"
      ? "border-amber-400/20"
      : "border-rose-400/20";
  const payoutBadge =
    payoutTone === "standard"
      ? "border-cyan-300/30 bg-cyan-400/10 text-cyan-200"
      : payoutTone === "boosted"
      ? "border-amber-300/30 bg-amber-400/10 text-amber-200"
      : "border-rose-300/30 bg-rose-400/10 text-rose-200";

  const validateAmount = () => {
    const points = Number(amount);
    if (!Number.isInteger(points) || points <= 0) {
      setError("Enter a whole number greater than zero.");
      return null;
    }
    if (points > maximumAmount) {
      setError(`You can wager up to ${maximumAmount} points on this outcome.`);
      return null;
    }
    setError(null);
    return points;
  };

  const prepareReview = (event: FormEvent) => {
    event.preventDefault();
    const points = validateAmount();
    if (points !== null) setReviewAmount(points);
  };

  const submit = async (points: number) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        gamblingTypeId: type.id,
        points,
        assignmentId,
        targetUserId: targetHostId,
      });
      setAmount(points > 0 ? points.toString() : "");
      setReviewAmount(null);
      setIsEditing(false);
    } catch (submissionError) {
      const message =
        formatSubmissionError?.(submissionError) ??
        (submissionError instanceof Error ? submissionError.message : "");
      setError(
        message.includes("ROUND_LOCKED")
          ? "Betting closed before this wager could be saved."
          : message ||
              "Couldn’t save this wager. Check your connection and retry."
      );
      setReviewAmount(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-black/20 p-3",
        currentAmount > 0 ? "border-emerald-400/30" : payoutBorder
      )}
    >
      <div className="flex min-h-11 items-start justify-between gap-3">
        <div>
          <p className="font-bold text-white">{label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
            {description}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-md border px-2.5 py-1 text-sm font-black tabular-nums",
            payoutBadge
          )}
        >
          <span className="mr-1 text-[10px] uppercase tracking-wider opacity-70">
            Pays
          </span>
          {type.multiplier}x
        </span>
      </div>

      {currentAmount > 0 && (
        <p className="mt-3 text-sm font-semibold text-emerald-300">
          {currentAmount} points {isLocked ? "locked" : "wagered"}
        </p>
      )}

      {isLocked ? (
        <p className="mt-3 text-xs text-zinc-500">
          {currentAmount > 0
            ? isResolved
              ? `Wager ${existingBet?.status ?? "locked"}.`
              : "This wager can’t be changed after picks close."
            : "Betting closed for this outcome."}
        </p>
      ) : !isEditing ? (
        <Button
          type="button"
          className="mt-3 min-h-11 w-full"
          variant="outline"
          onClick={() => {
            setAmount(currentAmount > 0 ? currentAmount.toString() : "");
            setError(null);
            setIsEditing(true);
          }}
        >
          {currentAmount > 0 ? "Edit wager" : "Set wager"}
        </Button>
      ) : reviewAmount === null ? (
        <form className="mt-3 space-y-3" onSubmit={prepareReview}>
          <div>
            <label
              htmlFor={`wager-${type.id}-${targetHostId ?? "all"}`}
              className="text-xs font-bold text-zinc-300"
            >
              Points to risk
            </label>
            <Input
              id={`wager-${type.id}-${targetHostId ?? "all"}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={maximumAmount}
              step={1}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setError(null);
              }}
              className="mt-1 h-11 bg-black/30"
              aria-describedby={`wager-help-${type.id}-${
                targetHostId ?? "all"
              }`}
              aria-invalid={Boolean(error)}
              disabled={isSubmitting}
            />
            <p
              id={`wager-help-${type.id}-${targetHostId ?? "all"}`}
              className="mt-1 text-xs text-zinc-500"
            >
              Available: {userPoints} points · Maximum here: {maximumAmount}
            </p>
          </div>
          {error && (
            <p className="text-xs font-semibold text-red-300" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              className="min-h-11 flex-1"
              disabled={isSubmitting}
            >
              Review wager
            </Button>
            <Button
              type="button"
              className="min-h-11"
              variant="ghost"
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {currentAmount > 0 && (
            <Button
              type="button"
              className="min-h-11 w-full text-red-300"
              variant="ghost"
              onClick={() => void submit(0)}
              disabled={isSubmitting}
            >
              Clear wager
            </Button>
          )}
        </form>
      ) : (
        <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3">
          <p className="font-bold text-white">Confirm {reviewAmount} points?</p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-300">
            A loss costs {reviewAmount} points. A win returns your wager plus a{" "}
            {type.multiplier}x payout.
          </p>
          {error && (
            <p className="mt-2 text-xs font-semibold text-red-300" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              className="min-h-11 flex-1"
              onClick={() => void submit(reviewAmount)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : (
                "Confirm wager"
              )}
            </Button>
            <Button
              type="button"
              className="min-h-11"
              variant="ghost"
              onClick={() => setReviewAmount(null)}
              disabled={isSubmitting}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BettingCoin;
