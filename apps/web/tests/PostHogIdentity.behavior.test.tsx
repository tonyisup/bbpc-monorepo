import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Auth = {
  status: "loading" | "authenticated" | "unauthenticated";
  accountStatus: "not-applicable" | "resolving" | "ready";
  user: null | { appUserId: string | null; isAdmin: boolean; isHost: boolean };
};

const mocks = vi.hoisted(() => ({
  convex: {},
  auth: {
    status: "loading",
    accountStatus: "not-applicable",
    user: null,
  } as Auth,
  loadImpersonation: vi.fn<(client: unknown) => Promise<unknown>>(),
  identify: vi.fn(),
  isIdentified: vi.fn(() => false),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: { init: vi.fn() } }));
vi.mock("posthog-js/react", () => ({
  PostHogProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.convex }));
vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => mocks.auth,
}));
vi.mock("@/convex/impersonation", () => ({
  loadCurrentConvexImpersonation: mocks.loadImpersonation,
}));
vi.mock("@/lib/analytics", () => ({
  identifyAnalyticsUser: mocks.identify,
  isAnalyticsUserIdentified: mocks.isIdentified,
  resetAnalytics: mocks.reset,
  setAnalyticsClient: vi.fn(),
}));

import { PostHogProvider } from "@/components/PostHogProvider";

let renderer: ReactTestRenderer | null = null;

async function render(auth: Auth): Promise<void> {
  mocks.auth = auth;
  await act(async () => {
    if (renderer === null) {
      renderer = create(<PostHogProvider>page</PostHogProvider>);
    } else {
      renderer.update(<PostHogProvider>page</PostHogProvider>);
    }
  });
}

const signedIn: Auth = {
  status: "authenticated",
  accountStatus: "ready",
  user: { appUserId: "user-1", isAdmin: false, isHost: true },
};

beforeEach(() => {
  mocks.isIdentified.mockReturnValue(false);
});

afterEach(() => {
  if (renderer !== null) {
    act(() => renderer?.unmount());
    renderer = null;
  }
  vi.resetAllMocks();
});

describe("PostHog identity", () => {
  test("identifies a signed-in listener once the account is ready", async () => {
    mocks.loadImpersonation.mockResolvedValue(null);

    await render({ ...signedIn, accountStatus: "resolving" });
    expect(mocks.loadImpersonation).not.toHaveBeenCalled();

    await render(signedIn);
    expect(mocks.identify).toHaveBeenCalledWith({
      appUserId: "user-1",
      isAdmin: false,
      isHost: true,
    });
  });

  test("does not identify while an admin impersonates a listener", async () => {
    mocks.loadImpersonation.mockResolvedValue({ id: "session-1" });

    await render(signedIn);

    expect(mocks.loadImpersonation).toHaveBeenCalledWith(mocks.convex);
    expect(mocks.identify).not.toHaveBeenCalled();
  });

  test("does not identify when the impersonation check fails", async () => {
    mocks.loadImpersonation.mockRejectedValue(new Error("offline"));

    await render(signedIn);

    expect(mocks.identify).not.toHaveBeenCalled();
  });

  test("unlinks an identified browser once signed out", async () => {
    mocks.isIdentified.mockReturnValue(true);

    await render({ status: "unauthenticated", accountStatus: "not-applicable", user: null });

    expect(mocks.reset).toHaveBeenCalledTimes(1);
    expect(mocks.identify).not.toHaveBeenCalled();
  });

  test("leaves anonymous visitors alone", async () => {
    await render({ status: "unauthenticated", accountStatus: "not-applicable", user: null });

    expect(mocks.reset).not.toHaveBeenCalled();
  });
});
