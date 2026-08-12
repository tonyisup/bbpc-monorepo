"use client";

import { useConvex } from "convex/react";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { toast } from "sonner";

import { AdminCollapsibleHeader } from "@/components/AdminCollapsibleHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  type ConvexCurrentQuoteSubmission,
  type ConvexQuoteSourceType,
  loadConvexQuotabunga,
  submitConvexQuotabunga,
  withdrawConvexQuotabunga,
} from "@/convex/quotabunga";
import { getConvexDomainErrorCode } from "@/convex/identity";
import { useAdminCollapse } from "@/hooks/useAdminCollapse";
import { cn } from "@/lib/utils";

function operationError(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "WRITE_DISABLED":
      return "Quotabunga changes are paused while this environment is read-only.";
    case "STALE_CLIENT":
      return "This page is out of date. Refresh it before trying again.";
    case "CONFLICT":
      return "This round was locked or changed. The latest state has been reloaded.";
    case "VALIDATION_FAILED":
      return "That Quotabunga entry is not valid. Check the form and try again.";
    default:
      return "Your Quotabunga entry could not be saved.";
  }
}

function sourceTypeLabel(sourceType: ConvexQuoteSourceType) {
  switch (sourceType) {
    case "TV":
      return "Television";
    case "MOVIE":
      return "Movie";
    default:
      return "Other";
  }
}

