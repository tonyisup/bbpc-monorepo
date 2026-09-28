import { useRouter } from "next/router";
import { useEffect } from "react";

const RESTORE_TIMEOUT_MS = 1000;

/**
 * While `dirty`, asks before unsaved work is lost to a reload, a closed tab, or
 * the browser's Back or Forward. Those move within the app as client-side route
 * changes that never fire beforeunload, so they are caught with Next's
 * beforePopState.
 */
export function useUnsavedChangesPrompt(dirty: boolean, message: string) {
  const router = useRouter();

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers show their prompt only when a return value is set.
      event.returnValue = "";
    };
    // This page's place in history, from the Navigation API where the browser
    // has it, so a refused move of any size or direction is undone exactly.
    const navigation = (
      window as { navigation?: { currentEntry?: { index: number } | null } }
    ).navigation;
    const home = navigation?.currentEntry?.index;
    // Set while undoing a refused move, whose own pop must be ignored too.
    let restoring = false;
    let restoreTimeout: number | undefined;
    window.addEventListener("beforeunload", onBeforeUnload);
    router.beforePopState(() => {
      if (restoring) {
        restoring = false;
        window.clearTimeout(restoreTimeout);
        return false;
      }
      if (window.confirm(message)) return true;
      // The browser has already moved; go back to this page. Without the
      // Navigation API, assume the usual single Back.
      const now = navigation?.currentEntry?.index;
      const delta = home !== undefined && now !== undefined ? home - now : 1;
      if (delta !== 0) {
        restoring = true;
        window.history.go(delta);
        // If that pop never arrives, don't swallow the next real one.
        restoreTimeout = window.setTimeout(() => {
          restoring = false;
        }, RESTORE_TIMEOUT_MS);
      }
      return false;
    });
    return () => {
      window.clearTimeout(restoreTimeout);
      window.removeEventListener("beforeunload", onBeforeUnload);
      router.beforePopState(() => true);
    };
  }, [dirty, message, router]);
}
