import { useConvex } from "convex/react";
import {
  Calendar,
  ChevronRight,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Trophy,
} from "lucide-react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useBbpcAdminAuth } from "@/components/auth/BbpcAdminAuthContext";
import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexRankedListSummary,
  createMyConvexRankedList,
  deleteConvexRankedList,
  loadConvexAdminRankedListsPage,
  loadMyConvexRankedLists,
} from "@/convex/rankedLists";
import {
  type ConvexAdminRankingType,
  loadConvexAdminRankingTypes,
} from "@/convex/rankingTypes";
import { formatInstantLocal } from "@/lib/dates";

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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui/tabs";

function writeFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "The list conflicts with its owner, type, or supported capacity.";
    case "NOT_FOUND":
      return "The list or list type is no longer available.";
    case "VALIDATION_FAILED":
      return "The ranked-list request did not pass validation.";
    case "WRITE_DISABLED":
      return "Ranked-list changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The ranked-list change could not be completed.";
  }
}

function RankedListCard({
  canDelete,
  list,
  onDelete,
}: {
  canDelete: boolean;
  list: ConvexRankedListSummary;
  onDelete: (list: ConvexRankedListSummary) => void;
}) {
  return (
    <Link className="block" href={`/lists/${list.id}`}>
      <Card className="group h-full border-l-4 border-l-primary transition-all hover:-translate-y-0.5 hover:shadow-xl">
        <CardHeader>
          <div className="flex items-start justify-between">
            <Badge
              className="text-[10px] font-black uppercase"
              variant={list.status === "PUBLISHED" ? "default" : "secondary"}
            >
              {list.status}
            </Badge>
            <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          <CardTitle className="line-clamp-1 pt-2 text-xl">
            {list.title ?? list.type.name}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge className="text-[10px]" variant="outline">
              {list.type.name}
            </Badge>
            <span>by {list.user.name ?? "Unnamed user"}</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end justify-between gap-3">
            <div>
              <span className="text-2xl font-bold">{list.itemCount}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                / {list.type.maxItems} items
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {formatInstantLocal(new Date(list.updatedAt))}
            </div>
            {canDelete && (
              <Button
                aria-label={`Delete ${list.title ?? list.type.name}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onDelete(list);
                }}
                size="icon"
                variant="outline"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function ConvexRankedListsPage() {
  const convex = useConvex();
  const router = useRouter();
  const { accountStatus, signIn, status, user } = useBbpcAdminAuth();
  const isReady =
    status === "authenticated" && accountStatus === "ready" && user !== null;
  const isAdmin = user?.isAdmin === true;
  const [types, setTypes] = useState<ConvexAdminRankingType[] | null>(null);
  const [myLists, setMyLists] = useState<ConvexRankedListSummary[] | null>(
    null
  );
  const [allLists, setAllLists] = useState<
    ConvexRankedListSummary[] | null
  >(null);
  const [adminCursor, setAdminCursor] = useState<string | null>(null);
  const [adminDone, setAdminDone] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null);
  const [deletingList, setDeletingList] =
    useState<ConvexRankedListSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    let active = true;
    setLoadFailed(false);
    const adminLoad = isAdmin
      ? loadConvexAdminRankedListsPage(convex, null)
      : Promise.resolve(null);
    void Promise.all([
      loadConvexAdminRankingTypes(convex),
      loadMyConvexRankedLists(convex),
      adminLoad,
    ])
      .then(([loadedTypes, loadedMine, loadedAdmin]) => {
        if (!active) {
          return;
        }
        setTypes(loadedTypes);
        setMyLists(loadedMine);
        if (loadedAdmin !== null) {
          setAllLists(loadedAdmin.lists);
          setAdminCursor(loadedAdmin.continueCursor);
          setAdminDone(loadedAdmin.isDone);
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
  }, [convex, isAdmin, isReady, revision]);

  const refresh = () => {
    setTypes(null);
    setMyLists(null);
    setAllLists(null);
    setAdminCursor(null);
    setAdminDone(true);
    setRevision((value) => value + 1);
  };

  const createList = (typeId: string) => {
    setPendingTypeId(typeId);
    void createMyConvexRankedList(convex, typeId)
      .then((list) => router.push(`/lists/${list.id}`))
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
      })
      .finally(() => setPendingTypeId(null));
  };

  const deleteList = () => {
    if (deletingList === null || isDeleting) {
      return;
    }
    setIsDeleting(true);
    void deleteConvexRankedList(convex, deletingList.id)
      .then((deletedItems) => {
        toast.success(
          `Ranked list and ${String(deletedItems)} item${
            deletedItems === 1 ? "" : "s"
          } deleted.`
        );
        setDeletingList(null);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(writeFailureMessage(error));
      })
      .finally(() => setIsDeleting(false));
  };

  const loadMoreAdmin = () => {
    if (adminDone || adminCursor === null || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    void loadConvexAdminRankedListsPage(convex, adminCursor)
      .then((result) => {
        setAllLists((current) => [...(current ?? []), ...result.lists]);
        setAdminCursor(result.continueCursor);
        setAdminDone(result.isDone);
      })
      .catch(() => {
        toast.error("The next ranked-list page could not be loaded.");
      })
      .finally(() => setIsLoadingMore(false));
  };

  if (status === "unauthenticated") {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Trophy className="mb-4 h-16 w-16 text-muted-foreground opacity-20" />
        <h1 className="mb-2 text-3xl font-bold">Ranked Lists</h1>
        <p className="mb-6 text-muted-foreground">
          Sign in to create and manage ranked lists.
        </p>
        <Button onClick={signIn}>Sign In</Button>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Ranked Lists | BBPC Admin</title>
      </Head>
      <div className="container mx-auto space-y-8 p-6">
        <div>
          <h1 className="flex items-center gap-3 text-4xl font-black tracking-tight">
            Ranked Lists
            <Badge className="text-xs uppercase tracking-widest" variant="outline">
              Beta
            </Badge>
          </h1>
          <p className="mt-1 text-muted-foreground">
            Manage personal rankings with owner-derived Convex authorization.
          </p>
        </div>

        {loadFailed ? (
          <Card className="p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Ranked lists could not be loaded. No legacy SQL fallback was
              attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </Card>
        ) : (
          <Tabs defaultValue="my-lists">
            <div className="mb-6 flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="my-lists">
                  <ListTodo className="mr-2 h-4 w-4" />
                  My Lists
                </TabsTrigger>
                {isAdmin && (
                  <TabsTrigger value="all-lists">
                    <ListTodo className="mr-2 h-4 w-4" />
                    All Lists
                  </TabsTrigger>
                )}
              </TabsList>
              {isAdmin && (
                <Button asChild size="sm" variant="outline">
                  <Link href="/admin/ranked-types">
                    <Settings2 className="mr-2 h-4 w-4" />
                    Manage Types
                  </Link>
                </Button>
              )}
            </div>

            <TabsContent className="space-y-8" value="my-lists">
              <section>
                <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Start a New List
                </h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {types === null &&
                    [1, 2, 3].map((value) => (
                      <div
                        className="h-32 animate-pulse rounded-lg bg-muted"
                        key={value}
                      />
                    ))}
                  {types?.map((type) => (
                    <Card className="border-dashed" key={type.id}>
                      <CardHeader>
                        <CardTitle className="text-lg">{type.name}</CardTitle>
                        <CardDescription className="line-clamp-2">
                          {type.description ?? "No description"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">
                            {type.targetType}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Max {type.maxItems}
                          </span>
                        </div>
                        <Button
                          disabled={pendingTypeId !== null}
                          onClick={() => createList(type.id)}
                          size="sm"
                        >
                          {pendingTypeId === type.id ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Plus className="mr-2 h-4 w-4" />
                          )}
                          Create
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>

              <section className="space-y-4">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Your Rankings
                </h2>
                {myLists === null ? (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {[1, 2, 3].map((value) => (
                      <div
                        className="h-48 animate-pulse rounded-lg bg-muted"
                        key={value}
                      />
                    ))}
                  </div>
                ) : myLists.length === 0 ? (
                  <Card className="border-dashed bg-muted/30 py-12 text-center text-muted-foreground">
                    You have not created any lists yet.
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {myLists.map((list) => (
                      <RankedListCard
                        canDelete
                        key={list.id}
                        list={list}
                        onDelete={setDeletingList}
                      />
                    ))}
                  </div>
                )}
              </section>
            </TabsContent>

            {isAdmin && (
              <TabsContent className="space-y-4" value="all-lists">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  All Ranked Lists
                </h2>
                {allLists === null ? (
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                ) : allLists.length === 0 ? (
                  <Card className="border-dashed bg-muted/30 py-12 text-center text-muted-foreground">
                    No ranked lists have been created.
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {allLists.map((list) => (
                      <RankedListCard
                        canDelete
                        key={list.id}
                        list={list}
                        onDelete={setDeletingList}
                      />
                    ))}
                  </div>
                )}
                {!adminDone && (
                  <div className="flex justify-center">
                    <Button
                      disabled={isLoadingMore}
                      onClick={loadMoreAdmin}
                      variant="outline"
                    >
                      {isLoadingMore && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Load More
                    </Button>
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>

      <ConfirmModal
        description={`Delete “${
          deletingList?.title ?? deletingList?.type.name ?? ""
        }” and all of its ranked items?`}
        isOpen={deletingList !== null}
        onClose={() => {
          if (!isDeleting) {
            setDeletingList(null);
          }
        }}
        onConfirm={deleteList}
        title="Delete Ranked List"
      />
    </>
  );
}
