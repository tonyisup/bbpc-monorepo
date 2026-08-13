import { useConvex } from "convex/react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAdminMovie,
  type ConvexAdminShow,
  type ConvexTmdbTitle,
  searchConvexCatalogMovies,
  searchConvexCatalogShows,
} from "@/convex/catalog";
import {
  type ConvexAdminEpisodeAssignmentType,
  type ConvexAdminEpisodeDetail,
  addConvexAdminEpisodeAssignmentFromTmdb,
  addConvexAdminEpisodeExtra,
  removeConvexAdminEpisodeAssignment,
  searchConvexAdminAssignmentMovies,
} from "@/convex/episodeDetails";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  deleteConvexAdminReview,
  loadConvexReviewDeleteImpact,
} from "@/convex/reviews";
import { type ConvexAdminUser, loadConvexAdminUsersPage } from "@/convex/users";
import { getAdminAssignmentPath } from "@/lib/routes";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
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

type CatalogKind = "movie" | "show";
type CatalogSelection = Pick<
  ConvexAdminMovie | ConvexAdminShow,
  "id" | "title" | "year"
>;

function relationshipMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The relationship changed, reached its safety limit, or still has dependent data. Refresh before retrying.";
    case "VALIDATION_FAILED":
      return "Choose a valid user, title, and relationship type.";
    case "WRITE_DISABLED":
      return "Episode relationship changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The episode relationship could not be changed.";
  }
}

function assignmentMovieSearchMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "AUTHENTICATION_REQUIRED":
      return "Sign in again before searching TMDB.";
    case "VALIDATION_FAILED":
      return "Enter at least three useful search characters.";
    default:
      return "TMDB movie search is unavailable in this Convex deployment.";
  }
}

function tmdbMovieYear(movie: ConvexTmdbTitle): string {
  const match = /^(\d{4})-\d{2}-\d{2}$/u.exec(movie.release_date);
  return match?.[1] ?? "N/A";
}

function UserPicker({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (user: ConvexAdminUser) => void;
}) {
  const convex = useConvex();
  const [users, setUsers] = useState<ConvexAdminUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    void loadConvexAdminUsersPage(convex, null)
      .then((page) => {
        if (!active) return;
        setUsers(page.users);
        setDone(page.isDone);
        setCursor(page.isDone ? null : page.continueCursor);
      })
      .catch(() => active && setFailed(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [convex]);

  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return users.filter((user) => {
      if (user.status !== "active") return false;
      if (normalized.length === 0) return true;
      return [user.name, user.email].some((value) =>
        value?.toLocaleLowerCase().includes(normalized)
      );
    });
  }, [query, users]);

  return (
    <div className="grid gap-2">
      <Label htmlFor="episode-relationship-user-search">User</Label>
      <Input
        id="episode-relationship-user-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search loaded users"
        value={query}
      />
      <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-2">
        {loading ? (
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
        ) : failed ? (
          <p className="text-sm text-destructive">Users could not be loaded.</p>
        ) : visibleUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active users match the current search.
          </p>
        ) : (
          visibleUsers.map((user) => (
            <Button
              className="h-auto w-full justify-start px-3 py-2 text-left"
              key={user.id}
              onClick={() => onSelect(user)}
              type="button"
              variant={selectedId === user.id ? "secondary" : "ghost"}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {user.name ?? user.email ?? "Unnamed user"}
                </span>
                {user.name !== null && user.email !== null && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </span>
            </Button>
          ))
        )}
      </div>
      {!done && cursor !== null && (
        <Button
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setFailed(false);
            void loadConvexAdminUsersPage(convex, cursor)
              .then((page) => {
                setUsers((current) => [...current, ...page.users]);
                setDone(page.isDone);
                setCursor(page.isDone ? null : page.continueCursor);
              })
              .catch(() => setFailed(true))
              .finally(() => setLoading(false));
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          Load more users
        </Button>
      )}
    </div>
  );
}

