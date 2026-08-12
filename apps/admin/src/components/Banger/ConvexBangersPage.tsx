import { useConvex } from "convex/react";
import {
  Edit2,
  ExternalLink,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  createConvexAdminBanger,
  deleteConvexAdminBanger,
  loadConvexAdminBangersPage,
  updateConvexAdminBanger,
  type ConvexAdminBanger,
  type ConvexAdminBangerInput,
} from "@/convex/bangers";
import {
  loadConvexAdminEpisodesPage,
  type ConvexAdminEpisode,
} from "@/convex/episodes";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  loadConvexAdminUsersPage,
  type ConvexAdminUser,
} from "@/convex/users";

import { Button } from "../ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

interface BangerFormState {
  title: string;
  artist: string;
  url: string;
  episodeId: string;
  userId: string;
}

const NONE = "none";
const emptyForm: BangerFormState = {
  title: "",
  artist: "",
  url: "",
  episodeId: NONE,
  userId: NONE,
};

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The Banger or one of its relationships changed. Refresh before retrying.";
    case "NOT_FOUND":
      return "The Banger, episode, or user is no longer available.";
    case "VALIDATION_FAILED":
      return "Use a title, artist, and HTTP or HTTPS URL.";
    case "WRITE_DISABLED":
      return "Banger changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The Banger change could not be completed.";
  }
}

function parseForm(form: BangerFormState): ConvexAdminBangerInput | null {
  const title = form.title.trim();
  const artist = form.artist.trim();
  const url = form.url.trim();
  if (
    title.length === 0 ||
    title.length > 500 ||
    artist.length === 0 ||
    artist.length > 500
  ) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }
  return {
    title,
    artist,
    url,
    episodeId: form.episodeId === NONE ? null : form.episodeId,
    userId: form.userId === NONE ? null : form.userId,
  };
}

function userLabel(user: {
  name: string | null;
  email?: string | null;
}): string {
  return user.name ?? user.email ?? "Unnamed user";
}

