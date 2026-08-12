import { useConvex } from "convex/react";
import {
  Calendar,
  ChevronLeft,
  Clipboard,
  ExternalLink,
  FileText,
  Film,
  Link2,
  Loader2,
  Mic2,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAdminEpisodeAudioMessage,
  type ConvexAdminEpisodeDetail,
  type ConvexAdminEpisodeInput,
  type ConvexAdminEpisodeLink,
  addConvexAdminEpisodeAudio,
  addConvexAdminEpisodeLink,
  loadConvexAdminEpisodeAudioPage,
  loadConvexAdminEpisodeByNumber,
  loadConvexAdminEpisodeBySlug,
  removeConvexAdminEpisodeAudio,
  removeConvexAdminEpisodeLink,
  updateConvexAdminEpisode,
} from "@/convex/episodeDetails";
import { getConvexDomainErrorCode } from "@/convex/identity";
import { formatInstantLocal, formatPlainDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
import { EpisodeRelationships } from "./EpisodeRelationships";

function mutationMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The episode changed, a relationship reached its safety limit, or external file cleanup is required. Refresh before retrying.";
    case "VALIDATION_FAILED":
      return "Check the episode fields, URL, date, slug, and text limits.";
    case "WRITE_DISABLED":
      return "Episode changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The episode operation could not be completed.";
  }
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function initials(name: string | null): string {
  return (
    name
      ?.trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? "U"
  );
}

function statusClass(status: string | null): string {
  switch (status) {
    case "published":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700";
    case "recording":
      return "border-amber-500/20 bg-amber-500/10 text-amber-700";
    case "next":
      return "border-blue-500/20 bg-blue-500/10 text-blue-700";
    default:
      return "border-muted bg-muted/50 text-muted-foreground";
  }
}

