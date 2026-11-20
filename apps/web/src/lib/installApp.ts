/**
 * How this browser can put BBPC on the home screen:
 * - `installed`: already running as the installed app.
 * - `prompt`: the browser offered an install prompt we can open from a button.
 * - `ios`: iPhone or iPad, installed by hand from the Share sheet.
 * - `android`: Android without a prompt (Firefox, or Chrome after a dismissal),
 *   installed by hand from the browser menu.
 * - `other`: anything else, usually a desktop browser.
 */
export type InstallMode = "installed" | "prompt" | "ios" | "android" | "other";

export interface InstallEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  isStandalone: boolean;
  canPrompt: boolean;
}

export function isIosDevice(userAgent: string, maxTouchPoints: number) {
  // iPadOS reports itself as a Mac; touch support gives it away.
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
  );
}

export function getInstallMode({
  userAgent,
  maxTouchPoints,
  isStandalone,
  canPrompt,
}: InstallEnvironment): InstallMode {
  if (isStandalone) return "installed";
  if (canPrompt) return "prompt";
  if (isIosDevice(userAgent, maxTouchPoints)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}
