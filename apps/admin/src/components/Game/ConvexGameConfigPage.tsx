import { useConvex } from "convex/react";
import {
  Coins,
  Edit2,
  Gamepad2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Head from "next/head";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexAdminGamblingType,
  type ConvexAdminGamblingTypeInput,
  type ConvexAdminGameCatalog,
  type ConvexAdminGamePointType,
  type ConvexAdminGamePointTypeInput,
  type ConvexAdminGameType,
  type ConvexAdminGameTypeInput,
  createConvexAdminGamblingType,
  createConvexAdminGamePointType,
  createConvexAdminGameType,
  deleteConvexAdminGamblingType,
  deleteConvexAdminGamePointType,
  deleteConvexAdminGameType,
  loadConvexAdminGameCatalog,
  updateConvexAdminGamblingType,
  updateConvexAdminGamePointType,
  updateConvexAdminGameType,
} from "@/convex/gameConfig";
import { getConvexDomainErrorCode } from "@/convex/identity";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";

type DeleteTarget =
  | { kind: "game"; item: ConvexAdminGameType }
  | { kind: "point"; item: ConvexAdminGamePointType }
  | { kind: "gambling"; item: ConvexAdminGamblingType };

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "That lookup ID is already in use, or this item is still referenced.";
    case "VALIDATION_FAILED":
      return "Check the title, lookup ID, and numeric values.";
    case "WRITE_DISABLED":
      return "Game configuration changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The game configuration change could not be saved.";
  }
}

