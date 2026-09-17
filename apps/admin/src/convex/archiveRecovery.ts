import { z } from "zod";
import { ARCHIVE_TARGET, archiveEpisodeSchema, type ArchiveApi, type ArchiveEpisode } from "./archiveImport";

// Exact user-authorized recovery manifest. No catalog rows are bundled into the app.
export const RECOVERY_SHA = "b6f45552b06b7c5bfda1e4c4b9c63b2d4baa8ae2576a7dc0b143231f1433b977";
export const RECOVERY_KEY = `bbpc-recovered-741-759-${RECOVERY_SHA}`;
const beforeSchema = archiveEpisodeSchema.pick({ id: true, number: true, title: true, recording: true,
  date: true, description: true, status: true, slug: true });
const operationSchema = z.object({
  before: beforeSchema,
  recording: z.string().regex(/^https:\/\/bbpc\.blob\.core\.windows\.net\/episodes\/\d{8}\.mp3$/u),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u), bytes: z.number().int().positive(),
});
const planSchema = z.object({ version: z.literal(1), target: z.literal(ARCHIVE_TARGET),
  mediaVerifiedAt: z.string().datetime({ offset: true }), operations: z.array(operationSchema).length(19) });
export type RecoveryPlan = z.infer<typeof planSchema>;
const journalSchema = z.object({ version: z.literal(1), planSha256: z.literal(RECOVERY_SHA),
  target: z.literal(ARCHIVE_TARGET), baseline: z.array(archiveEpisodeSchema),
  entries: z.record(z.enum(["pending", "done"])), verifiedAt: z.string().optional() });
export type RecoveryJournal = z.infer<typeof journalSchema>;

export async function parseRecoveryPlan(text: string): Promise<RecoveryPlan> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== RECOVERY_SHA) throw new Error("Not the exact approved 741–759 recovery manifest.");
  const plan = planSchema.parse(JSON.parse(text));
  if (new Set(plan.operations.map(o => o.before.id)).size !== 19 ||
      new Set(plan.operations.map(o => o.before.number)).size !== 19 ||
      plan.operations.some(o => o.before.number < 741 || o.before.number > 759 ||
        !o.recording.endsWith(`${o.date.replaceAll("-", "")}.mp3`))) throw new Error("Invalid recovery identities or filename dates.");
  return plan;
}
export function parseRecoveryJournal(text: string): RecoveryJournal {
  return journalSchema.parse(JSON.parse(text));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function equal(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
function requireEqual(actual: unknown, expected: unknown, number: number) {
  if (!equal(actual, expected)) throw new Error(`Episode ${number} changed. Repair stopped; review the checkpoint.`);
}
function after(before: ArchiveEpisode, op: RecoveryPlan["operations"][number]): ArchiveEpisode {
  return { ...before, recording: op.recording, date: op.date };
}
function validateState(plan: RecoveryPlan, journal: RecoveryJournal, current: ArchiveEpisode[]) {
  const operations = new Map(plan.operations.map(op => [op.before.id, op]));
  const currentById = new Map(current.map(e => [e.id, e]));
  if (currentById.size !== current.length || current.length !== journal.baseline.length ||
      new Set(journal.baseline.map(e => e.id)).size !== journal.baseline.length ||
      Object.keys(journal.entries).some(id => !operations.has(id))) throw new Error("Catalog/checkpoint identities changed.");
  for (const op of plan.operations) {
    const original = journal.baseline.find(e => e.id === op.before.id);
    if (!original || current.filter(e => e.number === op.before.number).length !== 1) throw new Error("Missing or ambiguous recovery target.");
    requireEqual(beforeSchema.parse(original), op.before, op.before.number);
  }
  for (const original of journal.baseline) {
    const op = operations.get(original.id);
    const state = journal.entries[original.id];
    const currentRow = currentById.get(original.id);
    if (op && state === "pending" && equal(currentRow, original)) continue;
    requireEqual(currentRow, op && state ? after(original, op) : original, original.number);
  }
}
function mediaFresh(plan: RecoveryPlan) {
  const age = Date.now() - Date.parse(plan.mediaVerifiedAt);
  if (age < 0 || age > 2 * 60 * 60 * 1000) throw new Error("Media verification is older than two hours. Recheck before applying.");
}
export async function prepareRecovery(plan: RecoveryPlan, api: ArchiveApi, previous?: RecoveryJournal) {
  mediaFresh(plan);
  const current = await api.list();
  const journal: RecoveryJournal = previous ?? { version: 1, planSha256: RECOVERY_SHA,
    target: ARCHIVE_TARGET, baseline: current, entries: {} };
  validateState(plan, journal, current);
  return journal;
}
export async function applyRecovery(options: { plan: RecoveryPlan; journal: RecoveryJournal; api: ArchiveApi;
  persist: (journal: RecoveryJournal) => void; progress: (count: number) => void; stop: () => boolean }) {
  const { plan, journal, api, persist, progress, stop } = options;
  mediaFresh(plan);
  validateState(plan, journal, await api.list());
  persist(journal);
  let count = 0;
  for (const op of plan.operations) {
    if (stop()) return "paused";
    if (journal.entries[op.before.id] === "done") { progress(++count); continue; }
    const before = journal.baseline.find(e => e.id === op.before.id);
    if (!before) throw new Error("Missing baseline");
    const expected = after(before, op);
    const current = await api.get(before.id);
    if (journal.entries[before.id] !== "pending" || !equal(current, expected)) {
      requireEqual(current, before, before.number);
      journal.entries[before.id] = "pending";
      persist(journal);
      const patch = { recording: op.recording, ...(before.date === op.date ? {} : { date: op.date }) };
      requireEqual(await api.update(current, patch), expected, before.number);
    }
    requireEqual(await api.get(before.id), expected, before.number);
    journal.entries[before.id] = "done";
    persist(journal);
    progress(++count);
  }
  validateState(plan, journal, await api.list());
  journal.verifiedAt = new Date().toISOString();
  persist(journal);
  return "complete";
}
