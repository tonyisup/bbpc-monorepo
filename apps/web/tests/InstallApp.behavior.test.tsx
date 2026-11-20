import { readFileSync, existsSync } from "node:fs";
import type { ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import { getInstallMode } from "@/lib/installApp";

// The hook listens for the install prompt when its module loads, so one fake
// window is in place before InstallAppGuide is imported; tests change its
// device fields instead of replacing it.
const device = vi.hoisted(() => ({ userAgent: "", standalone: false }));
const fakeWindow = vi.hoisted(() => {
  const target = new EventTarget();
  return Object.assign(target, {
    navigator: {
      get userAgent() {
        return device.userAgent;
      },
      maxTouchPoints: 0,
    },
    matchMedia: (query: string) => ({
      matches: device.standalone && query === "(display-mode: standalone)",
    }),
  });
});
vi.hoisted(() => {
  (globalThis as { window?: unknown }).window = fakeWindow;
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID_FIREFOX =
  "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

describe("getInstallMode", () => {
  const base = { maxTouchPoints: 0, isStandalone: false, canPrompt: false };

  test("an installed app wins over everything else", () => {
    expect(
      getInstallMode({
        ...base,
        userAgent: IPHONE,
        isStandalone: true,
        canPrompt: true,
      })
    ).toBe("installed");
  });

  test("a browser install prompt wins over manual steps", () => {
    expect(
      getInstallMode({ ...base, userAgent: DESKTOP_CHROME, canPrompt: true })
    ).toBe("prompt");
  });

  test("recognizes iPhones and iPads that report themselves as a Mac", () => {
    expect(getInstallMode({ ...base, userAgent: IPHONE })).toBe("ios");
    expect(
      getInstallMode({ ...base, userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })
    ).toBe("ios");
    expect(getInstallMode({ ...base, userAgent: IPAD_AS_MAC })).toBe("other");
  });

  test("falls back to manual steps on Android and nothing on desktop", () => {
    expect(getInstallMode({ ...base, userAgent: ANDROID_FIREFOX })).toBe(
      "android"
    );
    expect(getInstallMode({ ...base, userAgent: DESKTOP_CHROME })).toBe(
      "other"
    );
  });
});

function text(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  return node.children.map(text).join("");
}

function setDevice(userAgent: string, standalone = false) {
  device.userAgent = userAgent;
  device.standalone = standalone;
}

let renderer: ReactTestRenderer | null = null;

async function renderGuide(): Promise<ReactTestRenderer> {
  const { InstallAppGuide } = await import("@/components/InstallAppGuide");
  await act(async () => {
    renderer = create(<InstallAppGuide />);
  });
  if (renderer === null) throw new Error("InstallAppGuide did not render.");
  return renderer;
}

describe("InstallAppGuide", () => {
  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
  });

  test("shows only the iPhone steps on an iPhone", async () => {
    setDevice(IPHONE);
    const rendered = await renderGuide();
    const page = text(rendered.root);
    expect(page).toContain("Add to Home Screen");
    expect(page).toContain("sign in once more");
    expect(page).not.toContain("Install app");
  });

  test("says so instead of giving steps inside the installed app", async () => {
    setDevice(IPHONE, true);
    const rendered = await renderGuide();
    expect(text(rendered.root)).toContain("You're using the BBPC app");
    expect(text(rendered.root)).not.toContain("Add to Home Screen");
  });

  // Last: once the app reports installed, it stays installed for the visit.
  test("opens the browser prompt once and hides the button after", async () => {
    setDevice(DESKTOP_CHROME);
    const rendered = await renderGuide();
    // Desktop with no prompt yet: every phone's steps.
    expect(text(rendered.root)).toContain("iPhone and iPad");
    expect(text(rendered.root)).toContain("Android");

    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    await act(async () => {
      fakeWindow.dispatchEvent(event);
    });
    const button = rendered.root.find(
      (node) => node.type === "button" && text(node).includes("Install BBPC")
    );
    await act(async () => {
      button.props.onClick();
    });
    expect(prompt).toHaveBeenCalledTimes(1);

    await act(async () => {
      fakeWindow.dispatchEvent(new Event("appinstalled"));
    });
    expect(text(rendered.root)).toContain("You're using the BBPC app");
    expect(
      rendered.root.findAll(
        (node) => node.type === "button" && text(node).includes("Install BBPC")
      )
    ).toHaveLength(0);
  });
});

describe("web app manifest", () => {
  const publicDir = new URL("../public/", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", publicDir), "utf8")
  ) as {
    id: string;
    start_url: string;
    display: string;
    icons: Array<{ src: string; sizes: string; purpose: string }>;
    shortcuts: Array<{ url: string }>;
  };

  test("is installable with separate regular and maskable icons", () => {
    expect(manifest).toMatchObject({ id: "/", start_url: "/", display: "standalone" });
    for (const purpose of ["any", "maskable"]) {
      const sizes = manifest.icons
        .filter((icon) => icon.purpose === purpose)
        .map((icon) => icon.sizes);
      expect(sizes).toEqual(["192x192", "512x512"]);
    }
    for (const icon of manifest.icons) {
      expect(existsSync(new URL(`.${icon.src}`, publicDir))).toBe(true);
    }
    expect(existsSync(new URL("icons/apple-touch-icon.png", publicDir))).toBe(
      true
    );
  });

  test("shortcuts point at pages that exist", () => {
    for (const shortcut of manifest.shortcuts) {
      expect(
        existsSync(
          new URL(`../src/app${shortcut.url}/page.tsx`, import.meta.url)
        )
      ).toBe(true);
    }
  });
});
