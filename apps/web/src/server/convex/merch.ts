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

export async function listVisibleMerchItems(): Promise<MerchItem[]> {
  return z
    .array(merchItemSchema)
    .parse(await fetchPublicQuery(listVisibleReference, {}));
}
