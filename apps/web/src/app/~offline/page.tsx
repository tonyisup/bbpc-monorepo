import type { Metadata } from "next";

import { RetryButton } from "./RetryButton";

export const metadata: Metadata = {
  title: "Offline | Bad Boys Podcast",
  robots: { index: false },
};

/**
 * The service worker serves this page when a listener opens a page with no
 * connection and no cached copy of it (see `fallbacks` in next.config.mjs).
 */
export default function OfflinePage() {
  return (
    <div className="container flex min-h-[50vh] flex-col items-center justify-center p-4 text-center">
      <h1 className="text-2xl font-bold">You&apos;re offline</h1>
      <p className="mt-3 max-w-sm text-zinc-300">
        This page needs a connection. Pages you&apos;ve already opened may
        still work.
      </p>
      <RetryButton />
    </div>
  );
}