export function ConvexQuotabungaSubmission({ isAdmin }: { isAdmin: boolean }) {
  const convex = useConvex();
  const [current, setCurrent] = useState<ConvexCurrentQuoteSubmission | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [quoteText, setQuoteText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceType, setSourceType] = useState<ConvexQuoteSourceType>("MOVIE");
  const [clipUrl, setClipUrl] = useState("");
  const [clipStartSeconds, setClipStartSeconds] = useState("");
  const [listenerNotes, setListenerNotes] = useState("");
  const loadGenerationRef = useRef(0);
  const { isAdminCollapsed, isContentVisible, headerProps } =
    useAdminCollapse(isAdmin);

  const submission = current?.submission ?? null;

  const resetForm = useCallback(() => {
    setQuoteText("");
    setSourceTitle("");
    setSourceType("MOVIE");
    setClipUrl("");
    setClipStartSeconds("");
    setListenerNotes("");
  }, []);

  const reload = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = await loadConvexQuotabunga(convex);
      if (loadGenerationRef.current === generation) {
        setCurrent(result);
      }
    } catch {
      if (loadGenerationRef.current === generation) {
        setErrorMessage(
          "Could not load your Quotabunga entry. Please try again."
        );
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setIsLoading(false);
      }
    }
  }, [convex]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (submission === null) {
      resetForm();
      setIsEditing(true);
      return;
    }
    setQuoteText(submission.quoteText);
    setSourceTitle(submission.sourceTitle);
    setSourceType(submission.sourceType);
    setClipUrl(submission.clipUrl ?? "");
    setClipStartSeconds(submission.clipStartSeconds?.toString() ?? "");
    setListenerNotes(submission.listenerNotes ?? "");
    setIsEditing(false);
  }, [resetForm, submission]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuote = quoteText.trim();
    const normalizedSource = sourceTitle.trim();
    const normalizedClipUrl = clipUrl.trim();
    const normalizedNotes = listenerNotes.trim();
    const parsedClipStart =
      clipStartSeconds.trim() === "" ? null : Number(clipStartSeconds);

    if (
      normalizedQuote.length === 0 ||
      normalizedSource.length === 0 ||
      (parsedClipStart !== null &&
        (!Number.isSafeInteger(parsedClipStart) ||
          parsedClipStart < 0 ||
          parsedClipStart > 86_400))
    ) {
      setErrorMessage(
        "Add a quote and source. Clip start must be a whole number from 0 through 86400."
      );
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    try {
      await submitConvexQuotabunga(convex, {
        quoteText: normalizedQuote,
        sourceTitle: normalizedSource,
        sourceType,
        clipUrl: normalizedClipUrl || null,
        clipStartSeconds: parsedClipStart,
        listenerNotes: normalizedNotes || null,
      });
      await reload();
      setIsEditing(false);
      toast.success("Your Quotabunga entry is in!");
    } catch (error) {
      const message = operationError(error);
      setErrorMessage(message);
      toast.error(message);
      if (getConvexDomainErrorCode(error) === "CONFLICT") {
        await reload();
      }
    } finally {
      setIsSaving(false);
    }
  };

  const withdraw = async () => {
    if (!window.confirm("Withdraw this Quotabunga entry?")) {
      return;
    }
    setIsWithdrawing(true);
    setErrorMessage(null);
    try {
      await withdrawConvexQuotabunga(convex);
      resetForm();
      await reload();
      setIsEditing(true);
      toast.success("Submission withdrawn");
    } catch (error) {
      const message = operationError(error);
      setErrorMessage(message);
      toast.error(message);
      if (getConvexDomainErrorCode(error) === "CONFLICT") {
        await reload();
      }
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <section
      id="quotabunga-submit"
      className="rounded-lg border border-blue-500/30 bg-gray-900 p-6 shadow-lg"
    >
      <AdminCollapsibleHeader
        isAdmin={isAdmin}
        isAdminCollapsed={isAdminCollapsed}
        className={cn(
          "gap-1",
          isContentVisible && "mb-5",
          !isAdmin && "text-center"
        )}
        titleWrapperClassName={cn(!isAdmin && "w-full text-center")}
        title={
          <h2 className="text-2xl font-bold text-blue-400">
            Submit to Quotabunga
          </h2>
        }
        description={
          isContentVisible ? (
            <p className="mt-1 text-sm text-gray-400">
              One quote per listener, per episode.
            </p>
          ) : undefined
        }
        {...headerProps}
      />

      {isContentVisible ? (
        <>
          {errorMessage ? (
            <div
              className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
              role="alert"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{errorMessage}</span>
                {!isSaving && !isWithdrawing ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void reload()}
                  >
                    Try again
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {isLoading && current === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin" aria-label="Loading entry" />
            </div>
          ) : current?.episode === null ? (
            <p className="text-center text-gray-300">
              Submissions are closed until the next episode is announced.
            </p>
          ) : current !== null && !current.isOpen && submission === null ? (
            <p className="text-center text-gray-300">
              Submissions for episode {current.episode?.number} are locked.
            </p>
          ) : submission !== null && !isEditing ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                <div className="mb-3 flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">
                    Submitted for episode {current?.episode?.number}
                  </span>
                </div>
                <blockquote className="whitespace-pre-wrap text-lg text-white">
                  &ldquo;{submission.quoteText}&rdquo;
                </blockquote>
                <p className="mt-2 text-sm text-gray-400">
                  {submission.sourceTitle} ·{" "}
                  {sourceTypeLabel(submission.sourceType)}
                </p>
                {submission.clipUrl ? (
                  <a
                    href={submission.clipUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-blue-400 underline"
                  >
                    View submitted clip
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
              </div>

              {current?.isOpen && !submission.scored ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsEditing(true)}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={isWithdrawing}
                    onClick={() => void withdraw()}
                  >
                    {isWithdrawing ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Withdraw
                  </Button>
                </div>
              ) : (
                <p className="text-center text-sm font-medium text-amber-400">
                  {submission.scored
                    ? "This entry has been scored and can no longer be changed."
                    : "This round is locked for recording."}
                </p>
              )}
            </div>
          ) : current !== null ? (
            <form
              className="space-y-4"
              onSubmit={(event) => void handleSubmit(event)}
            >
              <div className="space-y-2">
                <label
                  htmlFor="convex-quotabunga-quote"
                  className="text-sm font-semibold"
                >
                  Quote or scene
                </label>
                <Textarea
                  id="convex-quotabunga-quote"
                  required
                  maxLength={2000}
                  value={quoteText}
                  onChange={(event) => setQuoteText(event.target.value)}
                  placeholder="Type the exact quote or describe the quote-worthy scene..."
                  className="min-h-28"
                />
                <p className="text-right text-xs text-gray-500">
                  {quoteText.length}/2000
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <label
                    htmlFor="convex-quotabunga-source"
                    className="text-sm font-semibold"
                  >
                    Movie or show
                  </label>
                  <Input
                    id="convex-quotabunga-source"
                    required
                    maxLength={500}
                    value={sourceTitle}
                    onChange={(event) => setSourceTitle(event.target.value)}
                    placeholder="Heat"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="convex-quotabunga-source-type"
                    className="text-sm font-semibold"
                  >
                    Source type
                  </label>
                  <select
                    id="convex-quotabunga-source-type"
                    value={sourceType}
                    onChange={(event) =>
                      setSourceType(event.target.value as ConvexQuoteSourceType)
                    }
                    className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="MOVIE">Movie</option>
                    <option value="TV">Television</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                <div className="space-y-2">
                  <label
                    htmlFor="convex-quotabunga-clip"
                    className="text-sm font-semibold"
                  >
                    Clip link{" "}
                    <span className="font-normal text-gray-500">
                      (optional)
                    </span>
                  </label>
                  <Input
                    id="convex-quotabunga-clip"
                    type="url"
                    maxLength={2000}
                    value={clipUrl}
                    onChange={(event) => setClipUrl(event.target.value)}
                    placeholder="https://youtube.com/..."
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="convex-quotabunga-timestamp"
                    className="text-sm font-semibold"
                  >
                    Start second
                  </label>
                  <Input
                    id="convex-quotabunga-timestamp"
                    type="number"
                    min={0}
                    max={86400}
                    step={1}
                    value={clipStartSeconds}
                    onChange={(event) =>
                      setClipStartSeconds(event.target.value)
                    }
                    placeholder="42"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="convex-quotabunga-notes"
                  className="text-sm font-semibold"
                >
                  Notes for the hosts{" "}
                  <span className="font-normal text-gray-500">(optional)</span>
                </label>
                <Textarea
                  id="convex-quotabunga-notes"
                  maxLength={1000}
                  value={listenerNotes}
                  onChange={(event) => setListenerNotes(event.target.value)}
                  placeholder="Context, preferred stopping point, or why this quote rules..."
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                {submission ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditing(false)}
                  >
                    Cancel
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  disabled={
                    isSaving ||
                    quoteText.trim().length === 0 ||
                    sourceTitle.trim().length === 0
                  }
                >
                  {isSaving ? <Loader2 className="animate-spin" /> : null}
                  {submission ? "Save changes" : "Submit quote"}
                </Button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
