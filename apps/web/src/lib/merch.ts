export const MERCH_STORE_URL = "https://www.teepublic.com/user/badboyspodcast";

export interface MerchItem {
  id: string;
  title: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  priceLabel: string | null;
  badge: string | null;
  featured: boolean;
}

/** Names the shop a product link leaves for, so the button says where it goes. */
export function getMerchLinkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "teepublic.com" || host.endsWith(".teepublic.com")
      ? "View on TeePublic"
      : `View on ${host}`;
  } catch {
    return "View product";
  }
}

/**
 * The first featured item leads the page; every other item, including any
 * further featured ones, fills the grid in the order admin set.
 */
export function splitMerchItems(items: MerchItem[]): {
  spotlight: MerchItem | null;
  rest: MerchItem[];
} {
  const spotlight = items.find((item) => item.featured) ?? null;
  return {
    spotlight,
    rest: items.filter((item) => item !== spotlight),
  };
}
