import { describe, expect, test, vi } from "vitest";
import { ARCHIVE_TARGET, type ArchiveApi, type ArchiveEpisode } from "./archiveImport";
import { applyRecovery, parseRecoveryJournal, parseRecoveryPlan, prepareRecovery, RECOVERY_SHA,
  type RecoveryJournal, type RecoveryPlan } from "./archiveRecovery";

function fixture() {
  const baseline: ArchiveEpisode[] = Array.from({ length: 20 }, (_, i) => ({
    id: `episode-${741 + i}`, number: 741 + i, title: ` Keep ${i} `, recording: "https://soundcloud.com/example",
    date: i < 11 ? "2025-08-05" : "2025-08-04", description: " keep whitespace ", status: "published",
    slug: `keep-${i}`, notes: "private", seoTitle: "SEO", seoDescription: null, seoKeywords: "keyword",
    assignments: [], extras: [], links: [{ id: `link-${i}`, text: "Keep", url: "https://example.com" }],
  }));
  const rows = new Map(baseline.map(e => [e.id, structuredClone(e)]));
  const plan: RecoveryPlan = { version: 1, target: ARCHIVE_TARGET, mediaVerifiedAt: new Date().toISOString(),
    operations: baseline.slice(0, 19).map(e => ({ before: Object.fromEntries(
      ["id", "number", "title", "recording", "date", "description", "status", "slug"].map(k => [k, e[k as keyof ArchiveEpisode]])
    ) as typeof e, date: "2025-08-04", recording: "https://bbpc.blob.core.windows.net/episodes/20250804.mp3",
    sha256: "a".repeat(64), bytes: 1000 })) };
  const api: ArchiveApi = {
    list: vi.fn(async () => structuredClone([...rows.values()])),
    get: vi.fn(async id => { const e = rows.get(id); if (!e) throw new Error("Missing"); return structuredClone(e); }),
    update: vi.fn(async (before, patch) => { const e = { ...before, ...patch }; rows.set(e.id, e); return structuredClone(e); }),
    create: vi.fn(async () => { throw new Error("Must not create"); }),
  };
  let durable: RecoveryJournal | undefined;
  const persist = vi.fn((j: RecoveryJournal) => { durable = structuredClone(j); });
  const run = (journal: RecoveryJournal, stop = () => false) => applyRecovery({ plan, journal, api, persist, stop, progress: vi.fn() });
  return { baseline, rows, plan, api, persist, run, durable: () => durable };
}
describe("approved 741–759 recovery", () => {
  test("rejects unapproved manifests and mismatched checkpoints", async () => {
    await expect(parseRecoveryPlan("{}")).rejects.toThrow("exact approved");
    expect(() => parseRecoveryJournal(JSON.stringify({ version: 1, planSha256: RECOVERY_SHA, target: "wrong", baseline: [], entries: {} }))).toThrow();
  });
  test("preflight writes nothing; execution patches 19 recordings and only 11 dates", async () => {
    const f = fixture(); const j = await prepareRecovery(f.plan, f.api);
    expect(f.api.update).not.toHaveBeenCalled();
    await expect(f.run(j)).resolves.toBe("complete");
    expect(f.api.create).not.toHaveBeenCalled();
    const calls = vi.mocked(f.api.update).mock.calls;
    expect(calls).toHaveLength(19);
    expect(calls.filter(([, p]) => "date" in p)).toHaveLength(11);
    calls.forEach(([, p]) => expect(Object.keys(p).sort()).toEqual("date" in p ? ["date", "recording"] : ["recording"]));
    for (const before of f.baseline) {
      expect(f.rows.get(before.id)).toEqual(before.number === 760 ? before : { ...before, recording: f.plan.operations[0]?.recording, date: "2025-08-04" });
    }
    expect(f.durable()?.verifiedAt).toBeDefined();
    expect(f.persist.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.api.update).mock.invocationCallOrder[0] ?? 0);
    await f.run(await prepareRecovery(f.plan, f.api, f.durable()));
    expect(f.api.update).toHaveBeenCalledTimes(19);
  });
  test("missing or ambiguous target prevents all writes", async () => {
    const f = fixture(); f.rows.delete("episode-741");
    await expect(prepareRecovery(f.plan, f.api)).rejects.toThrow("Missing or ambiguous");
    const original = f.baseline[0];
    if (!original) throw new Error("Missing fixture");
    f.rows.set(original.id, original); f.rows.set("duplicate", { ...original, id: "duplicate" });
    await expect(prepareRecovery(f.plan, f.api)).rejects.toThrow("Missing or ambiguous");
    expect(f.api.update).not.toHaveBeenCalled();
  });
  test("public or private drift stops before mutation", async () => {
    const f = fixture(); const j = await prepareRecovery(f.plan, f.api);
    const original = f.baseline[0];
    if (!original) throw new Error("Missing fixture");
    vi.mocked(f.api.get).mockResolvedValueOnce({ ...original, notes: "changed" });
    await expect(f.run(j)).rejects.toThrow("changed");
    expect(f.api.update).not.toHaveBeenCalled();
    f.rows.set("episode-741", { ...original, date: "2025-08-06" });
    await expect(prepareRecovery(f.plan, f.api)).rejects.toThrow("changed");
  });
  test("storage failure prevents all writes", async () => {
    const f = fixture(); const j = await prepareRecovery(f.plan, f.api);
    f.persist.mockImplementation(() => { throw new Error("quota"); });
    await expect(f.run(j)).rejects.toThrow("quota");
    expect(f.api.update).not.toHaveBeenCalled();
  });
  test("lost response reconciles the exact after state without repeating mutation", async () => {
    const f = fixture(); const j = await prepareRecovery(f.plan, f.api); const update = f.api.update;
    f.api.update = vi.fn(async (before, patch) => { await update(before, patch); throw new Error("lost response"); });
    await expect(f.run(j)).rejects.toThrow("lost response");
    expect(f.durable()?.entries["episode-741"]).toBe("pending");
    f.api.update = update;
    await expect(f.run(await prepareRecovery(f.plan, f.api, f.durable()))).resolves.toBe("complete");
    expect(update).toHaveBeenCalledTimes(19);
  });
  test("stale media proof prevents writes", async () => {
    const f = fixture(); f.plan.mediaVerifiedAt = "2020-01-01T00:00:00Z";
    await expect(prepareRecovery(f.plan, f.api)).rejects.toThrow("two hours");
    expect(f.api.update).not.toHaveBeenCalled();
  });
  test("pause writes nothing and final verification detects unrelated drift", async () => {
    const f = fixture(); const j = await prepareRecovery(f.plan, f.api);
    await expect(f.run(j, () => true)).resolves.toBe("paused");
    expect(f.api.update).not.toHaveBeenCalled();
    const get = f.api.get;
    const unrelated = f.baseline[19];
    if (!unrelated) throw new Error("Missing fixture");
    f.api.get = vi.fn(async id => {
      f.rows.set("episode-760", { ...unrelated, title: "Concurrent edit" }); return get(id);
    });
    await expect(f.run(j)).rejects.toThrow("Episode 760 changed");
    expect(j.verifiedAt).toBeUndefined();
  });
});
