import { useConvex } from "convex/react";
import Link from "next/link";
import { useRef, useState } from "react";

import type { ConvexAdminEpisodeDetail } from "@/convex/episodeDetails";
import {
  episodeMergeError,
  mergeDuplicateEpisode,
  previewEpisodeMerge,
  type EpisodeMergePreview,
  type EpisodeMergeResult,
} from "@/convex/episodeMerge";
import { formatPlainDate } from "@/lib/dates";
import { Button } from "../ui/button";
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

const relationshipLabels = {
  archivePosts: "Archive posts",
  assignments: "Assignments",
  extraReviews: "Extra reviews",
  episodeLinks: "Episode links",
} as const;

export function EpisodeMergeDialog({
  episode,
  onClose,
  onMerged,
}: {
  episode: ConvexAdminEpisodeDetail;
  onClose: () => void;
  onMerged: (result: EpisodeMergeResult) => void;
}) {
  const convex = useConvex();
  const [otherId, setOtherId] = useState("");
  const [keepCurrent, setKeepCurrent] = useState(true);
  const [preview, setPreview] = useState<EpisodeMergePreview | null>(null);
  const [backupReceipt, setBackupReceipt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "previewing" | "merging" | "done"
  >("idle");
  const [result, setResult] = useState<EpisodeMergeResult | null>(null);
  const inFlight = useRef(false);
  const busy = phase === "previewing" || phase === "merging";
  const validPair = otherId.trim().length > 0 && otherId.trim() !== episode.id;

  function resetPreview() {
    setPreview(null);
    setBackupReceipt("");
    setConfirmed(false);
    setError(null);
  }

  async function loadPreview() {
    if (inFlight.current || !validPair) return;
    inFlight.current = true;
    resetPreview();
    setPhase("previewing");
    try {
      setPreview(
        await previewEpisodeMerge(
          convex,
          keepCurrent ? episode.id : otherId.trim(),
          keepCurrent ? otherId.trim() : episode.id
        )
      );
    } catch (cause) {
      setError(episodeMergeError(cause));
    } finally {
      inFlight.current = false;
      setPhase("idle");
    }
  }

  async function merge() {
    if (
      inFlight.current ||
      !preview ||
      !confirmed ||
      !backupReceipt.trim() ||
      backupReceipt.length > 512
    )
      return;
    inFlight.current = true;
    setPhase("merging");
    setError(null);
    try {
      const merged = await mergeDuplicateEpisode(
        convex,
        preview,
        backupReceipt
      );
      setResult(merged);
      setPhase("done");
    } catch (cause) {
      resetPreview();
      setError(
        `${episodeMergeError(
          cause
        )} Inspect the retained episode before trying again; if the response was lost, the merge may have completed. Load and review a new preview before another merge.`
      );
      setPhase("idle");
    } finally {
      inFlight.current = false;
    }
  }

  function downloadPreview() {
    if (!preview) return;
    try {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              fingerprint: preview.fingerprint,
              snapshotJson: preview.snapshotJson,
            },
            null,
            2
          ),
        ],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `episode-${episode.number}-merge-preview.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(
        "Could not download the preview. Try downloading again before merging."
      );
    }
  }

  function close() {
    if (inFlight.current) return;
    if (result) onMerged(result);
    else onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Merge duplicate episode</DialogTitle>
          <DialogDescription>
            Keep the episode with the transcript. Move supported relationships
            and fill empty fields from the duplicate, then permanently delete
            it.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4" role="status">
            <p>
              Duplicate merged successfully. The retained episode now uses{" "}
              <strong className="break-all">{result.slug}</strong>.
            </p>
            <Button onClick={() => onMerged(result)}>
              View retained episode
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-md border p-4 text-sm">
              <p className="font-semibold">
                Current episode: #{episode.number} · {episode.title}
              </p>
              <p className="break-all font-mono text-xs">{episode.id}</p>
              <p>{episode.date ? formatPlainDate(episode.date) : "No date"}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="merge-other-id">Other episode ID</Label>
              <Input
                id="merge-other-id"
                value={otherId}
                disabled={busy}
                onChange={(event) => {
                  setOtherId(event.target.value);
                  resetPreview();
                }}
              />
              <p className="text-sm text-muted-foreground">
                Copy the ID from the{" "}
                <Link
                  className="underline"
                  href="/episode"
                  target="_blank"
                  rel="noreferrer"
                >
                  episode list (opens a new tab)
                </Link>
                . Both episodes must have the same number and matching titles.
              </p>
              {otherId.trim() === episode.id && (
                <p role="alert" className="text-sm text-destructive">
                  Choose a different episode ID.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="merge-keeper">Episode to keep</Label>
              <select
                id="merge-keeper"
                className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm"
                disabled={busy}
                value={keepCurrent ? "current" : "other"}
                onChange={(event) => {
                  setKeepCurrent(event.target.value === "current");
                  resetPreview();
                }}
              >
                <option value="current">
                  Keep current episode; delete the other episode
                </option>
                <option value="other">
                  Keep the other episode; delete current episode
                </option>
              </select>
              <p className="text-sm text-muted-foreground">
                The retained episode must have the only transcript. Preview
                checks eligibility.
              </p>
            </div>
            <Button
              className="justify-self-start"
              variant="outline"
              disabled={busy || !validPair}
              onClick={() => void loadPreview()}
            >
              {phase === "previewing"
                ? "Loading preview…"
                : preview
                ? "Refresh preview"
                : "Preview merge"}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {preview && (
              <section
                aria-label="Merge preview"
                className="min-w-0 space-y-4 border-t pt-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {(["keeper", "donor"] as const).map((role) => {
                    const row = preview.snapshot[role];
                    return (
                      <div
                        key={role}
                        className="min-w-0 rounded-md border p-3 text-sm"
                      >
                        <h3 className="font-semibold">
                          {role === "keeper"
                            ? "Keep · transcript preserved"
                            : "Delete permanently"}
                        </h3>
                        <p>
                          #{row.number} · {row.title}
                        </p>
                        <p>{formatPlainDate(row.date)}</p>
                        <p className="break-all font-mono text-xs">{row._id}</p>
                        <p className="break-all text-muted-foreground">
                          Current slug: {row.slug ?? "None"}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <p className="text-sm">
                  Retain {preview.snapshot.transcript.passageCount} transcript
                  passages and the keeper’s date. New slug:{" "}
                  <strong className="break-all">{preview.slug}</strong>.
                </p>
                <div className="text-sm">
                  <h3 className="font-semibold">
                    Fields copied into empty values
                  </h3>
                  {Object.keys(preview.snapshot.patch).length === 0 ? (
                    <p>None.</p>
                  ) : (
                    <dl className="space-y-2">
                      {Object.entries(preview.snapshot.patch).map(
                        ([field, value]) => (
                          <div key={field}>
                            <dt className="font-medium">{field}</dt>
                            <dd className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground">
                              {value}
                            </dd>
                          </div>
                        )
                      )}
                    </dl>
                  )}
                </div>
                <table className="w-full text-left text-sm">
                  <caption className="text-left font-semibold">
                    Relationships
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Kept</th>
                      <th scope="col">Moved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      Object.keys(relationshipLabels) as Array<
                        keyof typeof relationshipLabels
                      >
                    ).map((key) => (
                      <tr key={key}>
                        <th scope="row" className="font-normal">
                          {relationshipLabels[key]}
                        </th>
                        <td>{preview.snapshot.keeperRelations[key].length}</td>
                        <td>{preview.snapshot.donorRelations[key].length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <p>
                    No redirects or aliases will be created. Old suffixed URLs
                    and the deleted episode’s IDs may stop resolving. This
                    cannot be undone from the admin.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={downloadPreview}
                  >
                    Download private preview
                  </Button>
                  <p className="text-muted-foreground">
                    The download includes the full inspection snapshot and
                    fingerprint. Store it privately. It is not a full database
                    backup or an automatic undo.
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="merge-backup">
                    Verified private database backup receipt
                  </Label>
                  <Input
                    id="merge-backup"
                    maxLength={512}
                    value={backupReceipt}
                    disabled={busy}
                    onChange={(event) => setBackupReceipt(event.target.value)}
                    aria-describedby="merge-backup-help"
                  />
                  <p
                    id="merge-backup-help"
                    className="text-sm text-muted-foreground"
                  >
                    Enter the reference for the full backup you have taken and
                    verified.
                  </p>
                </div>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    I saved and reviewed this preview, verified the backup, and
                    approve deleting the duplicate and rebuilding the slug
                    without redirects.
                  </span>
                </label>
              </section>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={
                  busy ||
                  !preview ||
                  !confirmed ||
                  !backupReceipt.trim() ||
                  backupReceipt.length > 512
                }
                onClick={() => void merge()}
              >
                {phase === "merging"
                  ? "Merging…"
                  : "Merge and delete duplicate"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
