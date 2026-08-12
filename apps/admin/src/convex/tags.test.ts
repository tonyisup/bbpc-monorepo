import type { ConvexReactClient } from "convex/react";
import { describe, expect, test, vi } from "vitest";

import { BBPC_CLIENT_API_VERSION } from "./identity";
import {
  ADMIN_TAG_VOTES_PAGE_SIZE,
  applyConvexAdminTagVotePoints,
  createConvexAdminTag,
  deleteConvexAdminTag,
  deleteConvexAdminTagVote,
  loadConvexAdminTagVotesPage,
  loadConvexAdminTags,
  updateConvexAdminTag,
} from "./tags";

const tag = {
  id: "tag-1",
  name: "Great score",
  description: null,
  createdAt: 1_700_000_000_000,
};

const vote = {
  id: "vote-1",
  tag: "Great score",
  tmdbId: 123,
  isTag: true,
  createdAt: 1_700_000_000_001,
  user: {
    id: "user-1",
    name: "Host",
    image: null,
  },
  award: { kind: "unawarded" as const },
};

describe("Convex admin tag adapter", () => {
  test("validates the bounded catalog and paginated votes", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([tag])
      .mockResolvedValueOnce({
        page: [vote],
        isDone: true,
        continueCursor: "done",
      });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminTags(client)).resolves.toEqual([tag]);
    await expect(loadConvexAdminTagVotesPage(client, null)).resolves.toEqual({
      votes: [vote],
      isDone: true,
      continueCursor: "done",
    });
    expect(query).toHaveBeenNthCalledWith(2, expect.anything(), {
      paginationOpts: {
        cursor: null,
        numItems: ADMIN_TAG_VOTES_PAGE_SIZE,
      },
    });
  });

  test("versions catalog, award, and vote writes", async () => {
    const mutation = vi
      .fn()
      .mockResolvedValueOnce(tag)
      .mockResolvedValueOnce({ ...tag, name: "Updated" })
      .mockResolvedValueOnce({ id: tag.id })
      .mockResolvedValueOnce({
        ...vote,
        award: { kind: "point", point: { id: "point-1" } },
      })
      .mockResolvedValueOnce({ id: vote.id });
    const client = { mutation } as unknown as ConvexReactClient;

    await createConvexAdminTag(client, {
      name: tag.name,
      description: null,
    });
    await updateConvexAdminTag(client, tag.id, {
      name: "Updated",
      description: null,
    });
    await deleteConvexAdminTag(client, tag.id);
    await applyConvexAdminTagVotePoints(
      client,
      vote.id,
      "2026-07-24"
    );
    await deleteConvexAdminTagVote(client, vote.id);

    for (const call of mutation.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          clientApiVersion: BBPC_CLIENT_API_VERSION,
        })
      );
    }
  });

  test("rejects drifted award evidence", async () => {
    const query = vi.fn().mockResolvedValue({
      page: [{ ...vote, award: { kind: "point", point: null } }],
      isDone: true,
      continueCursor: "done",
    });
    const client = { query } as unknown as ConvexReactClient;

    await expect(loadConvexAdminTagVotesPage(client, null)).rejects.toThrow();
  });
});
