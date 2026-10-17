"use client";

import { useState } from "react";
import Image from "next/image";
import { ShirtIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The product photo, or a branded placeholder when there is none or it fails
 * to load. The title is always shown beside it, so the image is decorative.
 */
export function MerchImage({
  imageUrl,
  sizes,
  priority = false,
  className,
}: {
  imageUrl: string | null;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = imageUrl !== null && failedUrl !== imageUrl;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden bg-gradient-to-br from-zinc-800 via-zinc-900 to-red-950/60",
        className
      )}
    >
      {showImage ? (
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes={sizes}
          priority={priority}
          unoptimized
          onError={() => setFailedUrl(imageUrl)}
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ShirtIcon className="h-1/3 w-1/3 text-white/10" strokeWidth={1.25} />
        </div>
      )}
    </div>
  );
}
