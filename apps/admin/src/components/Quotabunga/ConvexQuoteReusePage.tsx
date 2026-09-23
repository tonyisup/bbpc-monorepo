import { formatTranscriptTime } from "@bbpc/episode-search";
import { useConvex } from "convex/react";
import {
  ArrowLeft,
  ArrowUpRight,
  Loader2,
  Quote,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexQuoteReuseEpisode,
  type ConvexQuoteReuseReport,
  type ConvexQuoteStatus,
  formatQuoteReuseLikelihood,
  loadConvexAdminQuoteReuseReport,
  quoteReuseTone,
} from "@/convex/quotabunga";
import {
  getAdminEpisodePath,
  getAdminQuotabungaEpisodePath,
} from "@/lib/routes";
import { cn } from "@/lib/utils";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";

const STATUS_LABELS: Record<ConvexQuoteStatus, string> = {
  SUBMITTED: "Submitted",
  INCLUDED: "Included",
  REJECTED: "Rejected",
};

const PLACEMENT_LABELS = ["1st place", "2nd place", "3rd place"];

function loadMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "This entry has a broken episode relationship. Check it on the Quotabunga page.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The reuse breakdown could not be loaded.";
  }
}

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

function userLabel(user: { name: string | null; email: string | null }) {
  return user.name ?? user.email ?? "Unknown listener";
}

