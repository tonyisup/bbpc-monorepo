import { useConvex } from "convex/react";
import {
  AlertTriangle,
  Edit2,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import Head from "next/head";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH,
  ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  type ConvexAdminAnnouncement,
  type ConvexAdminAnnouncementInput,
  type ConvexAnnouncementSeverity,
  type ConvexAnnouncementStatus,
  createConvexAdminAnnouncement,
  deleteConvexAdminAnnouncement,
  endConvexAdminAnnouncement,
  getAnnouncementStatus,
  loadConvexAdminAnnouncements,
  updateConvexAdminAnnouncement,
} from "@/convex/announcements";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  formatInstantLocal,
  parseDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@/lib/dates";
import { cn } from "@/lib/utils";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ConfirmModal } from "../ui/confirm-modal";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Textarea } from "../ui/textarea";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const DURATION_PRESETS = [
  { label: "1 day", ms: DAY },
  { label: "3 days", ms: 3 * DAY },
  { label: "1 week", ms: 7 * DAY },
];
const SCHEDULE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

type ConfirmTarget =
  | { kind: "end"; item: ConvexAdminAnnouncement }
  | { kind: "delete"; item: ConvexAdminAnnouncement };

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "There are too many live or scheduled announcements. End or delete one first.";
    case "NOT_FOUND":
      return "That announcement no longer exists.";
    case "VALIDATION_FAILED":
      return "Check the message, schedule and link. The end time must be in the future.";
    case "WRITE_DISABLED":
      return "Announcement changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The announcement change could not be completed.";
  }
}

function SeverityIcon({
  severity,
  className,
}: {
  severity: ConvexAnnouncementSeverity;
  className?: string;
}) {
  const Icon = severity === "warning" ? AlertTriangle : Info;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "h-4 w-4 shrink-0",
        severity === "warning" ? "text-amber-500" : "text-sky-500",
        className
      )}
    />
  );
}

function StatusBadge({ status }: { status: ConvexAnnouncementStatus }) {
  if (status === "live") {
    return <Badge className="bg-green-600 hover:bg-green-600">Live</Badge>;
  }
  if (status === "scheduled") {
    return <Badge variant="secondary">Scheduled</Badge>;
  }
  return <Badge variant="outline">Ended</Badge>;
}

// Mirrors the listener site banner so the admin sees what listeners will see.
function AnnouncementPreview({
  message,
  severity,
  linkUrl,
  linkLabel,
  dismissible,
}: {
  message: string;
  severity: ConvexAnnouncementSeverity;
  linkUrl: string | null;
  linkLabel: string | null;
  dismissible: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        severity === "warning"
          ? "border-amber-400/40 bg-amber-400/10"
          : "border-sky-400/40 bg-sky-400/10"
      )}
    >
      <SeverityIcon className="mt-0.5" severity={severity} />
      <p className="min-w-0 flex-1 break-words">
        {message.trim().length === 0 ? (
          <span className="text-muted-foreground">Your message</span>
        ) : (
          message.trim()
        )}
        {linkUrl !== null && (
          <span className="ml-2 font-semibold underline underline-offset-2">
            {linkLabel ?? "Learn more"}
          </span>
        )}
      </p>
      {dismissible && (
        <span aria-hidden="true" className="text-muted-foreground">
          ×
        </span>
      )}
    </div>
  );
}

