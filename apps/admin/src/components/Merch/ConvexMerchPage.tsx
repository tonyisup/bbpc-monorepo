import { useConvex } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  ImageOff,
  Loader2,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import Head from "next/head";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { getConvexDomainErrorCode } from "@/convex/identity";
import {
  type ConvexAdminMerchItem,
  type ConvexAdminMerchItemInput,
  type ConvexMerchMoveDirection,
  createConvexAdminMerchItem,
  deleteConvexAdminMerchItem,
  loadConvexAdminMerchItems,
  MERCH_BADGE_MAX_LENGTH,
  MERCH_DESCRIPTION_MAX_LENGTH,
  MERCH_ITEM_LIMIT,
  MERCH_PRICE_LABEL_MAX_LENGTH,
  MERCH_TITLE_MAX_LENGTH,
  MERCH_URL_MAX_LENGTH,
  moveConvexAdminMerchItem,
  setConvexAdminMerchItemVisible,
  updateConvexAdminMerchItem,
} from "@/convex/merch";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Textarea } from "../ui/textarea";

const STORE_URL = "https://www.teepublic.com/user/badboyspodcast";
const SHOP_PAGE_URL = "https://badboyspodcast.com/merch";

const PREVIEW_IMAGE_DELAY_MS = 400;

// The server stores trimmed NFC text, so measure the same string here.
function cleanText(value: string): string {
  return value.trim().normalize("NFC");
}

function nullableText(value: string): string | null {
  const cleaned = cleanText(value);
  return cleaned.length === 0 ? null : cleaned;
}

function isHttpsUrl(value: string): boolean {
  return isHttpUrl(value) && value.startsWith("https://");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Matches the listener card's link label in apps/web/src/lib/merch.ts.
function getMerchLinkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "teepublic.com" || host.endsWith(".teepublic.com")
      ? "View on TeePublic"
      : `View on ${host}`;
  } catch {
    return "View product";
  }
}

function mutationFailureMessage(error: unknown): string {
  switch (getConvexDomainErrorCode(error)) {
    case "CONFLICT":
      return `The shop can hold ${MERCH_ITEM_LIMIT} items. Delete one first.`;
    case "NOT_FOUND":
      return "That item no longer exists.";
    case "VALIDATION_FAILED":
      return "Check the title, links and text lengths.";
    case "WRITE_DISABLED":
      return "Merch changes are paused in this environment.";
    case "STALE_CLIENT":
      return "This admin client is out of date. Refresh before trying again.";
    default:
      return "The merch change could not be completed.";
  }
}

// The title is always shown beside the thumbnail, so the image is decorative.
// Callers key it by URL, so a new URL starts without the failed state.
function MerchThumbnail({
  imageUrl,
  className,
}: {
  imageUrl: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted",
        className
      )}
    >
      {imageUrl !== null && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className="h-full w-full object-cover"
          decoding="async"
          loading="lazy"
          onError={() => setFailed(true)}
          src={imageUrl}
        />
      ) : (
        <ImageOff aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
      )}
    </div>
  );
}

// Mirrors the listener shop card so the admin sees what listeners will see.
function MerchPreview({
  title,
  description,
  url,
  imageUrl,
  priceLabel,
  badge,
  featured,
}: Omit<ConvexAdminMerchItemInput, "visible">) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 text-zinc-100">
      <div className="relative">
        <MerchThumbnail
          className="aspect-square w-full rounded-none border-0 bg-zinc-900"
          imageUrl={imageUrl}
          key={imageUrl}
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {featured && (
            <span className="rounded bg-red-500 px-2 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.08em] text-white shadow">
              Featured
            </span>
          )}
          {badge !== null && (
            <span className="rounded bg-white px-2 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.08em] text-zinc-900 shadow">
              {badge}
            </span>
          )}
        </div>
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-bold">
            {title.trim().length === 0 ? (
              <span className="text-zinc-500">Item title</span>
            ) : (
              title.trim()
            )}
          </p>
          {priceLabel !== null && (
            <span className="whitespace-nowrap text-sm font-semibold text-white">
              {priceLabel}
            </span>
          )}
        </div>
        {description !== null && (
          <p className="line-clamp-3 text-sm text-zinc-400">{description}</p>
        )}
        <p className="pt-1 text-sm font-semibold text-red-300">
          {getMerchLinkLabel(url)} ↗
        </p>
      </div>
    </div>
  );
}