function EpisodeEvidence({ evidence }: { evidence: ConvexQuoteReuseEpisode }) {
  const { episode, submissions, transcriptPassages } = evidence;
  const title = `Episode ${String(episode.number)} · ${episode.title}`;
  const counts = [
    submissions.length > 0
      ? `${String(submissions.length)} similar ${submissions.length === 1 ? "entry" : "entries"}`
      : null,
    transcriptPassages.length > 0
      ? `${String(transcriptPassages.length)} transcript ${transcriptPassages.length === 1 ? "match" : "matches"}`
      : null,
  ].filter((count) => count !== null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            {episode.slug === null ? (
              title
            ) : (
              <Link
                className="hover:underline"
                href={getAdminEpisodePath(episode.slug)}
              >
                {title}
              </Link>
            )}
          </h2>
          <CardDescription>
            {[episode.date, ...counts].filter(Boolean).join(" · ")}
          </CardDescription>
        </div>
        <span
          className={cn(
            "shrink-0 text-2xl font-black tabular-nums",
            quoteReuseTone(evidence.likelihood)
          )}
        >
          {formatQuoteReuseLikelihood(evidence.likelihood)}
        </span>
      </CardHeader>
      <CardContent className="grid gap-5">
        {submissions.length > 0 && (
          <section className="grid gap-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
              <Quote className="h-3.5 w-3.5" />
              Quotabunga entries
            </h4>
            {submissions.map((submission) => (
              <div
                className="space-y-2 rounded-lg border bg-muted/20 p-3"
                key={submission.id}
              >
                <blockquote className="font-medium">
                  &ldquo;{submission.quoteText}&rdquo;
                </blockquote>
                <p className="text-sm text-muted-foreground">
                  {submission.sourceTitle} · {submission.sourceType} · from{" "}
                  {userLabel(submission.user)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {STATUS_LABELS[submission.status]}
                  </Badge>
                  {submission.placement !== null && (
                    <Badge>
                      {PLACEMENT_LABELS[submission.placement - 1] ??
                        `Placement ${String(submission.placement)}`}
                    </Badge>
                  )}
                  <Badge variant="outline">
                    {percent(submission.similarity)} text match
                  </Badge>
                  {!submission.sourceTitleMatches && (
                    <Badge variant="outline">Different source title</Badge>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
        {transcriptPassages.length > 0 && (
          <section className="grid gap-3">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase text-muted-foreground">
              <ScrollText className="h-3.5 w-3.5" />
              Transcript
            </h4>
            {transcriptPassages.map((passage) => (
              <div
                className="space-y-1 rounded-lg border bg-muted/20 p-3"
                key={passage.start}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">
                    {formatTranscriptTime(passage.start)}
                  </span>
                  <Badge variant="outline">
                    {percent(passage.similarity)} text match
                  </Badge>
                </div>
                <p className="break-words text-sm leading-relaxed">
                  {passage.excerpt}
                </p>
              </div>
            ))}
          </section>
        )}
      </CardContent>
    </Card>
  );
}

export function ConvexQuoteReusePage() {
  const client = useConvex();
  const router = useRouter();
  const idParam = router.query.id;
  const submissionId = Array.isArray(idParam) ? idParam[0] : idParam;
  const [report, setReport] = useState<ConvexQuoteReuseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    if (submissionId === undefined || submissionId.length === 0) {
      return;
    }
    // A slower response for a previous entry must not replace this one.
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setLoading(true);
    setError(null);
    try {
      const next = await loadConvexAdminQuoteReuseReport(client, submissionId);
      if (loadGenerationRef.current === generation) {
        setReport(next);
      }
    } catch (loadError) {
      if (loadGenerationRef.current === generation) {
        setError(loadMessage(loadError));
      }
    } finally {
      if (loadGenerationRef.current === generation) {
        setLoading(false);
      }
    }
  }, [client, submissionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && report === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <Card className="mx-auto mt-12 max-w-xl">
        <CardHeader>
          <CardTitle>Reuse breakdown unavailable</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (report === null) {
    return (
      <Card className="mx-auto mt-12 max-w-xl">
        <CardHeader>
          <CardTitle>Entry not found</CardTitle>
          <CardDescription>
            No Quotabunga entry matches this identifier. It may have been
            withdrawn or deleted.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href="/record">Back to recording</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const { submission } = report;
  const episodeNumber = String(submission.episode.number);

  return (
    <>
      <Head>
        <title>Quote reuse · BBPC Admin</title>
      </Head>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost">
            <Link href="/record">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Recording
            </Link>
          </Button>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={getAdminQuotabungaEpisodePath(submission.episode.id)}>
                Manage round <ArrowUpRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              disabled={loading}
              onClick={() => void load()}
              variant="outline"
            >
              <RefreshCw
                className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
              />
              Refresh
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Episode {episodeNumber}</Badge>
              <Badge variant="outline">
                {STATUS_LABELS[submission.status]}
              </Badge>
            </div>
            <h1 className="pt-2 text-2xl font-semibold leading-none tracking-tight">
              Quote reuse breakdown
            </h1>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
            <div className="space-y-2">
              <blockquote className="text-xl font-medium">
                &ldquo;{submission.quoteText}&rdquo;
              </blockquote>
              <p className="text-sm text-muted-foreground">
                {submission.sourceTitle} · {submission.sourceType} · from{" "}
                {userLabel(submission.user)}
              </p>
            </div>
            <div className="md:text-right">
              <p
                className={cn(
                  "text-5xl font-black tabular-nums",
                  quoteReuseTone(report.likelihood)
                )}
              >
                {formatQuoteReuseLikelihood(report.likelihood)}
              </p>
              <p className="text-sm text-muted-foreground">
                estimated chance it was used before
              </p>
            </div>
          </CardContent>
          <CardFooter className="block space-y-2 text-sm text-muted-foreground">
            <p>
              This is an estimate. It compares the quote with Quotabunga
              entries and episode transcripts from before episode{" "}
              {episodeNumber}. An included or placed entry, a matching source
              title, or a close transcript match raises it. Short, everyday
              phrases count for less in transcripts because hosts may say them
              without quoting anything. Episodes without a transcript can only
              match through entries.
            </p>
            {report.limited && (
              <p className="text-amber-700 dark:text-amber-300">
                The search reached its candidate limit, so some older matches
                may be missing.
              </p>
            )}
          </CardFooter>
        </Card>

        {report.episodes.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">No earlier use found</CardTitle>
              <CardDescription>
                No similar entry or transcript line turned up before episode{" "}
                {episodeNumber}.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          report.episodes.map((evidence) => (
            <EpisodeEvidence evidence={evidence} key={evidence.episode.id} />
          ))
        )}
      </main>
    </>
  );
}
