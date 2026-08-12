import Image from "next/image";
import Link from "next/link";

import LeaveMessage from "@/components/LeaveMessage";
import NavMenu from "@/components/NavMenu";

export function SiteHeader() {
  return (
    <header className="bg-[color:var(--bbpc-bg)]/95 sticky top-0 z-40 w-full border-b border-white/10 backdrop-blur">
      <div className="mx-auto grid h-16 w-full max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-2 px-3 sm:px-6">
        <Link
          href="/"
          className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          aria-label="Bad Boys Podcast home"
        >
          <Image
            src="/logo-short.png"
            alt="Bad Boys Podcast"
            width={136}
            height={58}
            priority
            className="h-9 w-auto sm:h-10"
          />
        </Link>
        <div className="flex min-w-0 justify-center">
          <NavMenu />
        </div>
        <LeaveMessage />
      </div>
    </header>
  );
}