function CountedLabel({
  htmlFor,
  label,
  length,
  max,
}: {
  htmlFor: string;
  label: string;
  length: number;
  max: number;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <Label htmlFor={htmlFor}>{label}</Label>
      <span
        className={cn(
          "text-xs text-muted-foreground",
          length > max && "text-destructive"
        )}
      >
        {length}/{max}
      </span>
    </div>
  );
}

function MerchEditor({
  editing,
  isSaving,
  onClose,
  onSave,
}: {
  editing: ConvexAdminMerchItem | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ConvexAdminMerchItemInput) => void;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [url, setUrl] = useState(editing?.url ?? "");
  const [imageUrl, setImageUrl] = useState(editing?.imageUrl ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [priceLabel, setPriceLabel] = useState(editing?.priceLabel ?? "");
  const [badge, setBadge] = useState(editing?.badge ?? "");
  const [featured, setFeatured] = useState(editing?.featured ?? false);
  const [visible, setVisible] = useState(editing?.visible ?? true);
  const [showErrors, setShowErrors] = useState(false);

  const trimmedTitle = cleanText(title);
  const productUrl = url.trim();
  const image = nullableText(imageUrl);
  // Waits for typing to pause so partial URLs don't each fetch an image.
  const [previewImage, setPreviewImage] = useState(
    image !== null && isHttpsUrl(image) ? image : null
  );
  useEffect(() => {
    const timer = setTimeout(
      () => setPreviewImage(image !== null && isHttpsUrl(image) ? image : null),
      PREVIEW_IMAGE_DELAY_MS
    );
    return () => clearTimeout(timer);
  }, [image]);
  const text = nullableText(description);
  const price = nullableText(priceLabel);
  const badgeText = nullableText(badge);
  const errors = [
    trimmedTitle.length === 0 && "A title is required.",
    trimmedTitle.length > MERCH_TITLE_MAX_LENGTH &&
      `The title must be ${MERCH_TITLE_MAX_LENGTH} characters or fewer.`,
    !isHttpUrl(productUrl) &&
      "The product link must start with http:// or https://.",
    productUrl.length > MERCH_URL_MAX_LENGTH &&
      `The product link must be ${MERCH_URL_MAX_LENGTH} characters or fewer.`,
    image !== null &&
      !isHttpsUrl(image) &&
      "The image link must start with https://.",
    image !== null &&
      image.length > MERCH_URL_MAX_LENGTH &&
      `The image link must be ${MERCH_URL_MAX_LENGTH} characters or fewer.`,
    text !== null &&
      text.length > MERCH_DESCRIPTION_MAX_LENGTH &&
      `The description must be ${MERCH_DESCRIPTION_MAX_LENGTH} characters or fewer.`,
    price !== null &&
      price.length > MERCH_PRICE_LABEL_MAX_LENGTH &&
      `The price label must be ${MERCH_PRICE_LABEL_MAX_LENGTH} characters or fewer.`,
    badgeText !== null &&
      badgeText.length > MERCH_BADGE_MAX_LENGTH &&
      `The badge must be ${MERCH_BADGE_MAX_LENGTH} characters or fewer.`,
  ].filter((error): error is string => typeof error === "string");

  return (
    <Dialog open onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>
            {editing === null ? "New Merch Item" : "Edit Merch Item"}
          </DialogTitle>
          <DialogDescription>
            A card on the listener shop page that links out to the product.
            On TeePublic, copy the product page address and right-click the
            product photo to copy its image address.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-2 sm:grid-cols-[minmax(0,1fr)_240px]">
          <div className="grid content-start gap-4">
            <div className="grid gap-2">
              <CountedLabel
                htmlFor="convex-merch-title"
                label="Title"
                length={trimmedTitle.length}
                max={MERCH_TITLE_MAX_LENGTH}
              />
              <Input
                id="convex-merch-title"
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Bad Boys Logo Tee"
                value={title}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convex-merch-url">Product Link</Label>
              <Input
                id="convex-merch-url"
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.teepublic.com/t-shirt/..."
                type="url"
                value={url}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="convex-merch-image">Image Link (Optional)</Label>
              <Input
                id="convex-merch-image"
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://images.teepublic.com/..."
                type="url"
                value={imageUrl}
              />
            </div>
            <div className="grid gap-2">
              <CountedLabel
                htmlFor="convex-merch-description"
                label="Description (Optional)"
                length={text?.length ?? 0}
                max={MERCH_DESCRIPTION_MAX_LENGTH}
              />
              <Textarea
                id="convex-merch-description"
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                value={description}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="convex-merch-price">Price Label (Optional)</Label>
                <Input
                  id="convex-merch-price"
                  onChange={(event) => setPriceLabel(event.target.value)}
                  placeholder="From $22"
                  value={priceLabel}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="convex-merch-badge">Badge (Optional)</Label>
                <Input
                  id="convex-merch-badge"
                  onChange={(event) => setBadge(event.target.value)}
                  placeholder="New"
                  value={badge}
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={featured}
                id="convex-merch-featured"
                onCheckedChange={(checked) => setFeatured(checked === true)}
              />
              <Label htmlFor="convex-merch-featured">
                Feature this item (the first featured item leads the shop)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                checked={visible}
                id="convex-merch-visible"
                onCheckedChange={(checked) => setVisible(checked === true)}
              />
              <Label htmlFor="convex-merch-visible">
                Show on the listener site
              </Label>
            </div>
          </div>
          <div className="grid content-start gap-2">
            <span className="text-sm font-medium">Preview</span>
            <MerchPreview
              badge={badgeText}
              description={text}
              featured={featured}
              url={productUrl}
              imageUrl={previewImage}
              priceLabel={price}
              title={title}
            />
            {featured && (
              <p className="text-xs text-muted-foreground">
                If this is the first featured item, it shows as the large card
                at the top of the shop instead.
              </p>
            )}
          </div>
        </div>
        {showErrors && errors.length > 0 && (
          <ul className="list-inside list-disc text-xs text-destructive">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button disabled={isSaving} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => {
              setShowErrors(true);
              if (errors.length === 0) {
                onSave({
                  title: trimmedTitle,
                  description: text,
                  url: productUrl,
                  imageUrl: image,
                  priceLabel: price,
                  badge: badgeText,
                  featured,
                  visible,
                });
              }
            }}
          >
            {isSaving ? "Saving..." : "Save Item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvexMerchPage() {
  const convex = useConvex();
  const [items, setItems] = useState<ConvexAdminMerchItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [editing, setEditing] = useState<
    ConvexAdminMerchItem | null | undefined
  >(undefined);
  const [deleteTarget, setDeleteTarget] =
    useState<ConvexAdminMerchItem | null>(null);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void loadConvexAdminMerchItems(convex)
      .then((result) => {
        if (active) {
          setItems(result);
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

  // Reloads in place, so the rows stay visible after a save or delete.
  const refresh = () => {
    setRevision((value) => value + 1);
  };

  const retryLoad = () => {
    setItems(null);
    refresh();
  };

  const save = (input: ConvexAdminMerchItemInput) => {
    const current = editing;
    if (current === undefined) {
      return;
    }
    setPendingAction(current?.id ?? "create-merch-item");
    void (current === null
      ? createConvexAdminMerchItem(convex, input)
      : updateConvexAdminMerchItem(convex, current.id, input))
      .then(() => {
        toast.success(current === null ? "Item added." : "Item updated.");
        setEditing((open) => (open === current ? undefined : open));
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  const toggleVisible = (item: ConvexAdminMerchItem) => {
    setPendingAction(item.id);
    void setConvexAdminMerchItemVisible(convex, item.id, !item.visible)
      .then((updated) => {
        setItems(
          (current) =>
            current?.map((row) => (row.id === updated.id ? updated : row)) ??
            null
        );
        toast.success(updated.visible ? "Item shown." : "Item hidden.");
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  const move = (
    item: ConvexAdminMerchItem,
    direction: ConvexMerchMoveDirection
  ) => {
    setPendingAction(item.id);
    void moveConvexAdminMerchItem(convex, item.id, direction)
      .then(setItems)
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  const remove = (item: ConvexAdminMerchItem) => {
    setPendingAction(item.id);
    void deleteConvexAdminMerchItem(convex, item.id)
      .then(() => {
        toast.success("Item deleted.");
        refresh();
      })
      .catch((error: unknown) => {
        toast.error(mutationFailureMessage(error));
      })
      .finally(() => setPendingAction(null));
  };

  const atCapacity = items !== null && items.length >= MERCH_ITEM_LIMIT;

  return (
    <>
      <Head>
        <title>Merch - BBPC Admin</title>
      </Head>
      {editing !== undefined && (
        <MerchEditor
          editing={editing}
          isSaving={pendingAction !== null}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      )}
      <ConfirmModal
        confirmText="Delete"
        description={
          deleteTarget === null
            ? ""
            : `Delete “${deleteTarget.title}” from the shop page? To keep it for later, hide it instead.`
        }
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget !== null) {
            remove(deleteTarget);
          }
        }}
        title="Delete merch item"
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Merch</h2>
            <p className="text-muted-foreground">
              Items on the listener shop page, in the order shown. Every card
              links out to its product; the full catalog stays on TeePublic.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={SHOP_PAGE_URL} rel="noreferrer" target="_blank">
                <ExternalLink className="mr-2 h-4 w-4" />
                Shop page
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={STORE_URL} rel="noreferrer" target="_blank">
                <ExternalLink className="mr-2 h-4 w-4" />
                TeePublic store
              </a>
            </Button>
            <Button disabled={atCapacity} onClick={() => setEditing(null)}>
              <Plus className="mr-2 h-4 w-4" />
              New Item
            </Button>
          </div>
        </div>
        {atCapacity && (
          <p className="-mt-3 text-sm text-muted-foreground">
            The shop holds {MERCH_ITEM_LIMIT} items. Delete one to add another,
            or edit an existing item instead.
          </p>
        )}

        {loadFailed ? (
          <div className="rounded-md border bg-card p-8 text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              Merch could not be loaded. Try again.
            </p>
            <Button onClick={retryLoad} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : items === null ? (
          <div className="rounded-md border bg-card p-16 text-center">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-md border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Order</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell className="h-24 text-center" colSpan={4}>
                      No items yet. Until you add some, the shop page shows a
                      single link to the TeePublic store.
                    </TableCell>
                  </TableRow>
                )}
                {items.map((item, index) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex">
                        <Button
                          aria-label={`Move ${item.title} up`}
                          disabled={pendingAction !== null || index === 0}
                          onClick={() => move(item, "up")}
                          size="icon"
                          title="Move up"
                          variant="ghost"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          aria-label={`Move ${item.title} down`}
                          disabled={
                            pendingAction !== null ||
                            index === items.length - 1
                          }
                          onClick={() => move(item, "down")}
                          size="icon"
                          title="Move down"
                          variant="ghost"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn("max-w-md", !item.visible && "opacity-60")}
                    >
                      <div className="flex items-center gap-3">
                        <MerchThumbnail
                          className="h-12 w-12"
                          imageUrl={item.imageUrl}
                          key={item.imageUrl}
                        />
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">
                            {item.title}
                            {item.priceLabel !== null && (
                              <span className="ml-2 text-xs font-normal text-muted-foreground">
                                {item.priceLabel}
                              </span>
                            )}
                          </p>
                          <a
                            className="block truncate text-xs text-muted-foreground underline"
                            href={isHttpUrl(item.url) ? item.url : undefined}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {item.url}
                          </a>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.visible ? (
                          <Badge className="bg-green-600 hover:bg-green-600">
                            Visible
                          </Badge>
                        ) : (
                          <Badge variant="outline">Hidden</Badge>
                        )}
                        {item.featured && (
                          <Badge variant="secondary">
                            <Star className="mr-1 h-3 w-3" />
                            Featured
                          </Badge>
                        )}
                        {item.badge !== null && (
                          <Badge variant="outline">{item.badge}</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <Button
                        aria-label={
                          item.visible
                            ? `Hide ${item.title}`
                            : `Show ${item.title}`
                        }
                        disabled={pendingAction !== null}
                        onClick={() => toggleVisible(item)}
                        size="icon"
                        title={item.visible ? "Hide" : "Show"}
                        variant="ghost"
                      >
                        {item.visible ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        aria-label={`Edit ${item.title}`}
                        disabled={pendingAction !== null}
                        onClick={() => setEditing(item)}
                        size="icon"
                        title="Edit"
                        variant="ghost"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        aria-label={`Delete ${item.title}`}
                        disabled={pendingAction !== null}
                        onClick={() => setDeleteTarget(item)}
                        size="icon"
                        title="Delete"
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
