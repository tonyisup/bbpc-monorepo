"use client";

import { Loader2 } from "lucide-react";
import {
  type FormEvent,
  type FC,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { Button } from "./ui/button";
import { Input } from "./ui/input";

export type WagerInput = {
  gamblingTypeId: string;
  points: number;
  assignmentId: string;
  targetUserId?: string;
};

export interface WagerType {
  id: string;
  multiplier: number;
}

export interface ExistingWager {
  points: number;
  status: string;
}

// Settlement awards whole points, rounding fractional profits down.
export function wagerProfit(points: number, multiplier: number) {
  return Math.floor(points * multiplier);
}

const quickAmounts = [10, 25, 50];

export const linkButton =
  "inline-flex min-h-11 items-center rounded-md text-[0.8125rem] font-semibold text-zinc-300 underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50";

interface BettingCoinProps {
  type: WagerType;
  targetHostId?: string;
  /** The hosts this bet rides on, as the listener sees them. */
  label: ReactNode;
  /** The same hosts in plain words, for button names. */
  name: string;
  existingBet: ExistingWager | undefined;
  assignmentId: string;
  userPoints: number;
  isEditing: boolean;
  /** Another bet on this board is being saved. */
  disabled?: boolean;
  onEdit: () => void;
  onClose: () => void;
  onSubmit: (input: WagerInput) => Promise<void>;
  formatSubmissionError?: (error: unknown) => string;
}

/** One bet in the wager list: a line to read, or the form that changes it. */
const BettingCoin: FC<BettingCoinProps> = ({
  type,
  targetHostId,
  label,
  name,
  existingBet,
  assignmentId,
  userPoints,
  isEditing,
  disabled = false,
  onEdit,
  onClose,
  onSubmit,
  formatSubmissionError,
}) => {
  const [amount, setAmount] = useState(existingBet?.points.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Closing the form puts focus back on the line's Add or Edit button.
  const lineButtonRef = useRef<HTMLButtonElement>(null);
  const focusLineButtonRef = useRef(false);
  useEffect(() => {
    if (isEditing || !focusLineButtonRef.current) return;
    focusLineButtonRef.current = false;
    lineButtonRef.current?.focus();
  }, [isEditing]);
  const isResolved = Boolean(existingBet && existingBet.status !== "pending");
  const currentAmount = existingBet?.points ?? 0;
  const maximumAmount = userPoints + currentAmount;
  const typedAmount = Number(amount);
  const points =
    Number.isInteger(typedAmount) &&
    typedAmount > 0 &&
    typedAmount <= maximumAmount
      ? typedAmount
      : null;
  // Every movie lists the same bets, so the movie is part of the id.
  const inputId = `wager-${assignmentId}-${type.id}-${targetHostId ?? "all"}`;

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
      focusLineButtonRef.current = true;
      onClose();
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirm = (event: FormEvent) => {
    event.preventDefault();
    if (points !== null) {
      void submit(points);
    } else if (!Number.isInteger(typedAmount) || typedAmount <= 0) {
      setError("Enter a whole number greater than zero.");
    } else {
      setError(`You can wager up to ${maximumAmount} points on this outcome.`);
    }
  };

  if (!isEditing) {
    return (
      <div className="flex min-h-12 items-center gap-x-4 border-t border-white/[0.07] py-1.5 text-sm">
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-4">
          {label}
          {currentAmount > 0 ? (
            <p className="whitespace-nowrap text-zinc-400">
              <b className="text-white">{currentAmount} pts</b> · wins +
              {wagerProfit(currentAmount, type.multiplier)}
            </p>
          ) : null}
        </div>
        {isResolved ? (
          <span className="shrink-0 text-right text-xs font-semibold text-zinc-400">
            Wager {existingBet?.status}
          </span>
        ) : (
          <button
            ref={lineButtonRef}
            type="button"
            className={cn(linkButton, "min-w-11 shrink-0 justify-end")}
            disabled={disabled}
            aria-label={`${
              currentAmount > 0 ? "Edit" : "Add"
            } wager on ${name}`}
            onClick={() => {
              setAmount(currentAmount > 0 ? currentAmount.toString() : "");
              setError(null);
              onEdit();
            }}
          >
            {currentAmount > 0 ? "Edit" : "Add"}
          </button>
        )}
      </div>
    );
  }

  return (
    <form
      className="-mx-2 mb-1.5 rounded-[0.625rem] border border-white/20 bg-[color:var(--bbpc-surface-raised)] p-3 sm:-mx-3.5 sm:p-3.5"
      onSubmit={confirm}
    >
      {label}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className="text-[0.8125rem] font-bold text-zinc-300"
        >
          Points to risk
        </label>
        <Input
          id={inputId}
          // The form only opens from this line's own Add or Edit button.
          autoFocus
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
          className="h-11 w-24 bg-black/30 font-bold tabular-nums"
          aria-describedby={`${inputId}-outcome`}
          aria-invalid={Boolean(error)}
          disabled={isSubmitting}
        />
        {[
          ...quickAmounts.filter((quick) => quick < maximumAmount),
          maximumAmount,
        ]
          .filter((quick) => quick > 0)
          .map((quick) => (
            <button
              key={quick}
              type="button"
              className="min-h-11 min-w-11 rounded-full border border-white/[0.12] px-3 text-[0.8125rem] font-bold text-zinc-300 hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
              disabled={isSubmitting}
              onClick={() => {
                setAmount(quick.toString());
                setError(null);
              }}
            >
              {quick === maximumAmount ? `Max ${quick}` : quick}
            </button>
          ))}
      </div>
      <p id={`${inputId}-outcome`} className="mt-3 text-sm text-zinc-300">
        {points !== null ? (
          <>
            Miss and you lose <b className="text-white">{points}</b>. Hit and
            you win{" "}
            <b className="text-white">
              +{wagerProfit(points, type.multiplier)}
            </b>
            , with your {points} back.
          </>
        ) : (
          `You can risk up to ${maximumAmount} points on this bet.`
        )}
      </p>
      {error && (
        <p className="mt-2 text-xs font-semibold text-red-300" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button type="submit" className="min-h-11" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : points !== null ? (
            `Confirm ${points} pts`
          ) : (
            "Confirm wager"
          )}
        </Button>
        <button
          type="button"
          className={linkButton}
          disabled={isSubmitting}
          onClick={() => {
            setError(null);
            focusLineButtonRef.current = true;
            onClose();
          }}
        >
          Cancel
        </button>
        {currentAmount > 0 && (
          <button
            type="button"
            className={cn(linkButton, "text-red-300 sm:ml-auto")}
            onClick={() => void submit(0)}
            disabled={isSubmitting}
          >
            Clear wager
          </button>
        )}
      </div>
    </form>
  );
};

export default BettingCoin;
