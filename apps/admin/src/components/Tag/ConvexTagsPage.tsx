import { useConvex } from "convex/react";
import {
  Check,
  Coins,
  Edit2,
  Loader2,
  Plus,
  RefreshCw,
  Tag as TagIcon,
  Trash2,
  User as UserIcon,
  Vote,
} from "lucide-react";
import Head from "next/head";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexAdminTag,
  type ConvexAdminTagInput,
  type ConvexAdminTagVote,
  applyConvexAdminTagVotePoints,
  createConvexAdminTag,
  deleteConvexAdminTag,
  deleteConvexAdminTagVote,
  loadConvexAdminTagVotesPage,
  loadConvexAdminTags,
  updateConvexAdminTag,
} from "@/convex/tags";
import {
  formatInstantLocal,
  getPacificTodayPlainDate,
} from "@/lib/dates";

import { Badge } from "../ui/badge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";

type DeleteTarget =
  | { kind: "tag"; item: ConvexAdminTag }
  | { kind: "vote"; item: ConvexAdminTagVote };

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The name is in use, the catalog is full, or this vote already has award evidence.";
    case "NOT_FOUND":
      return "That tag or vote no longer exists.";
    case "VALIDATION_FAILED":
      return "Check the tag name and current scoring configuration.";
    case "WRITE_DISABLED":
      return "Tag changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The tag change could not be completed.";
  }
}