function EpisodeEditor({
  episode,
  isSaving,
  onSave,
}: {
  episode: ConvexAdminEpisodeDetail;
  isSaving: boolean;
  onSave: (input: ConvexAdminEpisodeInput) => void;
}) {
  const [number, setNumber] = useState(String(episode.number));
  const [title, setTitle] = useState(episode.title);
  const [description, setDescription] = useState(episode.description ?? "");
  const [date, setDate] = useState(episode.date ?? "");
  const [recording, setRecording] = useState(episode.recording ?? "");
  const [status, setStatus] = useState(episode.status ?? "pending");
  const [seoTitle, setSeoTitle] = useState(episode.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(
    episode.seoDescription ?? ""
  );
  const [seoKeywords, setSeoKeywords] = useState(episode.seoKeywords ?? "");
  const [slug, setSlug] = useState(episode.slug ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const parsedNumber = Number(number);
  const isValid =
    title.trim().length > 0 &&
    Number.isSafeInteger(parsedNumber) &&
    parsedNumber >= -32_768 &&
    parsedNumber <= 32_767 &&
    (date.length === 0 || /^\d{4}-\d{2}-\d{2}$/u.test(date));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Episode details</CardTitle>
        <CardDescription>
          Saving uses an exact loaded snapshot so concurrent changes are never
          overwritten silently.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="convex-episode-number">Number</Label>
          <Input
            id="convex-episode-number"
            max={32_767}
            min={-32_768}
            onChange={(event) => setNumber(event.target.value)}
            type="number"
            value={number}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="convex-episode-title">Title</Label>
          <Input
            id="convex-episode-title"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="convex-episode-description">Description</Label>
          <Textarea
            id="convex-episode-description"
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="convex-episode-date">Date</Label>
          <Input
            id="convex-episode-date"
            onChange={(event) => setDate(event.target.value)}
            type="date"
            value={date}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="convex-episode-status">Status</Label>
          <Select onValueChange={setStatus} value={status}>
            <SelectTrigger id="convex-episode-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="next">Next</SelectItem>
              <SelectItem value="recording">Recording</SelectItem>
              <SelectItem value="published">Published</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="convex-episode-recording">Recording URL</Label>
          <Input
            id="convex-episode-recording"
            onChange={(event) => setRecording(event.target.value)}
            value={recording}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="convex-episode-slug">Slug</Label>
          <Input
            id="convex-episode-slug"
            onChange={(event) => setSlug(event.target.value)}
            value={slug}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="convex-episode-seo-title">SEO title</Label>
          <Input
            id="convex-episode-seo-title"
            onChange={(event) => setSeoTitle(event.target.value)}
            value={seoTitle}
          />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="convex-episode-seo-description">
            SEO description
          </Label>
          <Textarea
            id="convex-episode-seo-description"
            onChange={(event) => setSeoDescription(event.target.value)}
            value={seoDescription}
          />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="convex-episode-seo-keywords">SEO keywords</Label>
          <Input
            id="convex-episode-seo-keywords"
            onChange={(event) => setSeoKeywords(event.target.value)}
            value={seoKeywords}
          />
        </div>
        {showErrors && !isValid && (
          <p className="text-sm text-destructive md:col-span-2">
            A title, valid episode number, and valid optional date are required.
          </p>
        )}
      </CardContent>
      <CardFooter>
        <Button
          className="gap-2"
          disabled={isSaving}
          onClick={() => {
            setShowErrors(true);
            if (isValid) {
              onSave({
                number: parsedNumber,
                title: title.trim(),
                recording: nullableText(recording),
                date: date.length === 0 ? null : date,
                description: nullableText(description),
                status,
                notes: episode.notes,
                seoDescription: nullableText(seoDescription),
                seoKeywords: nullableText(seoKeywords),
                seoTitle: nullableText(seoTitle),
                slug: nullableText(slug),
              });
            }
          }}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save details
        </Button>
      </CardFooter>
    </Card>
  );
}

function AddLinkDialog({
  isSaving,
  onClose,
  onSave,
}: {
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: { url: string; text: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add episode link</DialogTitle>
          <DialogDescription>URLs must use HTTP or HTTPS.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-link-text">Label</Label>
            <Input
              id="convex-link-text"
              onChange={(event) => setText(event.target.value)}
              value={text}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-link-url">URL</Label>
            <Input
              id="convex-link-url"
              onChange={(event) => setUrl(event.target.value)}
              type="url"
              value={url}
            />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={isSaving} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              isSaving || text.trim().length === 0 || url.trim().length === 0
            }
            onClick={() => onSave({ text: text.trim(), url: url.trim() })}
          >
            Add link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvexEpisodeDetailPage() {
  const router = useRouter();
  const convex = useConvex();
  const slug = typeof router.query.slug === "string" ? router.query.slug : null;
  const [episode, setEpisode] = useState<
    ConvexAdminEpisodeDetail | null | undefined
  >(undefined);
  const [nextEpisode, setNextEpisode] =
    useState<ConvexAdminEpisodeDetail | null>(null);
  const [audioMessages, setAudioMessages] = useState<
    ConvexAdminEpisodeAudioMessage[] | null
  >(null);
  const [audioCursor, setAudioCursor] = useState<string | null>(null);
  const [audioDone, setAudioDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingMoreAudio, setIsLoadingMoreAudio] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioNotes, setAudioNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("general");

  useEffect(() => {
    if (slug === null) {
      return;
    }
    let active = true;
    setEpisode(undefined);
    setNextEpisode(null);
    setAudioMessages(null);
    setLoadFailed(false);
    void loadConvexAdminEpisodeBySlug(convex, slug)
      .then(async (loadedEpisode) => {
        if (loadedEpisode === null) {
          if (active) {
            setEpisode(null);
          }
          return;
        }
        const [audioPage, followingEpisode] = await Promise.all([
          loadConvexAdminEpisodeAudioPage(convex, loadedEpisode.id, null),
          loadConvexAdminEpisodeByNumber(convex, loadedEpisode.number + 1),
        ]);
        if (active) {
          setEpisode(loadedEpisode);
          setNotes(loadedEpisode.notes ?? "");
          setAudioMessages(audioPage.messages);
          setAudioCursor(audioPage.isDone ? null : audioPage.continueCursor);
          setAudioDone(audioPage.isDone);
          setNextEpisode(followingEpisode);
        }
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [convex, revision, slug]);

  const plainText = useMemo(() => {
    if (episode === null || episode === undefined) {
      return "";
    }
    const assignmentLines = episode.assignments.map(
      (assignment) =>
        `${assignment.type}: [${assignment.user.name ?? "Unnamed"}] ${
          assignment.movie.title
        } (${assignment.movie.year})`
    );
    const extraLines = episode.extras.map((extra) => {
      const target = extra.review.movie ?? extra.review.show;
      return `Extra: ${target?.title ?? "Missing media"}${
        target === null ? "" : ` (${target.year})`
      }`;
    });
    const nextLines =
      nextEpisode === null
        ? []
        : [
            "",
            `${nextEpisode.title}:`,
            ...nextEpisode.assignments
              .slice()
              .sort((left, right) =>
                left.type === right.type ? 0 : left.type === "HOMEWORK" ? -1 : 1
              )
              .map(
                (assignment) =>
                  `${assignment.type}: [${assignment.user.name ?? "Unnamed"}] ${
                    assignment.movie.title
                  } (${assignment.movie.year})`
              ),
          ];
    return [...assignmentLines, "", ...extraLines, ...nextLines].join("\n");
  }, [episode, nextEpisode]);

  const refresh = () => setRevision((value) => value + 1);

  const saveEpisode = (input: ConvexAdminEpisodeInput) => {
    if (episode === null || episode === undefined) {
      return;
    }
    setIsSaving(true);
    void updateConvexAdminEpisode(convex, episode, input)
      .then((updated) => {
        setEpisode(updated);
        setNotes(updated.notes ?? "");
        toast.success("Episode updated.");
      })
      .catch((error: unknown) => toast.error(mutationMessage(error)))
      .finally(() => setIsSaving(false));
  };

  if (loadFailed) {
    return (
      <div className="mx-auto flex min-h-[420px] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">Episode unavailable</h1>
        <p className="text-sm text-muted-foreground">
          Convex could not load this workbench. No SQL fallback was attempted.
        </p>
        <Button className="gap-2" onClick={refresh} variant="outline">
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (episode === undefined) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (episode === null) {
    return (
      <div className="mx-auto flex min-h-[420px] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-bold">Episode not found</h1>
        <Button asChild variant="outline">
          <Link href="/episode">
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back to episodes
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>
          Episode {episode.number} - {episode.title} | Admin
        </title>
      </Head>
      {linkDialogOpen && (
        <AddLinkDialog
          isSaving={isSaving}
          onClose={() => setLinkDialogOpen(false)}
          onSave={(input) => {
            setIsSaving(true);
            void addConvexAdminEpisodeLink(convex, episode.id, input)
              .then(() => {
                toast.success("Episode link added.");
                setLinkDialogOpen(false);
                refresh();
              })
              .catch((error: unknown) => toast.error(mutationMessage(error)))
              .finally(() => setIsSaving(false));
          }}
        />
      )}

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8">
        <div className="flex items-center justify-between">
          <Button asChild className="gap-2" variant="ghost">
            <Link href="/episode">
              <ChevronLeft className="h-4 w-4" />
              Back to episodes
            </Link>
          </Button>
          <Button className="gap-2" onClick={refresh} variant="outline">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <section className="relative overflow-hidden rounded-2xl border bg-card p-8 shadow-sm">
          <Mic2 className="pointer-events-none absolute right-10 top-4 h-40 w-40 opacity-[0.03]" />
          <div className="relative z-10">
            <div className="flex items-center gap-2">
              <Badge variant="outline">Ep. {episode.number}</Badge>
              <Badge className={statusClass(episode.status)}>
                {episode.status ?? "unset"}
              </Badge>
            </div>
            <h1 className="mt-4 text-4xl font-black tracking-tight">
              {episode.title}
            </h1>
            <div className="mt-3 flex flex-wrap gap-5 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {episode.date === null
                  ? "No date set"
                  : formatPlainDate(episode.date, {
                      dateStyle: "long",
                    })}
              </span>
              {episode.recording !== null && (
                <a
                  className="flex items-center gap-2 hover:text-primary"
                  href={episode.recording}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="h-4 w-4" />
                  Recording
                </a>
              )}
            </div>
          </div>
        </section>

        <Tabs onValueChange={setActiveTab} value={activeTab}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 md:grid-cols-4">
            <TabsTrigger className="gap-2" value="general">
              <Settings2 className="h-4 w-4" />
              Details
            </TabsTrigger>
            <TabsTrigger className="gap-2" value="relationships">
              <Film className="h-4 w-4" />
              Assignments
            </TabsTrigger>
            <TabsTrigger className="gap-2" value="media">
              <Link2 className="h-4 w-4" />
              Links & audio
            </TabsTrigger>
            <TabsTrigger className="gap-2" value="notes">
              <FileText className="h-4 w-4" />
              Show notes
            </TabsTrigger>
          </TabsList>

          <TabsContent className="pt-6" value="general">
            <EpisodeEditor
              episode={episode}
              isSaving={isSaving}
              key={`${episode.id}:${episode.slug ?? ""}:${episode.title}`}
              onSave={saveEpisode}
            />
          </TabsContent>

          <TabsContent className="pt-6" value="relationships">
            <EpisodeRelationships episode={episode} onRefresh={refresh} />
          </TabsContent>

          <TabsContent className="space-y-8 pt-6" value="media">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Links ({episode.links.length})</CardTitle>
                  <CardDescription>
                    Versioned link deletion rejects stale rows.
                  </CardDescription>
                </div>
                <Button
                  className="gap-2"
                  onClick={() => setLinkDialogOpen(true)}
                  size="sm"
                >
                  <Plus className="h-4 w-4" />
                  Add link
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {episode.links.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No links.</p>
                ) : (
                  episode.links.map((link: ConvexAdminEpisodeLink) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-xl border p-4"
                      key={link.id}
                    >
                      <a
                        className="min-w-0 hover:text-primary"
                        href={link.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span className="block truncate font-bold">
                          {link.text}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {link.url}
                        </span>
                      </a>
                      <Button
                        aria-label={`Delete ${link.text}`}
                        onClick={() => {
                          if (!confirm(`Delete “${link.text}”?`)) {
                            return;
                          }
                          setIsSaving(true);
                          void removeConvexAdminEpisodeLink(
                            convex,
                            episode.id,
                            link
                          )
                            .then(() => {
                              toast.success("Episode link deleted.");
                              refresh();
                            })
                            .catch((error: unknown) =>
                              toast.error(mutationMessage(error))
                            )
                            .finally(() => setIsSaving(false));
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Audio messages</CardTitle>
                <CardDescription>
                  The legacy upload endpoint remains disabled because it does
                  not authenticate users. Add an HTTPS audio URL instead.
                  Externally keyed files are read-only until provider cleanup is
                  integrated.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 rounded-xl border border-dashed p-4">
                  <div className="grid gap-2">
                    <Label htmlFor="convex-audio-url">Audio URL</Label>
                    <Input
                      id="convex-audio-url"
                      onChange={(event) => setAudioUrl(event.target.value)}
                      placeholder="https://..."
                      type="url"
                      value={audioUrl}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="convex-audio-notes">Notes (optional)</Label>
                    <Textarea
                      id="convex-audio-notes"
                      onChange={(event) => setAudioNotes(event.target.value)}
                      value={audioNotes}
                    />
                  </div>
                  <Button
                    className="w-fit gap-2"
                    disabled={isSaving || audioUrl.trim().length === 0}
                    onClick={() => {
                      setIsSaving(true);
                      void addConvexAdminEpisodeAudio(convex, episode.id, {
                        url: audioUrl.trim(),
                        notes: nullableText(audioNotes),
                      })
                        .then(() => {
                          toast.success("Audio metadata added.");
                          setAudioUrl("");
                          setAudioNotes("");
                          refresh();
                        })
                        .catch((error: unknown) =>
                          toast.error(mutationMessage(error))
                        )
                        .finally(() => setIsSaving(false));
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Add audio URL
                  </Button>
                </div>

                {audioMessages === null ? (
                  <Loader2 className="mx-auto h-7 w-7 animate-spin text-muted-foreground" />
                ) : audioMessages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No audio messages.
                  </p>
                ) : (
                  audioMessages.map((message) => (
                    <div className="rounded-xl border p-4" key={message.id}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={message.user.image ?? ""} />
                            <AvatarFallback>
                              {initials(message.user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold">
                              {message.user.name ??
                                message.user.email ??
                                "Unnamed user"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatInstantLocal(new Date(message.createdAt), {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </p>
                          </div>
                        </div>
                        <Button
                          aria-label="Delete audio metadata"
                          disabled={message.fileKey !== null || isSaving}
                          onClick={() => {
                            if (!confirm("Delete this audio metadata?")) {
                              return;
                            }
                            setIsSaving(true);
                            void removeConvexAdminEpisodeAudio(convex, message)
                              .then(() => {
                                toast.success("Audio metadata deleted.");
                                refresh();
                              })
                              .catch((error: unknown) =>
                                toast.error(mutationMessage(error))
                              )
                              .finally(() => setIsSaving(false));
                          }}
                          title={
                            message.fileKey === null
                              ? "Delete audio metadata"
                              : "External provider cleanup is required first."
                          }
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <audio className="mt-4 w-full" controls src={message.url}>
                        <track kind="captions" />
                      </audio>
                      {message.notes !== null && (
                        <p className="mt-3 border-l-2 pl-3 text-sm text-muted-foreground">
                          {message.notes}
                        </p>
                      )}
                    </div>
                  ))
                )}
                {!audioDone && audioCursor !== null && (
                  <Button
                    disabled={isLoadingMoreAudio}
                    onClick={() => {
                      setIsLoadingMoreAudio(true);
                      void loadConvexAdminEpisodeAudioPage(
                        convex,
                        episode.id,
                        audioCursor
                      )
                        .then((page) => {
                          setAudioMessages((current) => [
                            ...(current ?? []),
                            ...page.messages,
                          ]);
                          setAudioDone(page.isDone);
                          setAudioCursor(
                            page.isDone ? null : page.continueCursor
                          );
                        })
                        .catch(() =>
                          toast.error(
                            "The next audio page could not be loaded."
                          )
                        )
                        .finally(() => setIsLoadingMoreAudio(false));
                    }}
                    variant="outline"
                  >
                    {isLoadingMoreAudio ? "Loading..." : "Load more audio"}
                  </Button>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="pt-6" value="notes">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Plain-text show notes</CardTitle>
                  <CardDescription>
                    Current assignments, extras, and the next episode preview.
                  </CardDescription>
                </div>
                <Button
                  className="gap-2"
                  onClick={() => {
                    void navigator.clipboard.writeText(plainText).then(() => {
                      setCopied(true);
                      toast.success("Show notes copied.");
                    });
                  }}
                  variant="outline"
                >
                  <Clipboard className="h-4 w-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                <pre className="whitespace-pre-wrap rounded-xl bg-muted p-4 text-sm">
                  {plainText}
                </pre>
                <div className="grid gap-2">
                  <Label htmlFor="convex-episode-notes">
                    Internal admin notes
                  </Label>
                  <Textarea
                    className="min-h-[160px]"
                    id="convex-episode-notes"
                    onChange={(event) => setNotes(event.target.value)}
                    value={notes}
                  />
                </div>
                <Button
                  className="gap-2"
                  disabled={isSaving || notes === (episode.notes ?? "")}
                  onClick={() =>
                    saveEpisode({
                      number: episode.number,
                      title: episode.title,
                      recording: episode.recording,
                      date: episode.date,
                      description: episode.description,
                      status: episode.status ?? "pending",
                      notes: nullableText(notes),
                      seoDescription: episode.seoDescription,
                      seoKeywords: episode.seoKeywords,
                      seoTitle: episode.seoTitle,
                      slug: episode.slug,
                    })
                  }
                >
                  <Save className="h-4 w-4" />
                  Save internal notes
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div
          className={cn(
            "rounded-xl border border-dashed p-4 text-sm text-muted-foreground",
            "bg-muted/20"
          )}
        >
          Relationship lists are capped at 50 by the backend. Audio metadata is
          paginated in 30-row pages. No Convex failure falls back to SQL.
        </div>
      </main>
    </>
  );
}
