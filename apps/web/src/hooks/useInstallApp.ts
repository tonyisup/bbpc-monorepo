"use client";

import { useCallback, useSyncExternalStore } from "react";

import { getInstallMode, type InstallMode } from "@/lib/installApp";

/** Chromium's install prompt event; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// The browser fires `beforeinstallprompt` once per page load, possibly before
// any component that wants it has mounted, so listen from module load. The
// event is kept but not cancelled, so the browser's own install UI still shows.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedThisVisit = false;
const subscribers = new Set<() => void>();

function notify() {
  for (const subscriber of subscribers) subscriber();
}

if (typeof window !== "undefined" && "addEventListener" in window) {
  window.addEventListener("beforeinstallprompt", (event) => {
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedThisVisit = true;
    notify();
  });
}

type IosNavigator = Navigator & { standalone?: boolean };

function isStandalone() {
  return (
    installedThisVisit ||
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari reports a home-screen launch here instead.
    (window.navigator as IosNavigator | undefined)?.standalone === true
  );
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function getSnapshot(): InstallMode {
  return getInstallMode({
    userAgent: window.navigator?.userAgent ?? "",
    maxTouchPoints: window.navigator?.maxTouchPoints ?? 0,
    isStandalone: isStandalone(),
    canPrompt: deferredPrompt !== null,
  });
}

/** Unknown until hydration, since the server can't see the device. */
function getServerSnapshot(): InstallMode | null {
  return null;
}

export function useInstallApp() {
  const mode = useSyncExternalStore<InstallMode | null>(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  /** Opens the browser's install prompt; resolves true if the listener accepted. */
  const promptInstall = useCallback(async () => {
    const event = deferredPrompt;
    if (event === null) return false;
    // A prompt event can only be used once.
    deferredPrompt = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    notify();
    return outcome === "accepted";
  }, []);

  return { mode, promptInstall };
}