function TagEditor({
  editingTag,
  isSaving,
  onClose,
  onSave,
}: {
  editingTag: ConvexAdminTag | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminTagInput) => void;
}) {
  const [name, setName] = useState(editingTag?.name ?? "");
  const [description, setDescription] = useState(
    editingTag?.description ?? ""
  );
  const [showErrors, setShowErrors] = useState(false);
  const isValid = name.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {editingTag === null ? "Add New Tag" : "Edit Tag"}
          </DialogTitle>
          <DialogDescription>
            Catalog names are unique after normalization.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-tag-name">Tag Name</Label>
            <Input
              aria-invalid={showErrors && !isValid}
              id="convex-tag-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-tag-description">
              Description (Optional)
            </Label>
            <Textarea
              id="convex-tag-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>
          {showErrors && !isValid && (
            <p className="text-xs text-destructive">
              A tag name is required.
            </p>
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
              if (isValid) {
                onSave({
                  name: name.trim(),
                  description: nullableText(description),
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Tag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoteTypeBadge({ value }: { value: boolean | null }) {
  if (value === null) {
    return <Badge variant="outline">Unclassified</Badge>;
  }
  return (
    <Badge variant={value ? "default" : "secondary"}>
      {value ? "Is Tag" : "Not Tag"}
    </Badge>
  );
}

function AwardEvidence({ vote }: { vote: ConvexAdminTagVote }) {
  if (vote.award.kind === "point") {
    return (
      <span
        className="flex h-9 items-center gap-1 text-xs text-green-600"
        title="Points applied"
      >
        <Check className="h-4 w-4" />
        Applied
      </span>
    );
  }
  if (vote.award.kind === "legacyAwardTombstone") {
    return (
      <Badge title="Historical award evidence was migrated" variant="outline">
        Legacy award
      </Badge>
    );
  }
  return <Badge variant="secondary">Unawarded</Badge>;
}

export function ConvexTagsPage() {
  const convex = useConvex();
  const [tags, setTags] = useState<ConvexAdminTag[] | null>(null);
  const [votes, setVotes] = useState<ConvexAdminTagVote[] | null>(null);
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<
    ConvexAdminTag | null | undefined
  >(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [awardTarget, setAwardTarget] =
    useState<ConvexAdminTagVote | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void Promise.all([
      loadConvexAdminTags(convex),
      loadConvexAdminTagVotesPage(convex, null),
    ])
      .then(([tagCatalog, votePage]) => {
        if (active) {
          setTags(tagCatalog);
          setVotes(votePage.votes);
          setContinueCursor(votePage.continueCursor);
          setIsDone(votePage.isDone);
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

  const refresh = () => {
    setTags(null);
    setVotes(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMoreVotes = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexAdminTagVotesPage(convex, continueCursor)
      .then((result) => {
        setVotes((current) => [...(current ?? []), ...result.votes]);
        setContinueCursor(result.continueCursor);
        setIsDone(result.isDone);
      })
      .catch(() => {
        toast.error("The next vote page could not be loaded.");
      })
      .finally(() => setIsLoadingMore(false));
  };

  const saveTag = (input: ConvexAdminTagInput) => {
    const current = editingTag;
    if (current === undefined) {
      return;
    }
    setPendingAction(current?.id ?? "create-tag");
    void (current === null
      ? createConvexAdminTag(convex, input)
      : updateConvexAdminTag(convex, current.id, input))
      .then(() => {
        toast.success(current === null ? "Tag created." : "Tag updated.");
        setEditingTag(undefined);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  const deleteItem = (target: DeleteTarget) => {
    setPendingAction(target.item.id);
    const mutation =
      target.kind === "tag"
        ? deleteConvexAdminTag(convex, target.item.id)
        : deleteConvexAdminTagVote(convex, target.item.id);
    void mutation
      .then(() => {
        toast.success(target.kind === "tag" ? "Tag deleted." : "Vote deleted.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  const applyPoints = (vote: ConvexAdminTagVote) => {
    setPendingAction(vote.id);
    void applyConvexAdminTagVotePoints(
      convex,
      vote.id,
      getPacificTodayPlainDate()
    )
      .then(() => {
        toast.success("Tag-vote points applied.");
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
        <title>Tags - BBPC Admin</title>
      </Head>
      {editingTag !== undefined && (
        <TagEditor
          editingTag={editingTag}
          isSaving={pendingAction !== null}
          onClose={() => setEditingTag(undefined)}
          onSave={saveTag}
        />
      )}
      <ConfirmModal
        confirmText="Delete"
        description={
          deleteTarget === null
            ? ""
            : deleteTarget.kind === "tag"
              ? `Delete the catalog tag “${deleteTarget.item.name}”? Existing free-text votes are preserved.`
              : `Delete the vote “${deleteTarget.item.tag}”? Any awarded point or historical award evidence is preserved.`
        }
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget !== null) {
            deleteItem(deleteTarget);
          }
        }}
        title={deleteTarget?.kind === "tag" ? "Delete tag" : "Delete vote"}
      />
      <ConfirmModal
        confirmText="Apply points"
        description={
          awardTarget === null
            ? ""
            : `Apply the current season’s tag-vote points to ${awardTarget.user?.name ?? "this user"}? This is blocked if any live or historical award evidence exists.`
        }
        isOpen={awardTarget !== null}
        onClose={() => setAwardTarget(null)}
        onConfirm={() => {
          if (awardTarget !== null) {
            applyPoints(awardTarget);
          }
        }}
        title="Apply tag-vote points"
        variant="default"
      />

      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Tags & Votes</h2>
          <p className="text-muted-foreground">
            Manage the bounded tag catalog and paginated vote ledger.
          </p>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Tags and votes could not be loaded. No legacy SQL fallback was
              attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : tags === null || votes === null ? (
          <div className="rounded-md border bg-card p-16 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs className="w-full" defaultValue="tags">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="tags">Tags</TabsTrigger>
              <TabsTrigger value="votes">Tag Votes</TabsTrigger>
            </TabsList>

            <TabsContent className="mt-6" value="tags">
              <div className="mb-4 flex justify-end">
                <Button onClick={() => setEditingTag(null)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Tag
                </Button>
              </div>
              <div className="rounded-md border bg-card shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Created At</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tags.length === 0 && (
                      <TableRow>
                        <TableCell className="h-24 text-center" colSpan={4}>
                          No tags found.
                        </TableCell>
                      </TableRow>
                    )}
                    {tags.map((tag) => (
                      <TableRow key={tag.id}>
                        <TableCell className="font-bold">
                          <span className="flex items-center gap-2">
                            <TagIcon className="h-4 w-4 text-cyan-500" />
                            {tag.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {tag.description ?? "-"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatInstantLocal(new Date(tag.createdAt))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            aria-label={`Edit ${tag.name}`}
                            disabled={pendingAction !== null}
                            onClick={() => setEditingTag(tag)}
                            size="icon"
                            variant="ghost"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`Delete ${tag.name}`}
                            disabled={pendingAction !== null}
                            onClick={() =>
                              setDeleteTarget({ kind: "tag", item: tag })
                            }
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent className="mt-6" value="votes">
              <div className="rounded-md border bg-card shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>User Tag</TableHead>
                      <TableHead>TMDB ID</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Award</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {votes.length === 0 && (
                      <TableRow>
                        <TableCell className="h-24 text-center" colSpan={7}>
                          No votes found.
                        </TableCell>
                      </TableRow>
                    )}
                    {votes.map((vote) => (
                      <TableRow key={vote.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {vote.user?.image === null ||
                            vote.user === null ? (
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
                                <UserIcon className="h-4 w-4 text-muted-foreground" />
                              </div>
                            ) : (
                              <Image
                                alt={vote.user.name ?? "User"}
                                className="h-6 w-6 rounded-full"
                                height={24}
                                src={vote.user.image}
                                unoptimized
                                width={24}
                              />
                            )}
                            <span className="text-sm font-medium">
                              {vote.user?.name ?? "Unknown"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <Vote className="h-4 w-4 text-purple-500" />
                            {vote.tag}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {vote.tmdbId}
                        </TableCell>
                        <TableCell>
                          <VoteTypeBadge value={vote.isTag} />
                        </TableCell>
                        <TableCell>
                          <AwardEvidence vote={vote} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatInstantLocal(new Date(vote.createdAt))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            aria-label={`Apply points for ${vote.tag}`}
                            disabled={
                              pendingAction !== null ||
                              vote.user === null ||
                              vote.award.kind !== "unawarded"
                            }
                            onClick={() => setAwardTarget(vote)}
                            size="icon"
                            title={
                              vote.user === null
                                ? "A canonical user is required"
                                : vote.award.kind !== "unawarded"
                                  ? "Award evidence already exists"
                                  : "Apply points"
                            }
                            variant="ghost"
                          >
                            <Coins className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button
                            aria-label={`Delete vote ${vote.tag}`}
                            disabled={pendingAction !== null}
                            onClick={() =>
                              setDeleteTarget({ kind: "vote", item: vote })
                            }
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {!isDone && (
                <div className="flex justify-center py-4">
                  <Button
                    className="w-full max-w-xs"
                    disabled={isLoadingMore}
                    onClick={loadMoreVotes}
                    variant="outline"
                  >
                    {isLoadingMore && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {isLoadingMore ? "Loading more..." : "Load More Votes"}
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}
