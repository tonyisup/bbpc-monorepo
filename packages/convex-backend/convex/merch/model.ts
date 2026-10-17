import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { validateHttpUrl } from "../episodes/adminWriteModel.js";
import { domainError } from "../lib/errors.js";

export const MAX_MERCH_TITLE_LENGTH = 80;
export const MAX_MERCH_DESCRIPTION_LENGTH = 200;
export const MAX_MERCH_PRICE_LABEL_LENGTH = 24;
export const MAX_MERCH_BADGE_LENGTH = 20;
// Bounds every read: the shop page shows the whole curated list at once.
export const MAX_MERCH_ITEMS = 48;

export interface MerchItemInput {
  title: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  priceLabel: string | null;
  badge: string | null;
  featured: boolean;
  visible: boolean;
}

export type MerchItemFields = Pick<
  Doc<"merchItems">,
  | "title"
  | "description"
  | "url"
  | "imageUrl"
  | "priceLabel"
  | "badge"
  | "featured"
  | "visible"
>;

function validateText(
  value: string,
  label: string,
  maxLength: number,
): string {
  // NFC, not NFKC: shop copy keeps characters such as ™ and … as written.
  const text = value.trim().normalize("NFC");
  if (text.length < 1 || text.length > maxLength) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(maxLength)} characters.`,
    );
  }
  return text;
}

// Blank optional text clears the field rather than failing validation.
function validateOptionalText(
  value: string | null,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }
  return validateText(value, label, maxLength);
}

// Listeners load images on an https page, so plain http would be mixed content.
function validateHttpsImageUrl(value: string): string {
  const url = validateHttpUrl(value, "The image URL");
  if (!url.startsWith("https://")) {
    domainError("VALIDATION_FAILED", "The image URL must use https.");
  }
  return url;
}

export function validateMerchItemInput(
  input: MerchItemInput,
): MerchItemFields {
  const description = validateOptionalText(
    input.description,
    "The description",
    MAX_MERCH_DESCRIPTION_LENGTH,
  );
  const imageUrl =
    input.imageUrl === null || input.imageUrl.trim().length === 0
      ? undefined
      : validateHttpsImageUrl(input.imageUrl);
  const priceLabel = validateOptionalText(
    input.priceLabel,
    "The price label",
    MAX_MERCH_PRICE_LABEL_LENGTH,
  );
  const badge = validateOptionalText(
    input.badge,
    "The badge",
    MAX_MERCH_BADGE_LENGTH,
  );
  return {
    title: validateText(input.title, "The title", MAX_MERCH_TITLE_LENGTH),
    ...(description === undefined ? {} : { description }),
    url: validateHttpUrl(input.url, "The product URL"),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    ...(priceLabel === undefined ? {} : { priceLabel }),
    ...(badge === undefined ? {} : { badge }),
    featured: input.featured,
    visible: input.visible,
  };
}

export async function requireMerchItem(
  ctx: Pick<QueryCtx, "db">,
  id: Id<"merchItems">,
): Promise<Doc<"merchItems">> {
  const item = await ctx.db.get("merchItems", id);
  if (item === null) {
    domainError("NOT_FOUND", "The merch item was not found.");
  }
  return item;
}

// Every item, in shop order. The cap keeps this a complete list.
export async function listMerchItemsInOrder(
  ctx: Pick<QueryCtx, "db">,
): Promise<Array<Doc<"merchItems">>> {
  return await ctx.db
    .query("merchItems")
    .withIndex("by_sortOrder")
    .take(MAX_MERCH_ITEMS);
}

export async function nextMerchSortOrder(
  ctx: Pick<QueryCtx, "db">,
): Promise<number> {
  const existing = await ctx.db
    .query("merchItems")
    .withIndex("by_sortOrder")
    .take(MAX_MERCH_ITEMS + 1);
  if (existing.length >= MAX_MERCH_ITEMS) {
    domainError(
      "CONFLICT",
      "The shop already has the most items it can show. Delete one first.",
      { details: { limit: MAX_MERCH_ITEMS } },
    );
  }
  const last = existing.at(-1);
  return last === undefined ? 0 : last.sortOrder + 1;
}

export function toPublicMerchItem(item: Doc<"merchItems">) {
  return {
    id: item._id,
    title: item.title,
    description: item.description ?? null,
    url: item.url,
    imageUrl: item.imageUrl ?? null,
    priceLabel: item.priceLabel ?? null,
    badge: item.badge ?? null,
    featured: item.featured,
    updatedAt: item.updatedAt,
  };
}

export function toAdminMerchItem(item: Doc<"merchItems">) {
  return {
    ...toPublicMerchItem(item),
    visible: item.visible,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
  };
}
