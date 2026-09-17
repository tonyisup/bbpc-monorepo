import type { ConvexReactClient } from "convex/react";
import { getFunctionName } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import {
  ARCHIVE_PLAN_SHA, ARCHIVE_TARGET, archiveApi, checkArchiveState,
  parseApprovedArchivePlan, parseArchiveJournal, prepareArchiveImport,
  runArchiveImport, validateArchiveMediaProof,
  type ArchiveApi, type ArchiveEpisode, type ArchiveJournal, type ArchivePlan,
} from "./archiveImport";

const episode: ArchiveEpisode = {
  id: "old-id", number: 10, title: " Original title ", recording: "",
  date: "2020-01-01", description: " keep whitespace ", status: "published",
  slug: "original-slug", notes: "private notes", seoDescription: "SEO", seoKeywords: "keywords", seoTitle: "SEO title",
  assignments: [], extras: [], links: [{ id: "link", url: "https://example.com", text: "Keep" }],
};
const proposed = { number: 20, title: "Historical episode", recording: "https://bbpc.blob.core.windows.net/episodes/20200102.mp3",
  date: "2020-01-02", description: " notes\n", status: "published" as const };
const plan: ArchivePlan = { operations: [
  { key: "update:old-id", kind: "update", before: Object.fromEntries(
    ["id", "number", "title", "recording", "date", "description", "status", "slug"].map(key => [key, episode[key as keyof ArchiveEpisode]])
  ) as typeof episode, recording: "https://bbpc.blob.core.windows.net/episodes/20200101.mp3" },
  { key: "create:20", kind: "create", proposed },
] };

function fixture() {
  const rows = new Map([[episode.id, structuredClone(episode)]]);
  const apiClient: ArchiveApi = {
    list: vi.fn(async () => structuredClone([...rows.values()])),
    get: vi.fn(async id => {
      const row = rows.get(id);
      if (!row) throw new Error("Missing fixture row");
      return structuredClone(row);
    }),
    create: vi.fn(async input => {
      const result = { ...structuredClone(episode), id: "created-id", number: input.number, title: input.title,
        recording: null, date: null, description: null, status: "pending", slug: "historical-episode",
        notes: null, seoDescription: null, seoKeywords: null, seoTitle: null,
        assignments: [], extras: [], links: [] };
      rows.set(result.id, result);
      return structuredClone(result);
    }),
    update: vi.fn(async (before, patch) => {
      const result = { ...before, ...patch,
        ...(patch.description !== undefined ? { description: patch.description?.trim().normalize("NFKC") || null } : {}) };
      rows.set(before.id, result);
      return structuredClone(result);
    }),
  };
  let durable: ArchiveJournal | undefined;
  const persist = vi.fn((journal: ArchiveJournal) => { durable = structuredClone(journal); });
  return { apiClient, rows, persist, durable: () => durable };
}

async function run(f: ReturnType<typeof fixture>, journal: ArchiveJournal, selectedPlan = plan, stop = () => false) {
  return runArchiveImport({ plan: selectedPlan, journal, apiClient: f.apiClient, persist: f.persist, stop, progress: vi.fn() });
}