export function ConvexBangersPage() {
  const convex = useConvex();
  const [bangers, setBangers] = useState<ConvexAdminBanger[] | null>(
    null
  );
  const [episodes, setEpisodes] = useState<ConvexAdminEpisode[] | null>(
    null
  );
  const [users, setUsers] = useState<ConvexAdminUser[] | null>(null);
  const [episodeCatalogComplete, setEpisodeCatalogComplete] =
    useState(true);
  const [userCatalogComplete, setUserCatalogComplete] = useState(true);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [editing, setEditing] = useState<ConvexAdminBanger | null>(null);
  const [form, setForm] = useState<BangerFormState>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] =
    useState<ConvexAdminBanger | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void Promise.all([
      loadConvexAdminBangersPage(convex, null),
      loadConvexAdminEpisodesPage(convex, null),
      loadConvexAdminUsersPage(convex, null),
    ])
      .then(([bangerPage, episodePage, userPage]) => {
        if (!active) {
          return;
        }
        setBangers(bangerPage.bangers);
        setContinueCursor(bangerPage.continueCursor);
        setIsDone(bangerPage.isDone);
        setEpisodes(episodePage.episodes);
        setEpisodeCatalogComplete(episodePage.isDone);
        setUsers(userPage.users);
        setUserCatalogComplete(userPage.isDone);
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

  const refresh = () => {
    setBangers(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexAdminBangersPage(convex, continueCursor)
      .then((page) => {
        setBangers((current) => [
          ...(current ?? []),
          ...page.bangers,
        ]);
        setContinueCursor(page.continueCursor);
        setIsDone(page.isDone);
      })
      .catch(() => {
        toast.error("The next Banger page could not be loaded.");
      })
      .finally(() => setIsLoadingMore(false));
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowErrors(false);
    setDialogOpen(true);
  };

  const openEdit = (banger: ConvexAdminBanger) => {
    setEditing(banger);
    setForm({
      title: banger.title,
      artist: banger.artist,
      url: banger.url,
      episodeId: banger.episodeId ?? NONE,
      userId: banger.userId ?? NONE,
    });
    setShowErrors(false);
    setDialogOpen(true);
  };

  const episodeOptions = useMemo(() => {
    const options = [...(episodes ?? [])];
    if (
      editing?.episode !== null &&
      editing?.episode !== undefined &&
      !options.some((episode) => episode.id === editing.episode?.id)
    ) {
      options.push({
        id: editing.episode.id,
        number: editing.episode.number,
        title: editing.episode.title,
        status: editing.episode.status,
        recording: null,
        date: null,
        description: null,
        slug: null,
        assignments: [],
        extras: [],
        links: [],
      });
    }
    return options.sort((left, right) => right.number - left.number);
  }, [editing, episodes]);

  const userOptions = useMemo(() => {
    const options = [...(users ?? [])];
    if (
      editing?.user !== null &&
      editing?.user !== undefined &&
      !options.some((user) => user.id === editing.user?.id)
    ) {
      options.push({
        id: editing.user.id,
        legacyId: null,
        name: editing.user.name,
        email: editing.user.email,
        image: editing.user.image,
        status: editing.user.status,
        createdAt: 0,
        updatedAt: 0,
        isAdmin: false,
        roles: [],
        nextSyllabus: null,
      });
    }
    return options.sort((left, right) =>
      userLabel(left).localeCompare(userLabel(right))
    );
  }, [editing, users]);

  const save = () => {
    setShowErrors(true);
    const input = parseForm(form);
    if (input === null || isSaving) {
      return;
    }
    setIsSaving(true);
    const request =
      editing === null
        ? createConvexAdminBanger(convex, input)
        : updateConvexAdminBanger(convex, editing.id, input);
    void request
      .then(() => {
        toast.success(
          editing === null ? "Banger created." : "Banger updated."
        );
        setDialogOpen(false);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setIsSaving(false));
  };

  const remove = () => {
    if (pendingDelete === null || isDeleting) {
      return;
    }
    const target = pendingDelete;
    setPendingDelete(null);
    setIsDeleting(true);
    void deleteConvexAdminBanger(convex, target)
      .then(() => {
        toast.success("Banger deleted.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setIsDeleting(false));
  };

  return (
    <>
      <Head>
        <title>Bangers - BBPC Admin</title>
      </Head>

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Bangers</h2>
            <p className="text-muted-foreground">
              Manage the native paginated podcast song collection.
            </p>
          </div>
          <Button
            disabled={episodes === null || users === null}
            onClick={openCreate}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Banger
          </Button>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Bangers could not be loaded. No legacy SQL fallback was
              attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : (
          <div className="rounded-md border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Artist</TableHead>
                  <TableHead>Episode</TableHead>
                  <TableHead>Added By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bangers === null && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {bangers?.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      No Bangers found.
                    </TableCell>
                  </TableRow>
                )}
                {bangers?.map((banger) => (
                  <TableRow className="group" key={banger.id}>
                    <TableCell className="font-medium">
                      <a
                        className="inline-flex items-center gap-2 hover:underline"
                        href={banger.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <Music className="h-4 w-4 text-pink-500" />
                        {banger.title}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </TableCell>
                    <TableCell>{banger.artist}</TableCell>
                    <TableCell>
                      {banger.episode === null ? (
                        "—"
                      ) : (
                        <span className="rounded bg-muted px-2 py-1 text-xs">
                          Ep {banger.episode.number}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {banger.user === null
                        ? "—"
                        : userLabel(banger.user)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          aria-label={`Edit ${banger.title}`}
                          disabled={isDeleting}
                          onClick={() => openEdit(banger)}
                          size="icon"
                          variant="ghost"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          aria-label={`Delete ${banger.title}`}
                          className="text-destructive hover:text-destructive"
                          disabled={isDeleting}
                          onClick={() => setPendingDelete(banger)}
                          size="icon"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!isDone && (
              <div className="border-t p-4 text-center">
                <Button
                  disabled={isLoadingMore}
                  onClick={loadMore}
                  variant="outline"
                >
                  {isLoadingMore && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editing === null ? "Add Banger" : "Edit Banger"}
            </DialogTitle>
            <DialogDescription>
              Episode and user links are optional and validated against
              canonical Convex records.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="banger-title">Song Title</Label>
              <Input
                id="banger-title"
                maxLength={500}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                value={form.title}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="banger-artist">Artist</Label>
              <Input
                id="banger-artist"
                maxLength={500}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    artist: event.target.value,
                  }))
                }
                value={form.artist}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="banger-url">Spotify/URL</Label>
              <Input
                id="banger-url"
                maxLength={2048}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    url: event.target.value,
                  }))
                }
                type="url"
                value={form.url}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="banger-episode">Episode (Optional)</Label>
              <select
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="banger-episode"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    episodeId: event.target.value,
                  }))
                }
                value={form.episodeId}
              >
                <option value={NONE}>None</option>
                {episodeOptions.map((episode) => (
                  <option key={episode.id} value={episode.id}>
                    Ep {episode.number}: {episode.title}
                  </option>
                ))}
              </select>
              {!episodeCatalogComplete && (
                <p className="text-xs text-amber-600">
                  Episode selector shows the latest 20 plus the current
                  linked episode.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="banger-user">User (Optional)</Label>
              <select
                className="flex h-10 w-full rounded-md border bg-background px-3 text-sm"
                id="banger-user"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
                value={form.userId}
              >
                <option value={NONE}>None</option>
                {userOptions.map((user) => (
                  <option key={user.id} value={user.id}>
                    {userLabel(user)}
                  </option>
                ))}
              </select>
              {!userCatalogComplete && (
                <p className="text-xs text-amber-600">
                  User selector shows the first 50 plus the current linked
                  user.
                </p>
              )}
            </div>
            {showErrors && parseForm(form) === null && (
              <p className="text-xs text-destructive">
                A title, artist, and valid HTTP or HTTPS URL are required.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={isSaving}
              onClick={() => setDialogOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isSaving} onClick={save}>
              {isSaving && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save Banger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        confirmText="Delete Banger"
        description={
          pendingDelete === null
            ? ""
            : `Permanently delete “${pendingDelete.title}” by ${pendingDelete.artist}? The exact title, artist, URL, episode, and user you inspected must still match.`
        }
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={remove}
        title="Delete Banger?"
      />
    </>
  );
}
