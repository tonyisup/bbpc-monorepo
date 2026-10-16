import { ArrowUpRight } from "lucide-react";

import { MerchImage } from "@/components/MerchImage";
import { getMerchLinkLabel, type MerchItem } from "@/lib/merch";

// The spotlight's placement already says "featured", so it shows the badge only.
function MerchPills({
  item,
  showFeatured = true,
}: {
  item: MerchItem;
  showFeatured?: boolean;
}) {
  const featured = showFeatured && item.featured;
  if (!featured && item.badge === null) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
      {featured && (
        <span className="rounded bg-red-500 px-2 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.08em] text-white shadow">
          Featured
        </span>
      )}
      {item.badge !== null && (
        <span className="rounded bg-white px-2 py-1 text-[10px] font-bold uppercase leading-none tracking-[0.08em] text-zinc-900 shadow">
          {item.badge}
        </span>
      )}
    </div>
  );
}

export function MerchItemCard({ item }: { item: MerchItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bbpc-panel group flex h-full flex-col overflow-hidden transition-colors hover:border-red-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    >
      <div className="relative">
        <MerchImage
          imageUrl={item.imageUrl}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          className="aspect-square w-full"
        />
        <MerchPills item={item} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-bold leading-snug text-white">{item.title}</h3>
          {item.priceLabel !== null && (
            <span className="whitespace-nowrap text-sm font-semibold text-white">
              {item.priceLabel}
            </span>
          )}
        </div>
        {item.description !== null && (
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-400">
            {item.description}
          </p>
        )}
        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-red-300 transition-colors group-hover:text-red-200">
          {getMerchLinkLabel(item.url)}
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </span>
      </div>
    </a>
  );
}

export function MerchSpotlight({ item }: { item: MerchItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bbpc-panel group block overflow-hidden shadow-2xl shadow-red-950/40 transition-colors hover:border-red-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
    >
      <div className="relative">
        <MerchImage
          imageUrl={item.imageUrl}
          sizes="(max-width: 768px) 100vw, 40vw"
          priority
          className="aspect-[4/3] w-full"
        />
        <MerchPills item={item} showFeatured={false} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 p-5">
        <div className="min-w-0">
          <p className="text-xl font-black tracking-tight text-white">
            {item.title}
          </p>
          {item.description !== null && (
            <p className="mt-1 text-sm leading-relaxed text-zinc-400">
              {item.description}
            </p>
          )}
        </div>
        <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-red-300 transition-colors group-hover:text-red-200">
          {item.priceLabel !== null && (
            <span className="mr-2 text-white">{item.priceLabel}</span>
          )}
          {getMerchLinkLabel(item.url)}
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </span>
      </div>
    </a>
  );
}