describe("approved one-time archive import", () => {
  test("rejects modified/unapproved input before it can yield operations", async () => {
    await expect(parseApprovedArchivePlan(JSON.stringify({ version: 1, updates: [], creates: [] }))).rejects.toThrow("exact approved");
  });

  test("requires a recent, successful Azure check for the exact approved batch", () => {
    const proof = { checkedAt: "2026-09-17T17:00:00Z", planSha256: ARCHIVE_PLAN_SHA,
      approvedUpdates: 292, approvedCreates: 260, checkedAzureObjects: 552,
      changedAzureObjects: [], changedExistingRows: [], newListingConflicts: [], driftCheckPassed: true,
      productionWritesPerformed: 0, rssRedirectChanged: false };
    expect(validateArchiveMediaProof(JSON.stringify(proof), Date.parse("2026-09-17T17:01:00Z"))).toBe(proof.checkedAt);
    expect(() => validateArchiveMediaProof(JSON.stringify(proof), Date.parse("2026-09-17T20:00:00Z"))).toThrow("two hours");
    expect(() => validateArchiveMediaProof(JSON.stringify({ ...proof, changedAzureObjects: ["changed.mp3"] }))).toThrow();
    expect(() => parseArchiveJournal(JSON.stringify({ target: "https://wrong.convex.cloud" }))).toThrow();
  });

  test("preflights without writes, patches only recording, creates separately and preserves metadata", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    expect(f.apiClient.update).not.toHaveBeenCalled();
    expect(f.apiClient.create).not.toHaveBeenCalled();
    await expect(run(f, journal)).resolves.toBe("complete");
    expect(f.apiClient.update).toHaveBeenNthCalledWith(1, episode, { recording: "https://bbpc.blob.core.windows.net/episodes/20200101.mp3" });
    expect(f.rows.get("old-id")).toEqual({ ...episode, recording: "https://bbpc.blob.core.windows.net/episodes/20200101.mp3" });
    expect(f.rows.get("created-id")).toMatchObject({ ...proposed, description: "notes", status: "published" });
    expect(f.durable()?.verifiedAt).toBeDefined();
    expect(Object.values(journal.entries).every(e => e.state === "done")).toBe(true);
    expect(f.persist.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.apiClient.update).mock.invocationCallOrder[0] ?? 0);
  });

  test("finished operations are idempotent on resume", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    await run(f, journal);
    await run(f, await prepareArchiveImport(plan, f.apiClient, f.durable()));
    expect(f.apiClient.update).toHaveBeenCalledTimes(2);
    expect(f.apiClient.create).toHaveBeenCalledTimes(1);
  });

  test("halts before writing when approved metadata drifted or a new listing conflicts", async () => {
    const f = fixture();
    f.rows.set(episode.id, { ...episode, description: "changed" });
    await expect(prepareArchiveImport(plan, f.apiClient)).rejects.toThrow("changed");
    f.rows.set(episode.id, episode);
    f.rows.set("conflict", { ...episode, id: "conflict", number: 20 });
    await expect(prepareArchiveImport(plan, f.apiClient)).rejects.toThrow("already exists");
    expect(f.apiClient.update).not.toHaveBeenCalled();
    expect(f.apiClient.create).not.toHaveBeenCalled();
  });

  test("checks private metadata again immediately before each write", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    vi.mocked(f.apiClient.get).mockResolvedValueOnce({ ...episode, notes: "changed after preflight" });
    await expect(run(f, journal)).rejects.toThrow("changed");
    expect(f.apiClient.update).not.toHaveBeenCalled();
  });

  test("storage failure prevents the first mutation", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    f.persist.mockImplementation(() => { throw new Error("quota"); });
    await expect(run(f, journal)).rejects.toThrow("quota");
    expect(f.apiClient.update).not.toHaveBeenCalled();
    expect(f.apiClient.create).not.toHaveBeenCalled();
  });

  test("lost recording-update response is reconciled without writing again", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    const update = f.apiClient.update;
    f.apiClient.update = vi.fn(async (before, patch) => {
      await update(before, patch);
      throw new Error("lost response");
    });
    await expect(run(f, journal)).rejects.toThrow("lost response");
    f.apiClient.update = update;
    await run(f, await prepareArchiveImport(plan, f.apiClient, f.durable()));
    expect(update).toHaveBeenCalledTimes(2); // one existing-row update + one new-row publish
  });

  test("uncertain create never retries and cannot make a duplicate", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    const create = f.apiClient.create;
    f.apiClient.create = vi.fn(async input => { await create(input); throw new Error("lost create response"); });
    await expect(run(f, journal)).rejects.toThrow("lost create response");
    await expect(prepareArchiveImport(plan, f.apiClient, f.durable())).rejects.toThrow("uncertain outcome");
    expect(f.apiClient.create).toHaveBeenCalledTimes(1);
    expect(f.rows.get("created-id")?.status).toBe("pending");
  });

  test("a known created ID resumes publication without a second create", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    const update = f.apiClient.update;
    f.apiClient.update = vi.fn(async (before, patch) => {
      if (before.id === "created-id") throw new Error("publish interrupted");
      return update(before, patch);
    });
    await expect(run(f, journal)).rejects.toThrow("publish interrupted");
    f.apiClient.update = update;
    await run(f, await prepareArchiveImport(plan, f.apiClient, f.durable()));
    expect(f.apiClient.create).toHaveBeenCalledTimes(1);
    expect(f.rows.get("created-id")?.status).toBe("published");
  });

  test("pause is between complete operations and unrelated changes fail final verification", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    await expect(run(f, journal, plan, () => true)).resolves.toBe("paused");
    expect(f.apiClient.update).not.toHaveBeenCalled();
    const unrelated = { ...episode, id: "unrelated", number: 99 };
    f.rows.set(unrelated.id, unrelated);
    const next = await prepareArchiveImport(plan, f.apiClient);
    const get = f.apiClient.get;
    f.apiClient.get = vi.fn(async id => {
      f.rows.set(unrelated.id, { ...unrelated, notes: "changed by someone else" });
      return get(id);
    });
    await expect(run(f, next)).rejects.toThrow("Final verification of episode 99");
    expect(next.verifiedAt).toBeUndefined();
  });

  test("checkpoint cannot adopt an existing episode as a newly created row", async () => {
    const f = fixture();
    const journal = await prepareArchiveImport(plan, f.apiClient);
    journal.entries["create:20"] = { state: "created", created: { ...episode, number: 20 } };
    expect(() => checkArchiveState(plan, journal, [...f.rows.values()])).toThrow("untouched new listing");
  });
});

describe("archive Convex adapter", () => {
  test("retains expected snapshot and API version but sends no unrelated write fields", async () => {
    const mutation = vi.fn().mockResolvedValue({ ...episode, recording: proposed.recording });
    const client = { url: ARCHIVE_TARGET, mutation } as unknown as ConvexReactClient;
    await archiveApi(client, () => true).update(episode, { recording: proposed.recording });
    const call = mutation.mock.calls[0];
    if (!call) throw new Error("Missing mutation call");
    const [reference, args] = call;
    expect(getFunctionName(reference)).toBe("episodes/admin:updateEpisode");
    expect(Object.keys(args).sort()).toEqual(["clientApiVersion", "expected", "id", "recording"]);
    expect(args.expected).toMatchObject({ notes: episode.notes, slug: episode.slug, recording: "", description: " keep whitespace " });
  });

  test("rejects wrong deployment or unauthenticated admin before queries or mutations", async () => {
    const mutation = vi.fn();
    const query = vi.fn();
    const client = { url: "https://development.convex.cloud", query, mutation } as unknown as ConvexReactClient;
    await expect(archiveApi(client, () => true).create(proposed)).rejects.toThrow("approved target");
    await expect(archiveApi({ ...client, url: ARCHIVE_TARGET } as ConvexReactClient, () => false).list()).rejects.toThrow("admin account");
    expect(mutation).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
  });

  test("rejects repeated page cursors", async () => {
    const query = vi.fn().mockResolvedValue({ page: [], continueCursor: "same", isDone: false });
    await expect(archiveApi({ url: ARCHIVE_TARGET, query } as unknown as ConvexReactClient, () => true).list()).rejects.toThrow("did not advance");
  });
});
