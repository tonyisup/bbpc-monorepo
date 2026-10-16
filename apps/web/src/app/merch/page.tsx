import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { MerchItemCard, MerchSpotlight } from "@/components/MerchItemCard";
import { MERCH_STORE_URL, splitMerchItems, type MerchItem } from "@/lib/merch";
import { listVisibleMerchItems } from "@/server/convex/merch";

// Admin edits reach the page within about five minutes.
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Merch | BBPC",
  description:
    "Shirts, hoodies, mugs, and stickers from the Bad Boys Podcast, printed and shipped by TeePublic.",
  alternates: { canonical: "/merch" },
};

// Convex fetches with `cache: "no-store"`, which would otherwise make Next
// render this page on every request. The cache scope keeps it static.
const listCachedMerchItems = unstable_cache(
  listVisibleMerchItems,
  ["merch-visible-items"],
  { revalidate }
);

async function loadItems(): Promise<MerchItem[]> {
  try {
    return await listCachedMerchItems();
  } catch (error) {
    // Next signals rendering decisions by throwing; never swallow those.
    unstable_rethrow(error);
    // The store link alone still makes a working page.
    console.error("Merch items could not be loaded.", error);
    return [];
  }
}

function StoreLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={MERCH_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg bg-red-500 px-5 font-semibold text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
    >
      {children}
      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">(opens TeePublic in a new tab)</span>
    </Link>
  );
}

export default async function MerchPage() {
  const items = await loadItems();
  const { spotlight, rest } = splitMerchItems(items);

  return (
    <div className="bbpc-page max-w-6xl space-y-14">
      <section className="grid items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]">
        <div className="max-w-xl">
          <p className="bbpc-kicker">Merch</p>
          <h1 className="mt-1 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Wear the bad takes.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-zinc-300">
            Shirts, hoodies, mugs, and stickers for anyone who has ever paused a
            movie to argue about it.
          </p>
          <p className="mt-3 leading-relaxed text-zinc-400">
            Everything is printed on demand and shipped by TeePublic, so pick a
            design and put it on whatever you like.
          </p>
          <div className="mt-7">
            <StoreLink>Shop the full store</StoreLink>
          </div>
        </div>

        {spotlight !== null ? (
          <MerchSpotlight item={spotlight} />
        ) : (
          <figure
            aria-hidden="true"
            className="bbpc-panel relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-950 to-red-950/50"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgb(239_68_68/0.25),transparent_55%)]" />
            <Image
              src="/logo-short.png"
              alt=""
              width={1357}
              height={574}
              priority
              className="relative h-auto w-3/4"
              sizes="(max-width: 768px) 75vw, 30vw"
            />
          </figure>
        )}
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="merch-items-heading">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2
              id="merch-items-heading"
              className="text-3xl font-black tracking-tight text-white"
            >
              In the shop
            </h2>
            <p className="text-sm text-zinc-400">
              Each item opens in a new tab.
            </p>
          </div>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rest.map((item) => (
              <li key={item.id}>
                <MerchItemCard item={item} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {items.length > 0 && (
        <aside className="bbpc-panel flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-xl font-bold text-white">
              Want it on something else?
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-400">
              Most designs come on shirts, hoodies, mugs, stickers, phone cases,
              and more. Orders, shipping, and returns are handled by TeePublic.
            </p>
          </div>
          <StoreLink>Browse every design</StoreLink>
        </aside>
      )}
    </div>
  );
}
