"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

const HISTORY_KEY = "bbpcFullScreenDialog";
// Next keeps custom history state across a reload or tab restore, so an entry
// only counts as ours if this page load pushed it; stepping back over one from
// an earlier load would reload the page and lose the form.
const PAGE_LOAD_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

function ownsHistoryEntry() {
  return (
    (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY] ===
    PAGE_LOAD_ID
  );
}

/**
 * A full-viewport dialog for focused tools. It adds a same-URL history entry
 * while open so the phone back gesture closes the tool instead of the page.
 */
export function FullScreenDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  // Opened from state rather than a Radix Trigger, so restore focus ourselves.
  const returnFocus = useRef<HTMLElement | null>(null);
  // Deferred so a Strict Mode remount keeps the entry instead of popping it.
  const pendingBack = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (pendingBack.current !== null) {
      window.clearTimeout(pendingBack.current);
      pendingBack.current = null;
    } else if (!ownsHistoryEntry()) {
      window.history.pushState({ [HISTORY_KEY]: PAGE_LOAD_ID }, "");
    }
    const onPopState = () => {
      if (!ownsHistoryEntry()) onOpenChangeRef.current(false);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Closed by the parent or unmounted (say the round locked while open):
      // drop our entry too, or the next back press would appear to do nothing.
      pendingBack.current = window.setTimeout(() => {
        pendingBack.current = null;
        if (ownsHistoryEntry()) window.history.back();
      }, 0);
    };
  }, [open]);

  // Done and Escape step back over our entry; the popstate above then closes.
  const requestOpenChange = (next: boolean) => {
    if (!next && ownsHistoryEntry()) window.history.back();
    else onOpenChange(next);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={requestOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col bg-background text-foreground focus:outline-none"
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-base font-semibold">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button type="button" size="sm" className="shrink-0">
                Done
              </Button>
            </DialogPrimitive.Close>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-3xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
              {children}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
