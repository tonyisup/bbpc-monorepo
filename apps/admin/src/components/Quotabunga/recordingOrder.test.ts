import { describe, expect, test } from "vitest";

import type { ConvexAdminQuoteSubmission } from "@/convex/quotabunga";

import { recordingOrder } from "./recordingOrder";

function submission(
  id: string,
  change: Partial<ConvexAdminQuoteSubmission> = {}
): ConvexAdminQuoteSubmission {
  return {
    id,
    quoteText: `Quote ${id}`,
    sourceTitle: `Source ${id}`,
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
    userId: `user-${id}`,
    episodeId: "episode-1",
    seasonId: "season-1",
    adminNotes: null,
    user: {
      id: `user-${id}`,
      name: `Listener ${id}`,
      email: null,
      image: null,
    },
    episode: { id: "episode-1", number: 1, title: "Pilot", status: "next" },
    season: { id: "season-1", title: "Season 1" },
    point: null,
    ...change,
  };
}

const ids = (entries: ConvexAdminQuoteSubmission[]) =>
  entries.map((entry) => entry.id);

describe("recording order", () => {
  test("sorts bracketed entries numerically, and keeps the order when a refresh returns entries in another order", () => {
    const entries = [
      submission("ten", { bracketOrder: 10 }),
      submission("two", { bracketOrder: 2 }),
      ...["c", "d", "e", "f", "g", "h"].map((id) => submission(id)),
      submission("one", { bracketOrder: 1 }),
    ];
    const order = ids(recordingOrder(entries, "episode-1"));
    expect(order.slice(0, 3)).toEqual(["one", "two", "ten"]);
    expect(ids(recordingOrder([...entries].reverse(), "episode-1"))).toEqual(
      order
    );
  });
});
