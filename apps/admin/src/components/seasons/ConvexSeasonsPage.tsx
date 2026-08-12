import { useConvex } from "convex/react";
import {
  Calendar,
  Edit2,
  Flag,
  Gamepad2,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Trash2,
  Trophy,
  Users,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexAdminGameType,
  type ConvexAdminSeason,
  type ConvexAdminSeasonInput,
  createConvexAdminSeason,
  deleteConvexAdminSeason,
  loadConvexAdminGameTypes,
  loadConvexAdminSeasonsPage,
  updateConvexAdminSeason,
} from "@/convex/seasons";
import { formatPlainDate, getPacificTodayPlainDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
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
import { Textarea } from "../ui/textarea";

export function seasonMutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "That season is referenced by game activity or conflicts with existing data.";
    case "VALIDATION_FAILED":
      return "Check the season title, ruleset, and date range.";
    case "WRITE_DISABLED":
      return "Season changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The season change could not be saved.";
  }
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function ConvexSeasonEditor({
  editingSeason,
  gameTypes,
  isSaving,
  onClose,
  onSave,
}: {
  editingSeason: ConvexAdminSeason | null;
  gameTypes: ConvexAdminGameType[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminSeasonInput) => void;
}) {
  const [title, setTitle] = useState(editingSeason?.title ?? "");
  const [description, setDescription] = useState(
    editingSeason?.description ?? ""
  );
  const [gameTypeId, setGameTypeId] = useState(
    editingSeason?.gameType.id ?? ""
  );
  const [startedOn, setStartedOn] = useState(
    editingSeason?.startedOn ?? getPacificTodayPlainDate()
  );
  const [endedOn, setEndedOn] = useState(editingSeason?.endedOn ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const dateRangeIsValid = endedOn.length === 0 || endedOn >= startedOn;
  const isValid =
    title.trim().length > 0 &&
    gameTypeId.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/u.test(startedOn) &&
    dateRangeIsValid;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>
            {editingSeason === null ? "Create New Season" : "Edit Season"}
          </DialogTitle>
          <DialogDescription>
            Season dates are date-only values and do not shift with time zones.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-season-title">Season Title</Label>
            <Input
              aria-invalid={showErrors && title.trim().length === 0}
              id="convex-season-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-season-description">
              Description (Optional)
            </Label>
            <Textarea
              id="convex-season-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-season-game-type">Game Ruleset</Label>
            <Select onValueChange={setGameTypeId} value={gameTypeId}>
              <SelectTrigger id="convex-season-game-type">
                <SelectValue placeholder="Select game rules..." />
              </SelectTrigger>
              <SelectContent>
                {gameTypes.map((gameType) => (
                  <SelectItem key={gameType.id} value={gameType.id}>
                    {gameType.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="convex-season-start">Start Date</Label>
              <Input
                id="convex-season-start"
                onChange={(event) => setStartedOn(event.target.value)}
                type="date"
                value={startedOn}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convex-season-end">End Date (Optional)</Label>
              <Input
                aria-invalid={showErrors && !dateRangeIsValid}
                id="convex-season-end"
                min={startedOn}
                onChange={(event) => setEndedOn(event.target.value)}
                type="date"
                value={endedOn}
              />
            </div>
          </div>
          {showErrors && !isValid && (
            <p className="text-xs text-destructive">
              A title, ruleset, valid start date, and non-reversed date range
              are required.
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
                  title: title.trim(),
                  description: nullableText(description),
                  gameTypeId,
                  startedOn,
                  endedOn: endedOn.length === 0 ? null : endedOn,
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Season"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function seasonStatus(
  season: ConvexAdminSeason,
  today: string
): "active" | "upcoming" | "ended" {
  if (season.startedOn !== null && season.startedOn > today) {
    return "upcoming";
  }
  if (season.endedOn !== null && season.endedOn < today) {
    return "ended";
  }
  return "active";
}

function canDeleteSeason(season: ConvexAdminSeason): boolean {
  return Object.values(season.counts).every(
    (count) => count.isExact && count.count === 0
  );
}

export function ConvexSeasonsPage() {
  const convex = useConvex();
  const [seasons, setSeasons] = useState<ConvexAdminSeason[] | null>(null);
  const [gameTypes, setGameTypes] = useState<ConvexAdminGameType[] | null>(
    null
  );
  const [continueCursor, setContinueCursor] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingSeason, setEditingSeason] = useState<
    ConvexAdminSeason | null | undefined
  >(undefined);
  const [deletingSeason, setDeletingSeason] =
    useState<ConvexAdminSeason | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const today = getPacificTodayPlainDate();

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void Promise.all([
      loadConvexAdminSeasonsPage(convex, null),
      loadConvexAdminGameTypes(convex),
    ])
      .then(([seasonPage, gameTypeList]) => {
        if (active) {
          setSeasons(seasonPage.seasons);
          setContinueCursor(seasonPage.continueCursor);
          setIsDone(seasonPage.isDone);
          setGameTypes(gameTypeList);
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

  const filteredSeasons = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (seasons ?? []).filter(
      (season) =>
        query.length === 0 ||
        season.title.toLowerCase().includes(query) ||
        season.description?.toLowerCase().includes(query) === true
    );
  }, [searchQuery, seasons]);

  const refresh = () => {
    setSeasons(null);
    setGameTypes(null);
    setContinueCursor(null);
    setIsDone(true);
    setRevision((value) => value + 1);
  };

  const loadMore = () => {
    if (isDone || continueCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexAdminSeasonsPage(convex, continueCursor)
      .then((nextPage) => {
        setSeasons((current) => [...(current ?? []), ...nextPage.seasons]);
        setContinueCursor(nextPage.continueCursor);
        setIsDone(nextPage.isDone);
      })
      .catch(() => {
        toast.error("The next season page could not be loaded.");
      })
      .finally(() => {
        setIsLoadingMore(false);
      });
  };

  const saveSeason = (input: ConvexAdminSeasonInput) => {
    const currentSeason = editingSeason;
    if (currentSeason === undefined) {
      return;
    }
    setPendingAction(currentSeason?.id ?? "create");
    void (
      currentSeason === null
        ? createConvexAdminSeason(convex, input)
        : updateConvexAdminSeason(convex, currentSeason.id, input)
    )
      .then(() => {
        toast.success(
          currentSeason === null ? "Season created." : "Season updated."
        );
        setEditingSeason(undefined);
        refresh();
      })
      .catch((error: unknown) => {
      toast.error(seasonMutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const deleteSeason = (season: ConvexAdminSeason) => {
    setPendingAction(season.id);
    void deleteConvexAdminSeason(convex, season.id)
      .then(() => {
        toast.success("Season deleted.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(seasonMutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  return (
    <>
      <Head>
        <title>Seasons - BBPC Admin</title>
      </Head>
      {editingSeason !== undefined && gameTypes !== null && (
        <ConvexSeasonEditor
          editingSeason={editingSeason}
          gameTypes={gameTypes}
          isSaving={pendingAction !== null}
          onClose={() => setEditingSeason(undefined)}
          onSave={saveSeason}
        />
      )}
      <ConfirmModal
        confirmText="Delete season"
        description={
          deletingSeason === null
            ? ""
            : `Delete “${deletingSeason.title}”? Any referenced game activity will block this operation.`
        }
        isOpen={deletingSeason !== null}
        onClose={() => setDeletingSeason(null)}
        onConfirm={() => {
          if (deletingSeason !== null) {
            deleteSeason(deletingSeason);
          }
        }}
        title="Delete season"
      />

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8">
        <div className="relative flex flex-col justify-between gap-6 overflow-hidden rounded-2xl border bg-card p-8 shadow-sm md:flex-row md:items-center">
          <div className="pointer-events-none absolute right-0 top-0 p-8 opacity-5">
            <Trophy className="h-32 w-32 -rotate-12" />
          </div>
          <div className="relative z-10">
            <h1 className="flex items-center gap-3 text-4xl font-extrabold tracking-tight">
              <Trophy className="h-8 w-8 text-primary" />
              Seasons
            </h1>
            <p className="mt-2 text-lg font-medium text-muted-foreground">
              Manage bounded season definitions and their game rulesets.
            </p>
          </div>
          <Button
            className="relative z-10"
            disabled={gameTypes === null || gameTypes.length === 0}
            onClick={() => setEditingSeason(null)}
            size="lg"
          >
            <Plus className="mr-2 h-5 w-5" />
            New Season
          </Button>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-dashed bg-muted/30 p-2">
          <div className="group relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-12 border-none bg-card pl-11 shadow-none"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter loaded seasons..."
              value={searchQuery}
            />
          </div>
          <div className="hidden items-center gap-2 border-l px-4 text-xs font-bold uppercase tracking-widest text-muted-foreground sm:flex">
            <Calendar className="h-3.5 w-3.5" />
            {filteredSeasons.length} loaded
          </div>
        </div>

        {loadFailed ? (
          <Card className="p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Seasons could not be loaded. No legacy SQL fallback was attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </Card>
        ) : seasons === null ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredSeasons.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground">
            No loaded seasons match this filter.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredSeasons.map((season) => {
              const status = seasonStatus(season, today);
              const canDelete = canDeleteSeason(season);
              return (
                <Card
                  className={cn(
                    "relative flex h-full flex-col overflow-hidden",
                    status === "active" && "ring-1 ring-primary/20",
                    status === "ended" && "opacity-80"
                  )}
                  key={season.id}
                >
                  <div
                    className={cn(
                      "absolute right-0 top-0 rounded-bl-xl px-4 py-1.5 text-[10px] font-black uppercase tracking-widest",
                      status === "active"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {status}
                  </div>
                  <CardHeader>
                    <Badge className="w-fit" variant="secondary">
                      <Gamepad2 className="mr-1 h-3 w-3" />
                      {season.gameType.title}
                    </Badge>
                    <CardTitle>{season.title}</CardTitle>
                    <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                      {season.description ?? "No description provided."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-4">
                    <div className="flex items-center gap-2 rounded-lg bg-muted/30 p-2 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>
                        {season.startedOn === null
                          ? "Unknown"
                          : formatPlainDate(season.startedOn)}
                      </span>
                      <span>–</span>
                      <span>
                        {season.endedOn === null
                          ? "Ongoing"
                          : formatPlainDate(season.endedOn)}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-primary/5 p-3">
                        <span className="text-[10px] font-bold uppercase text-primary/70">
                          Guesses
                        </span>
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4" />
                          <span className="text-xl font-black">
                            {season.counts.guesses.count}
                            {!season.counts.guesses.isExact && "+"}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-xl bg-orange-500/5 p-3">
                        <span className="text-[10px] font-bold uppercase text-orange-600/70">
                          Points
                        </span>
                        <div className="flex items-center gap-2">
                          <Receipt className="h-4 w-4" />
                          <span className="text-xl font-black">
                            {season.counts.points.count}
                            {!season.counts.points.isExact && "+"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-auto flex justify-end gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/season/${season.id}`}>View details</Link>
                      </Button>
                      <Button
                        aria-label={`Edit ${season.title}`}
                        disabled={pendingAction !== null}
                        onClick={() => setEditingSeason(season)}
                        size="icon"
                        variant="ghost"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        aria-label={`Delete ${season.title}`}
                        disabled={!canDelete || pendingAction !== null}
                        onClick={() => setDeletingSeason(season)}
                        size="icon"
                        title={
                          canDelete
                            ? "Delete season"
                            : "Referenced seasons cannot be deleted."
                        }
                        variant="ghost"
                      >
                        {canDelete ? (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        ) : (
                          <Flag className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
        {!isDone && (
          <div className="flex justify-end">
            <Button
              disabled={isLoadingMore}
              onClick={loadMore}
              variant="outline"
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
