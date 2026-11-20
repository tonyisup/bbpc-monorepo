import type { PostHog } from "posthog-js";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  identifyAnalyticsUser,
  isAnalyticsUserIdentified,
  resetAnalytics,
  setAnalyticsClient,
  track,
} from "@/lib/analytics";

function fakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const client = {
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    _isIdentified: vi.fn(() => false),
    ...overrides,
  };
  setAnalyticsClient(client as unknown as PostHog);
  return client;
}

afterEach(() => {
  setAnalyticsClient(null);
});

describe("analytics", () => {
  test("does nothing before PostHog registers a client", () => {
    expect(() => {
      track("syllabus_movie_removed", {});
      identifyAnalyticsUser({ appUserId: "user-1", isAdmin: false, isHost: false });
      resetAnalytics();
    }).not.toThrow();
    expect(isAnalyticsUserIdentified()).toBe(false);
  });

  test("forwards events, and sends instantly only when asked", () => {
    const client = fakeClient();

    track("quotabunga_withdrawn", { episode_id: "episode-1" });
    track("sign_in_started", { page_path: "/syllabus" }, { sendInstantly: true });

    expect(client.capture).toHaveBeenNthCalledWith(
      1,
      "quotabunga_withdrawn",
      { episode_id: "episode-1" },
      undefined
    );
    expect(client.capture).toHaveBeenNthCalledWith(
      2,
      "sign_in_started",
      { page_path: "/syllabus" },
      { send_instantly: true }
    );
  });

  test("identifies by the Convex user ID with role flags only", () => {
    const client = fakeClient();

    identifyAnalyticsUser({ appUserId: "user-1", isAdmin: true, isHost: false });

    expect(client.identify).toHaveBeenCalledWith("user-1", {
      is_admin: true,
      is_host: false,
    });
  });

  test("never lets an SDK failure reach the caller", () => {
    const boom = () => {
      throw new Error("sdk down");
    };
    fakeClient({ capture: boom, identify: boom, reset: boom, _isIdentified: boom });

    expect(() => {
      track("syllabus_movie_removed", {});
      identifyAnalyticsUser({ appUserId: "user-1", isAdmin: false, isHost: false });
      resetAnalytics();
    }).not.toThrow();
    expect(isAnalyticsUserIdentified()).toBe(false);
  });
});
