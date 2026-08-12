import { useConvex } from "convex/react";
import {
  Edit2,
  ListOrdered,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Head from "next/head";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexAdminRankingTargetType,
  type ConvexAdminRankingType,
  type ConvexAdminRankingTypeInput,
  createConvexAdminRankingType,
  deleteConvexAdminRankingType,
  loadConvexAdminRankingTypes,
  updateConvexAdminRankingType,
} from "@/convex/rankingTypes";

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

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "This type is referenced, at capacity, or cannot change without invalidating existing lists.";
    case "VALIDATION_FAILED":
      return "Use a name and an item capacity from 1 through 100.";
    case "WRITE_DISABLED":
      return "Ranking-type changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The ranking-type change could not be completed.";
  }
}

function RankingTypeEditor({
  editingType,
  isSaving,
  onClose,
  onSave,
}: {
  editingType: ConvexAdminRankingType | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminRankingTypeInput) => void;
}) {
  const [name, setName] = useState(editingType?.name ?? "");
  const [description, setDescription] = useState(
    editingType?.description ?? ""
  );
  const [maxItems, setMaxItems] = useState(
    editingType === null ? "10" : String(editingType.maxItems)
  );
  const [targetType, setTargetType] =
    useState<ConvexAdminRankingTargetType>(
      editingType?.targetType ?? "MOVIE"
    );
  const [showErrors, setShowErrors] = useState(false);
  const parsedMaxItems = Number(maxItems);
  const isValid =
    name.trim().length > 0 &&
    Number.isSafeInteger(parsedMaxItems) &&
    parsedMaxItems >= 1 &&
    parsedMaxItems <= 100;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {editingType === null
              ? "Create Ranking Type"
              : "Edit Ranking Type"}
          </DialogTitle>
          <DialogDescription>
            Target and capacity changes are rejected if they would invalidate an
            existing ranked list.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-ranking-type-name">Name</Label>
            <Input
              id="convex-ranking-type-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-ranking-type-description">
              Description (Optional)
            </Label>
            <Textarea
              id="convex-ranking-type-description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="convex-ranking-type-target">Target Type</Label>
              <Select
                onValueChange={(value) =>
                  setTargetType(value as ConvexAdminRankingTargetType)
                }
                value={targetType}
              >
                <SelectTrigger id="convex-ranking-type-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MOVIE">Movie</SelectItem>
                  <SelectItem value="SHOW">TV Show</SelectItem>
                  <SelectItem value="EPISODE">Episode</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convex-ranking-type-capacity">
                Max Items
              </Label>
              <Input
                id="convex-ranking-type-capacity"
                max={100}
                min={1}
                onChange={(event) => setMaxItems(event.target.value)}
                step={1}
                type="number"
                value={maxItems}
              />
            </div>
          </div>
          {showErrors && !isValid && (
            <p className="text-xs text-destructive">
              A name and integer capacity from 1 through 100 are required.
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
                  maxItems: parsedMaxItems,
                  targetType,
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Ranking Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvexRankingTypesPage() {
  const convex = useConvex();
  const [types, setTypes] = useState<ConvexAdminRankingType[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editingType, setEditingType] = useState<
    ConvexAdminRankingType | null | undefined
  >(undefined);
  const [deletingType, setDeletingType] =
    useState<ConvexAdminRankingType | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void loadConvexAdminRankingTypes(convex)
      .then((result) => {
        if (active) {
          setTypes(result);
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
    setTypes(null);
    setRevision((value) => value + 1);
  };

  const saveType = (input: ConvexAdminRankingTypeInput) => {
    const current = editingType;
    if (current === undefined) {
      return;
    }
    setPendingAction(current?.id ?? "create");
    void (current === null
      ? createConvexAdminRankingType(convex, input)
      : updateConvexAdminRankingType(convex, current.id, input))
      .then(() => {
        toast.success(
          current === null ? "Ranking type created." : "Ranking type updated."
        );
        setEditingType(undefined);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  const deleteType = (type: ConvexAdminRankingType) => {
    setPendingAction(type.id);
    void deleteConvexAdminRankingType(convex, type.id)
      .then(() => {
        toast.success("Ranking type deleted.");
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
        <title>Ranked List Types - BBPC Admin</title>
      </Head>
      {editingType !== undefined && (
        <RankingTypeEditor
          editingType={editingType}
          isSaving={pendingAction !== null}
          onClose={() => setEditingType(undefined)}
          onSave={saveType}
        />
      )}
      <ConfirmModal
        confirmText="Delete ranking type"
        description={
          deletingType === null
            ? ""
            : `Delete “${deletingType.name}”? Convex rejects deletion while any ranked list references this type.`
        }
        isOpen={deletingType !== null}
        onClose={() => setDeletingType(null)}
        onConfirm={() => {
          if (deletingType !== null) {
            deleteType(deletingType);
          }
        }}
        title="Delete ranking type"
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              Ranked List Types
            </h2>
            <p className="text-muted-foreground">
              Configure the bounded ranked-list templates.
            </p>
          </div>
          <Button onClick={() => setEditingType(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Type
          </Button>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Ranking types could not be loaded. No legacy SQL fallback was
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
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Max Items</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {types === null && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {types?.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      No ranking types found.
                    </TableCell>
                  </TableRow>
                )}
                {types?.map((type) => (
                  <TableRow key={type.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <ListOrdered className="h-4 w-4 text-primary" />
                        {type.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {type.description ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{type.targetType}</Badge>
                    </TableCell>
                    <TableCell>{type.maxItems}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        aria-label={`Edit ${type.name}`}
                        disabled={pendingAction !== null}
                        onClick={() => setEditingType(type)}
                        size="icon"
                        variant="ghost"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        aria-label={`Delete ${type.name}`}
                        disabled={pendingAction !== null}
                        onClick={() => setDeletingType(type)}
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
        )}
      </div>
    </>
  );
}
