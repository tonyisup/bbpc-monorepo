import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";

import { listenerName, ListenerNamesToggle } from "./ListenerNames";

function submission(
  change: Partial<ConvexAdminQuoteSubmission> = {}
): ConvexAdminQuoteSubmission {
  return {
    id: "quote-1",
    quoteText: "You talkin' to me?",
    sourceTitle: "Taxi Driver",
    sourceType: "MOVIE",
    clipUrl: null,
    clipStartSeconds: null,
    clipEndSeconds: null,
    listenerNotes: null,
    status: "INCLUDED",
    bracketOrder: null,
    placement: null,
    scored: false,
    createdAt: 1,
    updatedAt: 1,
    userId: "user-1",
    episodeId: "episode-1",
    seasonId: "season-1",
    adminNotes: null,
    user: { id: "user-1", name: "Listener", email: null, image: null },
    episode: { id: "episode-1", number: 1, title: "Pilot", status: "next" },
    season: { id: "season-1", title: "Season 1" },
    point: null,
    ...change,
  };
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

let view: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
});

describe("listener names", () => {
  test("fall back to the email, then to an unknown listener", () => {
    expect(listenerName(submission())).toBe("Listener");
    expect(
      listenerName(
        submission({
          user: { id: "user-1", name: null, email: "a@b.test", image: null },
        })
      )
    ).toBe("a@b.test");
    expect(
      listenerName(
        submission({
          user: { id: "user-1", name: null, email: null, image: null },
        })
      )
    ).toBe("Unknown listener");
  });

  test("the toggle hides names again, and disappears once points are awarded", () => {
    const onPeekingChange = vi.fn();
    act(() => {
      view = create(
        <ListenerNamesToggle
          awarded={false}
          onPeekingChange={onPeekingChange}
          peeking
        />
      );
    });
    const button = view?.root.findByType("button");
    expect(button === undefined ? "" : textOf(button)).toContain("Hide names");
    act(() => button?.props.onClick());
    expect(onPeekingChange).toHaveBeenCalledWith(false);

    act(() =>
      view?.update(
        <ListenerNamesToggle
          awarded
          onPeekingChange={onPeekingChange}
          peeking={false}
        />
      )
    );
    expect(view?.toJSON()).toBeNull();
  });
});
