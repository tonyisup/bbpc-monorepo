import { api } from "@tonyisup/bbpc-convex-api";
import "server-only";

import { z } from "zod";

import type { MerchItem } from "@/lib/merch";

import { fetchPublicQuery } from "./client";

const merchItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  imageUrl: z.string().nullable(),
  priceLabel: z.string().nullable(),
  badge: z.string().nullable(),
  featured: z.boolean(),
});

const listVisibleReference = api.merch.public.listVisible;

function hasProtocol(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// The backend validates links on write, but rows can also arrive by import or
// dashboard edit. Never render a non-web link or a non-https image.
export async function listVisibleMerchItems(): Promise<MerchItem[]> {
  const items = z
    .array(merchItemSchema)
    .parse(await fetchPublicQuery(listVisibleReference, {}));
  return items
    .filter((item) => hasProtocol(item.url, ["http:", "https:"]))
    .map((item) =>
      item.imageUrl === null || hasProtocol(item.imageUrl, ["https:"])
        ? item
        : { ...item, imageUrl: null }
    );
}
