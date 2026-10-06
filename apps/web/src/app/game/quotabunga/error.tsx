"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function QuotabungaArchiveError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="bbpc-page space-y-6">
      <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
        Quotabunga
      </h1>
      <div className="bbpc-panel px-6 py-10 text-center" role="alert">
        <h2 className="text-lg font-bold text-white">
          The Quotabunga rounds could not load
        </h2>
        <p className="mx-auto mt-1.5 max-w-[44ch] text-zinc-400">
          Nothing is lost. Try again in a moment.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
          <Button onClick={reset} className="h-11 px-4 font-bold">
            Try again
          </Button>
          <Link
            href="/game"
            className="rounded font-semibold text-white underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Back to the game
          </Link>
        </div>
      </div>
    </div>
  );
}
