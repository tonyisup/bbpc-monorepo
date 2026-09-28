import { useRouter } from "next/router";
import { useEffect } from "react";

/**
 * While `dirty`, asks before unsaved work is lost to a reload, a closed tab, or
 * the browser's Back button. Back inside the app is a client-side route change
 * that never fires beforeunload, so it is caught with Next's beforePopState.
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
    // Set while undoing a refused Back, whose own pop must be ignored too.
    let restoring = false;
    window.addEventListener("beforeunload", onBeforeUnload);
    router.beforePopState(() => {
      if (restoring) {
        restoring = false;
        return false;
      }
      if (window.confirm(message)) return true;
      // The browser has already moved back; step forward to this page again.
      restoring = true;
      window.history.go(1);
      return false;
    });
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      router.beforePopState(() => true);
    };
  }, [dirty, message, router]);
}