function CatalogPicker({
  kind,
  selection,
  onSelect,
}: {
  kind: CatalogKind;
  selection: CatalogSelection | null;
  onSelect: (selection: CatalogSelection) => void;
}) {
  const convex = useConvex();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = () => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      toast.error("Enter at least two characters to search the catalog.");
      return;
    }
    setLoading(true);
    setSearched(true);
    const request =
      kind === "movie"
        ? searchConvexCatalogMovies(convex, normalized)
        : searchConvexCatalogShows(convex, normalized);
    void request
      .then((items) => setResults(items))
      .catch(() => toast.error(`The ${kind} catalog search failed.`))
      .finally(() => setLoading(false));
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor={`episode-relationship-${kind}-search`}>
        {kind === "movie" ? "Movie" : "TV show"}
      </Label>
      <div className="flex gap-2">
        <Input
          id={`episode-relationship-${kind}-search`}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search();
            }
          }}
          placeholder={`Search migrated ${kind}s`}
          value={query}
        />
        <Button
          disabled={loading}
          onClick={search}
          type="button"
          variant="outline"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </div>
      {selection !== null && (
        <p className="text-sm text-muted-foreground">
          Selected:{" "}
          <strong className="text-foreground">{selection.title}</strong> (
          {selection.year})
        </p>
      )}
      {searched && !loading && (
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No migrated catalog matches.
            </p>
          ) : (
            results.map((item) => (
              <Button
                className="h-auto w-full justify-start px-3 py-2 text-left"
                key={item.id}
                onClick={() => onSelect(item)}
                type="button"
                variant={selection?.id === item.id ? "secondary" : "ghost"}
              >
                {item.title} ({item.year})
              </Button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TmdbMoviePicker({
  selection,
  onSelect,
}: {
  selection: ConvexTmdbTitle | null;
  onSelect: (selection: ConvexTmdbTitle) => void;
}) {
  const convex = useConvex();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConvexTmdbTitle[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = () => {
    const normalized = query.trim();
    if (normalized.length < 3) {
      toast.error("Enter at least three characters to search TMDB.");
      return;
    }
    setLoading(true);
    setSearched(true);
    void searchConvexAdminAssignmentMovies(convex, normalized)
      .then((items) => setResults(items))
      .catch((error: unknown) =>
        toast.error(assignmentMovieSearchMessage(error))
      )
      .finally(() => setLoading(false));
  };

  return (
    <div className="grid gap-2">
      <Label htmlFor="episode-assignment-movie-search">Movie</Label>
      <div className="flex gap-2">
        <Input
          id="episode-assignment-movie-search"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search();
            }
          }}
          placeholder="Search TMDB movies"
          value={query}
        />
        <Button
          disabled={loading}
          onClick={search}
          type="button"
          variant="outline"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </div>
      {selection !== null && (
        <p className="text-sm text-muted-foreground">
          Selected:{" "}
          <strong className="text-foreground">{selection.title}</strong> (
          {tmdbMovieYear(selection)})
        </p>
      )}
      {searched && !loading && (
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-2">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No TMDB movies match this search.
            </p>
          ) : (
            results.map((movie) => (
              <Button
                className="h-auto w-full justify-start px-3 py-2 text-left"
                key={movie.id}
                onClick={() => onSelect(movie)}
                type="button"
                variant={selection?.id === movie.id ? "secondary" : "ghost"}
              >
                {movie.title} ({tmdbMovieYear(movie)})
              </Button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AddAssignmentDialog({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (input: {
    userId: string;
    movie: ConvexTmdbTitle;
    type: ConvexAdminEpisodeAssignmentType;
    playable: boolean;
  }) => void;
}) {
  const [user, setUser] = useState<ConvexAdminUser | null>(null);
  const [movie, setMovie] = useState<ConvexTmdbTitle | null>(null);
  const [type, setType] =
    useState<ConvexAdminEpisodeAssignmentType>("HOMEWORK");
  const [playable, setPlayable] = useState(true);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add assignment</DialogTitle>
          <DialogDescription>
            Choose the assigner, a movie from TMDB, and the assignment type.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          <UserPicker selectedId={user?.id ?? null} onSelect={setUser} />
          <TmdbMoviePicker onSelect={setMovie} selection={movie} />
          <div className="grid gap-2">
            <Label htmlFor="episode-assignment-type">Assignment type</Label>
            <Select
              onValueChange={(value) =>
                setType(value as ConvexAdminEpisodeAssignmentType)
              }
              value={type}
            >
              <SelectTrigger id="episode-assignment-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HOMEWORK">Homework</SelectItem>
                <SelectItem value="EXTRA_CREDIT">Extra credit</SelectItem>
                <SelectItem value="BONUS">Bonus</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              checked={playable}
              id="episode-assignment-playable"
              onCheckedChange={(checked) => setPlayable(checked === true)}
            />
            <div className="grid gap-1">
              <Label htmlFor="episode-assignment-playable">Playable</Label>
              <p className="text-xs text-muted-foreground">
                Make this assignment available for gameplay.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={saving}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={saving || user === null || movie === null}
            onClick={() => {
              if (user !== null && movie !== null) {
                onSave({
                  userId: user.id,
                  movie,
                  type,
                  playable,
                });
              }
            }}
            type="button"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddExtraDialog({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (input: {
    userId: string;
    kind: CatalogKind;
    mediaId: string;
  }) => void;
}) {
  const [user, setUser] = useState<ConvexAdminUser | null>(null);
  const [kind, setKind] = useState<CatalogKind>("movie");
  const [media, setMedia] = useState<CatalogSelection | null>(null);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add extra</DialogTitle>
          <DialogDescription>
            Choose the reviewer and a migrated movie or TV show.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-2">
          <UserPicker selectedId={user?.id ?? null} onSelect={setUser} />
          <div className="grid gap-2">
            <Label htmlFor="episode-extra-kind">Media type</Label>
            <Select
              onValueChange={(value) => {
                setKind(value as CatalogKind);
                setMedia(null);
              }}
              value={kind}
            >
              <SelectTrigger id="episode-extra-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="movie">Movie</SelectItem>
                <SelectItem value="show">TV show</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CatalogPicker
            key={kind}
            kind={kind}
            onSelect={setMedia}
            selection={media}
          />
        </div>
        <DialogFooter>
          <Button
            disabled={saving}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={saving || user === null || media === null}
            onClick={() => {
              if (user !== null && media !== null) {
                onSave({ userId: user.id, kind, mediaId: media.id });
              }
            }}
            type="button"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add extra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EpisodeRelationships({
  episode,
  onRefresh,
}: {
  episode: ConvexAdminEpisodeDetail;
  onRefresh: () => void;
}) {
  const convex = useConvex();
  const [dialog, setDialog] = useState<"assignment" | "extra" | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      {dialog === "assignment" && (
        <AddAssignmentDialog
          onClose={() => setDialog(null)}
          onSave={(input) => {
            setSaving(true);
            void addConvexAdminEpisodeAssignmentFromTmdb(
              convex,
              episode.id,
              input
            )
              .then(() => {
                toast.success("Assignment added.");
                setDialog(null);
                onRefresh();
              })
              .catch((error: unknown) =>
                toast.error(relationshipMessage(error))
              )
              .finally(() => setSaving(false));
          }}
          saving={saving}
        />
      )}
      {dialog === "extra" && (
        <AddExtraDialog
          onClose={() => setDialog(null)}
          onSave={(input) => {
            setSaving(true);
            void addConvexAdminEpisodeExtra(convex, episode.id, input)
              .then(() => {
                toast.success("Extra added.");
                setDialog(null);
                onRefresh();
              })
              .catch((error: unknown) =>
                toast.error(relationshipMessage(error))
              )
              .finally(() => setSaving(false));
          }}
          saving={saving}
        />
      )}

      <div className="space-y-8">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Assignments ({episode.assignments.length})</CardTitle>
              <CardDescription>
                Add assignments here. Deletion is allowed only after dependent
                reviews, guesses, wagers, points, syllabus entries, and audio
                are removed.
              </CardDescription>
            </div>
            <Button
              className="shrink-0 gap-2"
              onClick={() => setDialog("assignment")}
              size="sm"
            >
              <Plus className="h-4 w-4" />
              Add assignment
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {episode.assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assignments.</p>
            ) : (
              episode.assignments.map((assignment) => (
                <div
                  className="rounded-xl border bg-muted/20 p-4"
                  key={assignment.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{assignment.type}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {assignment.playable ? "Playable" : "Not playable"}
                        </span>
                      </div>
                      {assignment.slug === null ? (
                        <p className="mt-3 font-bold">
                          {assignment.movie.title} ({assignment.movie.year})
                        </p>
                      ) : (
                        <Link
                          className="mt-3 block font-bold hover:text-primary"
                          href={getAdminAssignmentPath(assignment.slug)}
                        >
                          {assignment.movie.title} ({assignment.movie.year})
                        </Link>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {assignment.user.name ?? "Unnamed user"}
                      </p>
                      <Link
                        className="mt-2 inline-block text-xs text-muted-foreground hover:text-primary"
                        href={`/movie/${assignment.movie.id}`}
                      >
                        View movie
                      </Link>
                    </div>
                    <Button
                      aria-label={`Delete assignment for ${assignment.movie.title}`}
                      disabled={saving}
                      onClick={() => {
                        if (
                          !confirm(
                            `Delete the ${assignment.type.toLocaleLowerCase()} assignment for “${
                              assignment.movie.title
                            }”? This succeeds only when no dependent game, review, point, syllabus, or audio data remains.`
                          )
                        ) {
                          return;
                        }
                        setSaving(true);
                        void removeConvexAdminEpisodeAssignment(
                          convex,
                          episode.id,
                          assignment
                        )
                          .then(() => {
                            toast.success("Assignment deleted.");
                            onRefresh();
                          })
                          .catch((error: unknown) =>
                            toast.error(relationshipMessage(error))
                          )
                          .finally(() => setSaving(false));
                      }}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Extras ({episode.extras.length})</CardTitle>
              <CardDescription>
                Removing an extra deletes its underlying review through the
                confirmed Convex cascade and reports any related links or
                guesses first.
              </CardDescription>
            </div>
            <Button
              className="shrink-0 gap-2"
              onClick={() => setDialog("extra")}
              size="sm"
            >
              <Plus className="h-4 w-4" />
              Add extra
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {episode.extras.length === 0 ? (
              <p className="text-sm text-muted-foreground">No extras.</p>
            ) : (
              episode.extras.map((extra) => {
                const target = extra.review.movie ?? extra.review.show;
                const kind = extra.review.movie === null ? "show" : "movie";
                const title = target?.title ?? "Missing media target";
                return (
                  <div
                    className="rounded-xl border bg-muted/20 p-4"
                    key={extra.id}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Badge variant="secondary">Extra</Badge>
                        {target === null ? (
                          <p className="mt-3 text-sm text-destructive">
                            {title}
                          </p>
                        ) : (
                          <Link
                            className="mt-3 block font-bold hover:text-primary"
                            href={`/${kind}/${target.id}`}
                          >
                            {target.title} ({target.year})
                          </Link>
                        )}
                      </div>
                      <Button
                        aria-label={`Delete extra ${title}`}
                        disabled={saving}
                        onClick={() => {
                          setSaving(true);
                          void loadConvexReviewDeleteImpact(
                            convex,
                            extra.review.id
                          )
                            .then(async (impact) => {
                              const approved = confirm(
                                `Delete the extra “${title}”? This deletes its review, ${impact.extraReviewCount} extra link(s), ${impact.assignmentReviewCount} assignment-review link(s), and ${impact.guessCount} guess(es).`
                              );
                              if (!approved) return false;
                              await deleteConvexAdminReview(convex, impact);
                              return true;
                            })
                            .then((deleted) => {
                              if (deleted) {
                                toast.success("Extra deleted.");
                                onRefresh();
                              }
                            })
                            .catch((error: unknown) =>
                              toast.error(relationshipMessage(error))
                            )
                            .finally(() => setSaving(false));
                        }}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
