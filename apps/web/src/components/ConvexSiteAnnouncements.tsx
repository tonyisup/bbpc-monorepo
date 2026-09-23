"use client";

import { useQuery } from "convex/react";
import { AlertTriangle, Info, X } from "lucide-react";
import { Component, type ReactNode, useEffect, useState } from "react";

import {
  type ConvexLiveAnnouncement,
  getAnnouncementClockNow,
  getNextAnnouncementClockDelay,
  liveAnnouncementsReference,
  parseLiveAnnouncements,
} from "@/convex/announcements";
import { cn } from "@/lib/utils";

const DISMISSED_STORAGE_KEY = "bbpc.dismissedAnnouncements";

// Maps an announcement ID to the version the listener dismissed, so an edited
// announcement shows again.
type DismissedAnnouncements = Record<string, number>;

function readDismissed(): DismissedAnnouncements {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(DISMISSED_STORAGE_KEY) ?? "{}"
    );
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number"
      )
    );
  } catch {
    return {};
  }
}

function writeDismissed(dismissed: DismissedAnnouncements) {
  try {
    window.localStorage.setItem(
      DISMISSED_STORAGE_KEY,
      JSON.stringify(dismissed)
    );
  } catch {
    // Dismissal still applies for this page view.
  }
}

function useAnnouncementClock(): number {
  const [now, setNow] = useState(() => getAnnouncementClockNow(Date.now()));
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setNow(getAnnouncementClockNow(Date.now()));
        schedule();
      }, getNextAnnouncementClockDelay(Date.now()));
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin;
  } catch {
    return false;
  }
}

function AnnouncementBanner({
  announcement,
  onDismiss,
}: {
  announcement: ConvexLiveAnnouncement;
  onDismiss: () => void;
}) {
  const isWarning = announcement.severity === "warning";
  const Icon = isWarning ? AlertTriangle : Info;
  const opensNewTab =
    announcement.linkUrl !== null && !isSameOrigin(announcement.linkUrl);

  return (
    <section
      aria-label={isWarning ? "Site warning" : "Site announcement"}
      className={cn(
        "w-full border-b px-4 py-2.5",
        isWarning
          ? "border-amber-400/30 bg-amber-400/10 text-amber-50"
          : "border-sky-400/30 bg-sky-400/10 text-sky-50"
      )}
      role={isWarning ? "alert" : "status"}
    >
      <div className="mx-auto flex w-full max-w-7xl items-start gap-3">
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            isWarning ? "text-amber-300" : "text-sky-300"
          )}
        />
        <p className="min-w-0 flex-1 break-words text-sm">
          {announcement.message}
          {announcement.linkUrl !== null && (
            <a
              className="ml-2 whitespace-nowrap font-semibold underline underline-offset-2 hover:no-underline"
              href={announcement.linkUrl}
              {...(opensNewTab
                ? { rel: "noopener noreferrer", target: "_blank" }
                : {})}
            >
              {announcement.linkLabel ?? "Learn more"}
            </a>
          )}
        </p>
        {announcement.dismissible && (
          <button
            aria-label="Dismiss announcement"
            className="-m-1 shrink-0 rounded p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            onClick={onDismiss}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
    </section>
  );
}

function LiveAnnouncements() {
  const now = useAnnouncementClock();
  const result: unknown = useQuery(liveAnnouncementsReference, { now });
  const [dismissed, setDismissed] = useState<DismissedAnnouncements | null>(
    null
  );

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  if (result === undefined || dismissed === null) {
    return null;
  }

  // The query runs at minute precision; hide an announcement ended mid-minute
  // (for example with "End now") as soon as its update arrives.
  const renderedAt = Date.now();
  const visible = parseLiveAnnouncements(result).filter(
    (announcement) =>
      announcement.endsAt > renderedAt &&
      dismissed[announcement.id] !== announcement.updatedAt
  );
  if (visible.length === 0) {
    return null;
  }

  const dismiss = (announcement: ConvexLiveAnnouncement) => {
    const liveIds = new Set(
      parseLiveAnnouncements(result).map((item) => item.id)
    );
    const next = Object.fromEntries(
      Object.entries(dismissed).filter(([id]) => liveIds.has(id))
    );
    next[announcement.id] = announcement.updatedAt;
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <div className="w-full">
      {visible.map((announcement) => (
        <AnnouncementBanner
          announcement={announcement}
          key={announcement.id}
          onDismiss={() => dismiss(announcement)}
        />
      ))}
    </div>
  );
}

// A banner failure (for example, a backend without announcements yet) must never
// take down the page around it.
class AnnouncementErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function ConvexSiteAnnouncements() {
  return (
    <AnnouncementErrorBoundary>
      <LiveAnnouncements />
    </AnnouncementErrorBoundary>
  );
}