function AnnouncementEditor({
  editing,
  isSaving,
  onClose,
  onSave,
}: {
  editing: ConvexAdminAnnouncement | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminAnnouncementInput) => void;
}) {
  const [initialStart] = useState(
    () => Math.floor(Date.now() / MINUTE) * MINUTE
  );
  const [message, setMessage] = useState(editing?.message ?? "");
  const [severity, setSeverity] = useState<ConvexAnnouncementSeverity>(
    editing?.severity ?? "info"
  );
  const [startsAt, setStartsAt] = useState(
    toDateTimeLocalValue(editing?.startsAt ?? initialStart)
  );
  const [endsAt, setEndsAt] = useState(
    toDateTimeLocalValue(editing?.endsAt ?? initialStart + DAY)
  );
  const [linkUrl, setLinkUrl] = useState(editing?.linkUrl ?? "");
  const [linkLabel, setLinkLabel] = useState(editing?.linkLabel ?? "");
  const [dismissible, setDismissible] = useState(editing?.dismissible ?? true);
  const [showErrors, setShowErrors] = useState(false);

  const trimmedMessage = message.trim();
  const start = parseDateTimeLocalValue(startsAt);
  const end = parseDateTimeLocalValue(endsAt);
  const url = nullableText(linkUrl);
  const label = nullableText(linkLabel);
  const scheduleChanged =
    editing === null || start !== editing.startsAt || end !== editing.endsAt;
  const errors = [
    trimmedMessage.length === 0 && "A message is required.",
    trimmedMessage.length > ANNOUNCEMENT_MESSAGE_MAX_LENGTH &&
      `The message must be ${ANNOUNCEMENT_MESSAGE_MAX_LENGTH} characters or fewer.`,
    (start === null || end === null) && "Choose a start and end time.",
    start !== null &&
      end !== null &&
      end <= start &&
      "The end time must be after the start time.",
    end !== null &&
      scheduleChanged &&
      end <= Date.now() &&
      "The end time must be in the future.",
    url !== null && !isHttpUrl(url) && "The link must start with http:// or https://.",
    label !== null && url === null && "A link label requires a link URL.",
    label !== null &&
      label.length > ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH &&
      `The link label must be ${ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH} characters or fewer.`,
  ].filter((error): error is string => typeof error === "string");
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const applyDuration = (ms: number) => {
    const base = start ?? Math.floor(Date.now() / MINUTE) * MINUTE;
    if (start === null) {
      setStartsAt(toDateTimeLocalValue(base));
    }
    setEndsAt(toDateTimeLocalValue(base + ms));
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {editing === null ? "New Announcement" : "Edit Announcement"}
          </DialogTitle>
          <DialogDescription>
            Shown as a banner across the listener site between the start and
            end times.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="convex-announcement-message">Message</Label>
              <span
                className={cn(
                  "text-xs text-muted-foreground",
                  trimmedMessage.length > ANNOUNCEMENT_MESSAGE_MAX_LENGTH &&
                    "text-destructive"
                )}
              >
                {trimmedMessage.length}/{ANNOUNCEMENT_MESSAGE_MAX_LENGTH}
              </span>
            </div>
            <Textarea
              id="convex-announcement-message"
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              value={message}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-announcement-severity">Severity</Label>
            <Select
              onValueChange={(value) =>
                setSeverity(value === "warning" ? "warning" : "info")
              }
              value={severity}
            >
              <SelectTrigger id="convex-announcement-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="convex-announcement-starts">Starts</Label>
              <Input
                id="convex-announcement-starts"
                onChange={(event) => setStartsAt(event.target.value)}
                type="datetime-local"
                value={startsAt}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convex-announcement-ends">Ends</Label>
              <Input
                id="convex-announcement-ends"
                onChange={(event) => setEndsAt(event.target.value)}
                type="datetime-local"
                value={endsAt}
              />
            </div>
          </div>
          <div className="-mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Times are in {timeZone}. Run for:
            </span>
            {DURATION_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                onClick={() => applyDuration(preset.ms)}
                size="sm"
                type="button"
                variant="outline"
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="convex-announcement-link-url">
                Link URL (Optional)
              </Label>
              <Input
                id="convex-announcement-link-url"
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder="https://"
                type="url"
                value={linkUrl}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convex-announcement-link-label">
                Link Label (Optional)
              </Label>
              <Input
                id="convex-announcement-link-label"
                onChange={(event) => setLinkLabel(event.target.value)}
                placeholder="Learn more"
                value={linkLabel}
              />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              checked={dismissible}
              id="convex-announcement-dismissible"
              onCheckedChange={(checked) => setDismissible(checked === true)}
            />
            <Label htmlFor="convex-announcement-dismissible">
              Listeners can dismiss this banner
            </Label>
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">Preview</span>
            <AnnouncementPreview
              dismissible={dismissible}
              linkLabel={label}
              linkUrl={url}
              message={message}
              severity={severity}
            />
          </div>
          {showErrors && errors.length > 0 && (
            <ul className="list-inside list-disc text-xs text-destructive">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button disabled={isSaving} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => {
              setShowErrors(true);
              if (errors.length === 0 && start !== null && end !== null) {
                onSave({
                  message: trimmedMessage,
                  severity,
                  startsAt: start,
                  endsAt: end,
                  linkUrl: url,
                  linkLabel: label,
                  dismissible,
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Announcement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvexAnnouncementsPage() {
  const convex = useConvex();
  const [announcements, setAnnouncements] = useState<
    ConvexAdminAnnouncement[] | null
  >(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    ConvexAdminAnnouncement | null | undefined
  >(undefined);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(
    null
  );

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void loadConvexAdminAnnouncements(convex)
      .then((result) => {
        if (active) {
          setAnnouncements(result);
          setNow(Date.now());
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
  }, [convex, revision]);

  // Keeps the Live/Scheduled/Ended badges current while the page stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = () => {
    setAnnouncements(null);
    setRevision((value) => value + 1);
  };

  const save = (input: ConvexAdminAnnouncementInput) => {
    const current = editing;
    if (current === undefined) {
      return;
    }
    setPendingAction(current?.id ?? "create-announcement");
    void (current === null
      ? createConvexAdminAnnouncement(convex, input)
      : updateConvexAdminAnnouncement(convex, current.id, input))
      .then(() => {
        toast.success(
          current === null ? "Announcement created." : "Announcement updated."
        );
        setEditing(undefined);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  const confirm = (target: ConfirmTarget) => {
    setPendingAction(target.item.id);
    const request =
      target.kind === "end"
        ? endConvexAdminAnnouncement(convex, target.item.id)
        : deleteConvexAdminAnnouncement(convex, target.item.id);
    void request
      .then(() => {
        toast.success(
          target.kind === "end"
            ? "Announcement ended."
            : "Announcement deleted."
        );
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  return (
    <>
      <Head>
        <title>Announcements - BBPC Admin</title>
      </Head>
      {editing !== undefined && (
        <AnnouncementEditor
          editing={editing}
          isSaving={pendingAction !== null}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      )}
      <ConfirmModal
        confirmText={confirmTarget?.kind === "end" ? "End now" : "Delete"}
        description={
          confirmTarget === null
            ? ""
            : confirmTarget.kind === "end"
              ? "End this announcement now? It disappears from the listener site and stays here so you can reuse it."
              : "Delete this announcement permanently?"
        }
        isOpen={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() => {
          if (confirmTarget !== null) {
            confirm(confirmTarget);
          }
        }}
        title={
          confirmTarget?.kind === "end"
            ? "End announcement"
            : "Delete announcement"
        }
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              Announcements
            </h2>
            <p className="text-muted-foreground">
              Sitewide banners for the listener site. Warnings show above
              info.
            </p>
          </div>
          <Button onClick={() => setEditing(null)}>
            <Plus className="mr-2 h-4 w-4" />
            New Announcement
          </Button>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Announcements could not be loaded. Try again.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : announcements === null ? (
          <div className="rounded-md border bg-card p-16 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-md border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {announcements.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={4}>
                      No announcements yet.
                    </TableCell>
                  </TableRow>
                )}
                {announcements.map((announcement) => {
                  const status = getAnnouncementStatus(announcement, now);
                  return (
                    <TableRow key={announcement.id}>
                      <TableCell>
                        <StatusBadge status={status} />
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="flex items-start gap-2">
                          <SeverityIcon
                            className="mt-0.5"
                            severity={announcement.severity}
                          />
                          <div className="min-w-0">
                            <p className="break-words text-sm">
                              {announcement.message}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {announcement.linkUrl !== null && (
                                <a
                                  className="mr-2 underline"
                                  href={announcement.linkUrl}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {announcement.linkLabel ?? "Learn more"}
                                </a>
                              )}
                              {announcement.dismissible
                                ? "Dismissible"
                                : "Not dismissible"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        <div>
                          {formatInstantLocal(
                            new Date(announcement.startsAt),
                            SCHEDULE_FORMAT
                          )}
                        </div>
                        <div>
                          to{" "}
                          {formatInstantLocal(
                            new Date(announcement.endsAt),
                            SCHEDULE_FORMAT
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button
                          aria-label="Edit announcement"
                          disabled={pendingAction !== null}
                          onClick={() => setEditing(announcement)}
                          size="icon"
                          title="Edit"
                          variant="ghost"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        {status !== "ended" && (
                          <Button
                            aria-label="End announcement now"
                            disabled={pendingAction !== null}
                            onClick={() =>
                              setConfirmTarget({
                                kind: "end",
                                item: announcement,
                              })
                            }
                            size="icon"
                            title="End now"
                            variant="ghost"
                          >
                            <Square className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          aria-label="Delete announcement"
                          disabled={pendingAction !== null}
                          onClick={() =>
                            setConfirmTarget({
                              kind: "delete",
                              item: announcement,
                            })
                          }
                          size="icon"
                          title="Delete"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