function GameTypeEditor({
  editingItem,
  isSaving,
  onClose,
  onSave,
}: {
  editingItem: ConvexAdminGameType | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminGameTypeInput) => void;
}) {
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [lookupId, setLookupId] = useState(editingItem?.lookupId ?? "");
  const [description, setDescription] = useState(
    editingItem?.description ?? ""
  );
  const [showErrors, setShowErrors] = useState(false);
  const isValid = title.trim().length > 0 && lookupId.trim().length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {editingItem === null ? "Add Game Type" : "Edit Game Type"}
          </DialogTitle>
          <DialogDescription>
            Lookup IDs are stable keys used by scoring workflows.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-game-type-title">Title</Label>
            <Input
              aria-invalid={showErrors && title.trim().length === 0}
              id="convex-game-type-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-game-type-lookup">Lookup ID</Label>
            <Input
              aria-invalid={showErrors && lookupId.trim().length === 0}
              id="convex-game-type-lookup"
              onChange={(event) => setLookupId(event.target.value)}
              value={lookupId}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-game-type-description">
              Description (Optional)
            </Label>
            <Textarea
              id="convex-game-type-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>
          {showErrors && !isValid && (
            <p className="text-xs text-destructive">
              A title and lookup ID are required.
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
                  lookupId: lookupId.trim(),
                  description: nullableText(description),
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Game Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PointTypeEditor({
  editingItem,
  gameTypes,
  isSaving,
  onClose,
  onSave,
}: {
  editingItem: ConvexAdminGamePointType | null;
  gameTypes: ConvexAdminGameType[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminGamePointTypeInput) => void;
}) {
  const [gameTypeId, setGameTypeId] = useState(
    editingItem?.gameType.id ?? gameTypes[0]?.id ?? ""
  );
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [lookupId, setLookupId] = useState(editingItem?.lookupId ?? "");
  const [description, setDescription] = useState(
    editingItem?.description ?? ""
  );
  const [points, setPoints] = useState(
    editingItem === null ? "0" : String(editingItem.points)
  );
  const [showErrors, setShowErrors] = useState(false);
  const parsedPoints = Number(points);
  const isValid =
    gameTypeId.length > 0 &&
    title.trim().length > 0 &&
    lookupId.trim().length > 0 &&
    Number.isSafeInteger(parsedPoints) &&
    parsedPoints >= -32_768 &&
    parsedPoints <= 32_767;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {editingItem === null ? "Add Point Type" : "Edit Point Type"}
          </DialogTitle>
          <DialogDescription>
            Point values must remain within the migrated SQL SMALLINT range.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-point-type-game">Game Type</Label>
            <Select onValueChange={setGameTypeId} value={gameTypeId}>
              <SelectTrigger id="convex-point-type-game">
                <SelectValue placeholder="Select a game type" />
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
          <div className="grid gap-2">
            <Label htmlFor="convex-point-type-title">Title</Label>
            <Input
              id="convex-point-type-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-point-type-lookup">Lookup ID</Label>
            <Input
              id="convex-point-type-lookup"
              onChange={(event) => setLookupId(event.target.value)}
              value={lookupId}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-point-type-points">Points</Label>
            <Input
              id="convex-point-type-points"
              max={32_767}
              min={-32_768}
              onChange={(event) => setPoints(event.target.value)}
              step={1}
              type="number"
              value={points}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-point-type-description">
              Description (Optional)
            </Label>
            <Textarea
              id="convex-point-type-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>
          {showErrors && !isValid && (
            <p className="text-xs text-destructive">
              Select a game type, provide a title and lookup ID, and use an
              integer point value from -32768 through 32767.
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
                  gameTypeId,
                  title: title.trim(),
                  lookupId: lookupId.trim(),
                  description: nullableText(description),
                  points: parsedPoints,
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Point Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GamblingTypeEditor({
  editingItem,
  isSaving,
  onClose,
  onSave,
}: {
  editingItem: ConvexAdminGamblingType | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminGamblingTypeInput) => void;
}) {
  const [title, setTitle] = useState(editingItem?.title ?? "");
  const [lookupId, setLookupId] = useState(editingItem?.lookupId ?? "");
  const [description, setDescription] = useState(
    editingItem?.description ?? ""
  );
  const [multiplier, setMultiplier] = useState(
    editingItem === null ? "1.5" : String(editingItem.multiplier)
  );
  const [isActive, setIsActive] = useState(editingItem?.isActive ?? true);
  const [showErrors, setShowErrors] = useState(false);
  const parsedMultiplier = Number(multiplier);
  const isValid =
    title.trim().length > 0 &&
    lookupId.trim().length > 0 &&
    Number.isFinite(parsedMultiplier) &&
    parsedMultiplier >= 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {editingItem === null
              ? "Add Gambling Type"
              : "Edit Gambling Type"}
          </DialogTitle>
          <DialogDescription>
            Inactive wager types remain available for historical records.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-gambling-type-title">Title</Label>
            <Input
              id="convex-gambling-type-title"
              onChange={(event) => setTitle(event.target.value)}
              value={title}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-gambling-type-lookup">Lookup ID</Label>
            <Input
              id="convex-gambling-type-lookup"
              onChange={(event) => setLookupId(event.target.value)}
              value={lookupId}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-gambling-type-multiplier">
              Multiplier
            </Label>
            <Input
              id="convex-gambling-type-multiplier"
              min={0}
              onChange={(event) => setMultiplier(event.target.value)}
              step="0.1"
              type="number"
              value={multiplier}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-gambling-type-description">
              Description (Optional)
            </Label>
            <Textarea
              id="convex-gambling-type-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isActive}
              id="convex-gambling-type-active"
              onCheckedChange={(checked) => setIsActive(checked === true)}
            />
            <Label htmlFor="convex-gambling-type-active">Active</Label>
          </div>
          {showErrors && !isValid && (
            <p className="text-xs text-destructive">
              A title and lookup ID are required, and the multiplier must be a
              finite non-negative number.
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
                  lookupId: lookupId.trim(),
                  description: nullableText(description),
                  multiplier: parsedMultiplier,
                  isActive,
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Gambling Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyRow({
  colSpan,
  label,
}: {
  colSpan: number;
  label: string;
}) {
  return (
    <TableRow>
      <TableCell className="h-24 text-center" colSpan={colSpan}>
        {label}
      </TableCell>
    </TableRow>
  );
}

export function ConvexGameConfigPage({
  defaultTab = "game-types",
}: {
  defaultTab?: "game-types" | "point-types" | "gambling-types";
}) {
  const convex = useConvex();
  const [catalog, setCatalog] = useState<ConvexAdminGameCatalog | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editingGameType, setEditingGameType] = useState<
    ConvexAdminGameType | null | undefined
  >(undefined);
  const [editingPointType, setEditingPointType] = useState<
    ConvexAdminGamePointType | null | undefined
  >(undefined);
  const [editingGamblingType, setEditingGamblingType] = useState<
    ConvexAdminGamblingType | null | undefined
  >(undefined);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void loadConvexAdminGameCatalog(convex)
      .then((result) => {
        if (active) {
          setCatalog(result);
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
    setCatalog(null);
    setRevision((value) => value + 1);
  };

  const completeMutation = (message: string) => {
    toast.success(message);
    setEditingGameType(undefined);
    setEditingPointType(undefined);
    setEditingGamblingType(undefined);
    refresh();
  };

  const failMutation = (error: unknown) => {
    toast.error(mutationFailureMessage(error));
  };

  const saveGameType = (input: ConvexAdminGameTypeInput) => {
    const item = editingGameType;
    if (item === undefined) {
      return;
    }
    setPendingAction(item?.id ?? "create-game");
    void (item === null
      ? createConvexAdminGameType(convex, input)
      : updateConvexAdminGameType(convex, item.id, input))
      .then(() =>
        completeMutation(
          item === null ? "Game type created." : "Game type updated."
        )
      )
      .catch(failMutation)
      .finally(() => setPendingAction(null));
  };

  const savePointType = (input: ConvexAdminGamePointTypeInput) => {
    const item = editingPointType;
    if (item === undefined) {
      return;
    }
    setPendingAction(item?.id ?? "create-point");
    void (item === null
      ? createConvexAdminGamePointType(convex, input)
      : updateConvexAdminGamePointType(convex, item.id, input))
      .then(() =>
        completeMutation(
          item === null ? "Point type created." : "Point type updated."
        )
      )
      .catch(failMutation)
      .finally(() => setPendingAction(null));
  };

  const saveGamblingType = (input: ConvexAdminGamblingTypeInput) => {
    const item = editingGamblingType;
    if (item === undefined) {
      return;
    }
    setPendingAction(item?.id ?? "create-gambling");
    void (item === null
      ? createConvexAdminGamblingType(convex, input)
      : updateConvexAdminGamblingType(convex, item.id, input))
      .then(() =>
        completeMutation(
          item === null
            ? "Gambling type created."
            : "Gambling type updated."
        )
      )
      .catch(failMutation)
      .finally(() => setPendingAction(null));
  };

  const deleteItem = (target: DeleteTarget) => {
    setPendingAction(target.item.id);
    const mutation =
      target.kind === "game"
        ? deleteConvexAdminGameType(convex, target.item.id)
        : target.kind === "point"
          ? deleteConvexAdminGamePointType(convex, target.item.id)
          : deleteConvexAdminGamblingType(convex, target.item.id);
    void mutation
      .then(() => {
        toast.success("Configuration item deleted.");
        refresh();
      })
      .catch(failMutation)
      .finally(() => setPendingAction(null));
  };

  return (
    <>
      <Head>
        <title>Game Mechanics - BBPC Admin</title>
      </Head>
      {editingGameType !== undefined && (
        <GameTypeEditor
          editingItem={editingGameType}
          isSaving={pendingAction !== null}
          onClose={() => setEditingGameType(undefined)}
          onSave={saveGameType}
        />
      )}
      {editingPointType !== undefined && catalog !== null && (
        <PointTypeEditor
          editingItem={editingPointType}
          gameTypes={catalog.gameTypes}
          isSaving={pendingAction !== null}
          onClose={() => setEditingPointType(undefined)}
          onSave={savePointType}
        />
      )}
      {editingGamblingType !== undefined && (
        <GamblingTypeEditor
          editingItem={editingGamblingType}
          isSaving={pendingAction !== null}
          onClose={() => setEditingGamblingType(undefined)}
          onSave={saveGamblingType}
        />
      )}
      <ConfirmModal
        confirmText="Delete item"
        description={
          deleteTarget === null
            ? ""
            : `Delete “${deleteTarget.item.title}”? Convex will reject the deletion if any migrated record still references it.`
        }
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget !== null) {
            deleteItem(deleteTarget);
          }
        }}
        title="Delete configuration item"
      />

      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Game Mechanics</h2>
          <p className="text-muted-foreground">
            Configure the bounded scoring and wagering catalogs.
          </p>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Game configuration could not be loaded. No legacy SQL fallback
              was attempted.
            </p>
            <Button onClick={refresh} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : catalog === null ? (
          <div className="rounded-md border bg-card p-16 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs className="w-full" defaultValue={defaultTab}>
            <TabsList className="grid w-full max-w-lg grid-cols-3">
              <TabsTrigger value="game-types">Game Types</TabsTrigger>
              <TabsTrigger value="point-types">Point Types</TabsTrigger>
              <TabsTrigger value="gambling-types">
                Gambling Types
              </TabsTrigger>
            </TabsList>

            <TabsContent className="mt-6" value="game-types">
              <div className="mb-4 flex justify-end">
                <Button onClick={() => setEditingGameType(null)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Game Type
                </Button>
              </div>
              <div className="rounded-md border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Lookup ID</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {catalog.gameTypes.length === 0 && (
                      <EmptyRow colSpan={4} label="No game types found." />
                    )}
                    {catalog.gameTypes.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <Gamepad2 className="h-4 w-4 text-indigo-500" />
                            {item.title}
                          </span>
                        </TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1">
                            {item.lookupId}
                          </code>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {item.description ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            aria-label={`Edit ${item.title}`}
                            disabled={pendingAction !== null}
                            onClick={() => setEditingGameType(item)}
                            size="icon"
                            variant="ghost"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`Delete ${item.title}`}
                            disabled={pendingAction !== null}
                            onClick={() =>
                              setDeleteTarget({ kind: "game", item })
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

            <TabsContent className="mt-6" value="point-types">
              <div className="mb-4 flex justify-end">
                <Button
                  disabled={catalog.gameTypes.length === 0}
                  onClick={() => setEditingPointType(null)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Point Type
                </Button>
              </div>
              <div className="rounded-md border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Game Type</TableHead>
                      <TableHead>Lookup ID</TableHead>
                      <TableHead>Points</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {catalog.pointTypes.length === 0 && (
                      <EmptyRow colSpan={5} label="No point types found." />
                    )}
                    {catalog.pointTypes.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <Coins className="h-4 w-4 text-amber-500" />
                            {item.title}
                          </span>
                        </TableCell>
                        <TableCell>{item.gameType.title}</TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1">
                            {item.lookupId}
                          </code>
                        </TableCell>
                        <TableCell className="font-semibold">
                          {item.points > 0 ? `+${item.points}` : item.points}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            aria-label={`Edit ${item.title}`}
                            disabled={pendingAction !== null}
                            onClick={() => setEditingPointType(item)}
                            size="icon"
                            variant="ghost"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`Delete ${item.title}`}
                            disabled={pendingAction !== null}
                            onClick={() =>
                              setDeleteTarget({ kind: "point", item })
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

            <TabsContent className="mt-6" value="gambling-types">
              <div className="mb-4 flex justify-end">
                <Button onClick={() => setEditingGamblingType(null)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Gambling Type
                </Button>
              </div>
              <div className="rounded-md border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Lookup ID</TableHead>
                      <TableHead>Multiplier</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {catalog.gamblingTypes.length === 0 && (
                      <EmptyRow
                        colSpan={5}
                        label="No gambling types found."
                      />
                    )}
                    {catalog.gamblingTypes.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            <Coins className="h-4 w-4 text-emerald-500" />
                            {item.title}
                          </span>
                        </TableCell>
                        <TableCell>
                          <code className="rounded bg-muted px-1">
                            {item.lookupId}
                          </code>
                        </TableCell>
                        <TableCell>{item.multiplier}x</TableCell>
                        <TableCell>
                          <Badge
                            variant={item.isActive ? "default" : "secondary"}
                          >
                            {item.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            aria-label={`Edit ${item.title}`}
                            disabled={pendingAction !== null}
                            onClick={() => setEditingGamblingType(item)}
                            size="icon"
                            variant="ghost"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label={`Delete ${item.title}`}
                            disabled={pendingAction !== null}
                            onClick={() =>
                              setDeleteTarget({ kind: "gambling", item })
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
          </Tabs>
        )}
      </div>
    </>
  );
}
