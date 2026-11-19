"use client";

import { useConvex } from "convex/react";
import {
  Bug,
  CheckCircle2,
  Lightbulb,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Sparkles,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useId, useState, type KeyboardEvent } from "react";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ConvexFeedbackCategory,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  submitConvexFeedback,
  toFeedbackPagePath,
} from "@/convex/feedback";
import { getConvexDomainErrorCode } from "@/convex/identity";
import { cn } from "@/lib/utils";

const CATEGORIES: ReadonlyArray<{
  value: ConvexFeedbackCategory;
  label: string;
  icon: typeof Bug;
  placeholder: string;
}> = [
  {
    value: "bug",
    label: "Bug",
    icon: Bug,
    placeholder: "What went wrong, and what did you expect to happen?",
  },
  {
    value: "idea",
    label: "Idea",
    icon: Lightbulb,
    placeholder: "What would make the site better for you?",
  },
  {
    value: "praise",
    label: "Praise",
    icon: Sparkles,
    placeholder: "What's working well?",
  },
  {
    value: "other",
    label: "Other",
    icon: MessageSquare,
    placeholder: "What's on your mind?",
  },
];

// Show the counter only once it matters.
const COUNTER_THRESHOLD = FEEDBACK_MESSAGE_MAX_LENGTH - 200;

function failureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "You've sent a lot of feedback in the last hour. Try again a bit later.";
    case "WRITE_DISABLED":
      return "Feedback is paused right now. Try again later.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh and try again.";
    case "AUTHENTICATION_REQUIRED":
      return "Your session ended. Sign in again to send feedback.";
    case "VALIDATION_FAILED":
      return "Check your message and try again.";
    default:
      return "Your feedback couldn't be sent. Try again.";
  }
}

export function SendFeedback() {
  const { accountStatus, signIn, user } = useBbpcAuth();
  const convex = useConvex();
  const pathname = usePathname();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ConvexFeedbackCategory | null>(
    null
  );
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Matches what the backend counts: trimmed, NFC-normalized text.
  const length = message.trim().normalize("NFC").length;
  const tooLong = length > FEEDBACK_MESSAGE_MAX_LENGTH;
  const canSend =
    length > 0 && !tooLong && !sending && accountStatus === "ready";
  const pagePath = toFeedbackPagePath(pathname);
  const placeholder =
    CATEGORIES.find((option) => option.value === category)?.placeholder ??
    "Tell us about a bug, an idea, or something you love.";

  const reset = () => {
    setCategory(null);
    setMessage("");
    setError(null);
    setSent(false);
  };

  const send = () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    void submitConvexFeedback(convex, {
      category: category ?? "other",
      message,
      pagePath,
    })
      .then(() => setSent(true))
      .catch((reason: unknown) => setError(failureMessage(reason)))
      .finally(() => setSending(false));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  };

  const trigger = (
    <button
      type="button"
      onClick={user === null ? signIn : () => setOpen(true)}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 text-sm font-medium text-zinc-200 transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    >
      <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
      {user === null ? "Sign in to send feedback" : "Send feedback"}
    </button>
  );

  return (
    <div className="flex flex-col items-center gap-2 px-4 pb-6 text-center">
      <p className="text-sm text-zinc-400">
        Found a bug or have an idea for the site?
      </p>
      {trigger}
      {user !== null && (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            // Keep an unsent draft; start fresh after a successful send.
            if (!next && sent) reset();
          }}
        >
          <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] gap-0 overflow-y-auto rounded-xl border-white/10 bg-[color:var(--bbpc-surface)] p-0 text-zinc-100 sm:max-w-lg">
            {sent ? (
              <div
                className="flex flex-col items-center gap-3 px-6 py-10 text-center"
                role="status"
              >
                <CheckCircle2
                  className="h-10 w-10 text-emerald-400"
                  aria-hidden="true"
                />
                <DialogTitle className="text-lg font-semibold">
                  Thanks for the feedback
                </DialogTitle>
                <DialogDescription className="max-w-xs text-sm text-zinc-400">
                  It&apos;s in the crew&apos;s inbox. We read every note.
                </DialogDescription>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="min-h-10 rounded-md px-4 text-sm text-zinc-300 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Send more
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      reset();
                    }}
                    className="min-h-10 rounded-md bg-white px-4 text-sm font-semibold text-black transition-colors hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <DialogHeader className="space-y-1 border-b border-white/10 px-6 pb-4 pt-6 text-left">
                  <DialogTitle className="text-lg font-semibold">
                    Send feedback
                  </DialogTitle>
                  <DialogDescription className="text-sm text-zinc-400">
                    Tell us what&apos;s broken, what you&apos;d love to see, or
                    what&apos;s working.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 px-6 py-5">
                  <fieldset>
                    <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                      What kind of feedback?{" "}
                      <span className="normal-case tracking-normal text-zinc-500">
                        (optional)
                      </span>
                    </legend>
                    <div
                      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                      role="group"
                      aria-label="Feedback type"
                    >
                      {CATEGORIES.map((option) => {
                        const selected = category === option.value;
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setCategory(selected ? null : option.value)
                            }
                            className={cn(
                              "flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500",
                              selected
                                ? "border-red-500/60 bg-red-500/15 text-red-100"
                                : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/25 hover:text-white"
                            )}
                          >
                            <Icon className="h-4 w-4" aria-hidden="true" />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div>
                    <label
                      htmlFor={fieldId}
                      className="mb-2 block text-xs font-medium uppercase tracking-wide text-zinc-400"
                    >
                      Your feedback
                    </label>
                    <textarea
                      id={fieldId}
                      value={message}
                      onChange={(event) => {
                        setMessage(event.target.value);
                        setError(null);
                      }}
                      onKeyDown={onKeyDown}
                      placeholder={placeholder}
                      rows={5}
                      aria-invalid={tooLong}
                      aria-describedby={`${fieldId}-hint`}
                      className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-red-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 sm:text-sm"
                    />
                    <div
                      id={`${fieldId}-hint`}
                      className="mt-1.5 flex items-start justify-between gap-3 text-xs text-zinc-500"
                    >
                      <span>
                        {pagePath !== null && (
                          <>
                            Sent from{" "}
                            <span className="font-mono text-zinc-400">
                              {pagePath}
                            </span>
                            .{" "}
                          </>
                        )}
                        The crew sees your name and email so they can follow
                        up.
                      </span>
                      {length > COUNTER_THRESHOLD && (
                        <span
                          className={cn(
                            "shrink-0 tabular-nums",
                            tooLong && "text-red-400"
                          )}
                        >
                          {length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
                        </span>
                      )}
                    </div>
                  </div>

                  {accountStatus !== "ready" && (
                    <p className="text-sm text-zinc-400">
                      Finish setting up your account to send feedback.
                    </p>
                  )}
                  {error !== null && (
                    <p
                      role="alert"
                      className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                    >
                      {error}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-black/20 px-6 py-4">
                  <span className="hidden text-xs text-zinc-500 sm:inline">
                    Ctrl/⌘ + Enter to send
                  </span>
                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="min-h-10 rounded-md px-4 text-sm text-zinc-300 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!canSend}
                      className="inline-flex min-h-10 items-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {sending && (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      {sending ? "Sending…" : "Send feedback"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
