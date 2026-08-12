import { useConvex } from "convex/react";
import { Edit2, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import Head from "next/head";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexAdminRating,
  type ConvexAdminRatingInput,
  createConvexAdminRating,
  deleteConvexAdminRating,
  loadConvexAdminRatings,
  updateConvexAdminRating,
} from "@/convex/ratings";

import RatingIcon from "../Review/RatingIcon";
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

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return "This rating is still referenced by a review or guess.";
    case "VALIDATION_FAILED":
      return "Use a name and an integer value from 0 through 255.";
    case "WRITE_DISABLED":
      return "Rating changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The rating change could not be saved.";
  }
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function RatingEditor({
  editingRating,
  isSaving,
  onClose,
  onSave,
}: {
  editingRating: ConvexAdminRating | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminRatingInput) => void;
}) {
  const [name, setName] = useState(editingRating?.name ?? "");
  const [value, setValue] = useState(
    editingRating === null ? "0" : String(editingRating.value)
  );
  const [sound, setSound] = useState(editingRating?.sound ?? "");
  const [icon, setIcon] = useState(editingRating?.icon ?? "");
  const [category, setCategory] = useState(editingRating?.category ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const parsedValue = Number(value);
  const isValid =
    name.trim().length > 0 &&
    Number.isSafeInteger(parsedValue) &&
    parsedValue >= 0 &&
    parsedValue <= 255;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {editingRating === null ? "Add New Rating" : "Edit Rating"}
          </DialogTitle>
          <DialogDescription>
            Referenced ratings cannot be deleted, but their presentation can be
            updated.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="convex-rating-name">Name</Label>
            <Input
              aria-invalid={showErrors && name.trim().length === 0}
              id="convex-rating-name"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-rating-value">Value (integer, 0–255)</Label>
            <Input
              aria-invalid={showErrors && !isValid}
              id="convex-rating-value"
              max={255}
              min={0}
              onChange={(event) => setValue(event.target.value)}
              step={1}
              type="number"
              value={value}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-rating-category">Category (Optional)</Label>
            <Input
              id="convex-rating-category"
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-rating-icon">Icon (Optional)</Label>
            <Input
              id="convex-rating-icon"
              onChange={(event) => setIcon(event.target.value)}
              value={icon}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="convex-rating-sound">Sound URL (Optional)</Label>
            <Input
              id="convex-rating-sound"
              onChange={(event) => setSound(event.target.value)}
              value={sound}
            />
          </div>
          {showErrors && !isValid && (
            <p className="text-xs text-destructive">
              A name and an integer value from 0 through 255 are required.
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
                  value: parsedValue,
                  sound: nullableText(sound),
                  icon: nullableText(icon),
                  category: nullableText(category),
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Rating"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvexRatingsPage() {
  const convex = useConvex();
  const [ratings, setRatings] = useState<ConvexAdminRating[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [editingRating, setEditingRating] = useState<
    ConvexAdminRating | null | undefined
  >(undefined);
  const [deletingRating, setDeletingRating] =
    useState<ConvexAdminRating | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void loadConvexAdminRatings(convex)
      .then((result) => {
        if (active) {
          setRatings(result);
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
    setRatings(null);
    setRevision((value) => value + 1);
  };

  const saveRating = (input: ConvexAdminRatingInput) => {
    const currentRating = editingRating;
    if (currentRating === undefined) {
      return;
    }
    setPendingAction(currentRating?.id ?? "create");
    void (
      currentRating === null
        ? createConvexAdminRating(convex, input)
        : updateConvexAdminRating(convex, currentRating.id, input)
    )
      .then(() => {
        toast.success(
          currentRating === null ? "Rating created." : "Rating updated."
        );
        setEditingRating(undefined);
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  const deleteRating = (rating: ConvexAdminRating) => {
    setPendingAction(rating.id);
    void deleteConvexAdminRating(convex, rating.id)
      .then(() => {
        toast.success("Rating deleted.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  return (
    <>
      <Head>
        <title>Ratings - BBPC Admin</title>
      </Head>
      {editingRating !== undefined && (
        <RatingEditor
          editingRating={editingRating}
          isSaving={pendingAction !== null}
          onClose={() => setEditingRating(undefined)}
          onSave={saveRating}
        />
      )}
      <ConfirmModal
        confirmText="Delete rating"
        description={
          deletingRating === null
            ? ""
            : `Delete “${deletingRating.name}”? Referenced ratings are rejected safely.`
        }
        isOpen={deletingRating !== null}
        onClose={() => setDeletingRating(null)}
        onConfirm={() => {
          if (deletingRating !== null) {
            deleteRating(deletingRating);
          }
        }}
        title="Delete rating"
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Ratings</h2>
            <p className="text-muted-foreground">
              Manage the bounded movie and show rating catalog.
            </p>
          </div>
          <Button onClick={() => setEditingRating(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Rating
          </Button>
        </div>

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Ratings could not be loaded. No legacy SQL fallback was attempted.
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
                  <TableHead className="w-[100px]">Value</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Icon/Sound</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ratings === null && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )}
                {ratings?.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={5}>
                      No ratings found.
                    </TableCell>
                  </TableRow>
                )}
                {ratings?.map((rating) => (
                  <TableRow className="group" key={rating.id}>
                    <TableCell className="text-lg font-bold">
                      <div className="flex items-center gap-2">
                        <span>{rating.value}</span>
                        <RatingIcon value={rating.value} />
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{rating.name}</TableCell>
                    <TableCell>{rating.category ?? "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>{rating.icon ? "Icon: yes" : "Icon: no"}</span>
                        <span>{rating.sound ? "Sound: yes" : "Sound: no"}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          aria-label={`Edit ${rating.name}`}
                          disabled={pendingAction !== null}
                          onClick={() => setEditingRating(rating)}
                          size="icon"
                          variant="ghost"
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          aria-label={`Delete ${rating.name}`}
                          disabled={pendingAction !== null}
                          onClick={() => setDeletingRating(rating)}
                          size="icon"
                          variant="ghost"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
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
