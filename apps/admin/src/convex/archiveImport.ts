import { api } from "@tonyisup/bbpc-convex-api";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import type { ConvexReactClient } from "convex/react";
import { z } from "zod";

import { episodeEditableSnapshot } from "./episodeDetails";
import { adminEpisodeSummarySchema } from "./episodes";
import { BBPC_CLIENT_API_VERSION } from "./identity";

// This one-time runner accepts only the separately reviewed, byte-for-byte plan.
// Catalog data and credentials must never be bundled with this application.
export const ARCHIVE_PLAN_SHA = "507c24e937cd09ad85d20c1015e6d2dcd493e0b59c553f05b6fc3bf0f4cbaff3";
export const ARCHIVE_TARGET = "https://determined-wombat-872.convex.cloud";
export const ARCHIVE_ORIGIN = "https://admin.badboyspodcast.com";
export const ARCHIVE_CHECKPOINT_KEY = `bbpc-archive-v1-${ARCHIVE_PLAN_SHA}`;

const detailSchema = adminEpisodeSummarySchema.extend({
  notes: z.string().nullable(), seoDescription: z.string().nullable(),
  seoKeywords: z.string().nullable(), seoTitle: z.string().nullable(),
});
export type ArchiveEpisode = z.infer<typeof detailSchema>;
export const archiveEpisodeSchema = detailSchema;
const publicFields = ["id", "number", "title", "recording", "date", "description", "status", "slug"] as const;
const publicSnapshotSchema = detailSchema.pick({
  id: true, number: true, title: true, recording: true, date: true,
  description: true, status: true, slug: true,
});
const recordingSchema = z.string().regex(/^https:\/\/bbpc\.blob\.core\.windows\.net\/episodes\/[A-Za-z0-9_.%()-]+\.mp3$/u);
const proposedSchema = z.object({
  number: z.number().int().min(-32768).max(32767), title: z.string().min(1).max(1000),
  recording: recordingSchema, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  description: z.string().max(10000).nullable(), status: z.literal("published"),
});
type Proposed = z.infer<typeof proposedSchema>;
export type ArchiveOperation =
  | { key: string; kind: "update"; before: z.infer<typeof publicSnapshotSchema>; recording: string }
  | { key: string; kind: "create"; proposed: Proposed };
export type ArchivePlan = { operations: ArchiveOperation[] };

export async function parseApprovedArchivePlan(text: string): Promise<ArchivePlan> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  if (hash !== ARCHIVE_PLAN_SHA) throw new Error("This file is not the exact approved archive plan.");
  const raw = z.object({ version: z.literal(1), dryRun: z.literal(true),
    updates: z.array(z.object({ status: z.string() }).passthrough()),
    creates: z.array(z.object({ status: z.string() }).passthrough()),
  }).parse(JSON.parse(text));
  const updates = raw.updates.filter(row => row.status === "ready_update").map(row => {
    const value = z.object({ episode: publicSnapshotSchema, action: z.object({
      type: z.literal("update_recording_only"), id: z.string(),
      oldRecording: z.string().nullable(), recording: recordingSchema,
    }) }).parse(row);
    if (value.episode.id !== value.action.id || value.episode.recording !== value.action.oldRecording) {
      throw new Error("Inconsistent approved update.");
    }
    return { key: `update:${value.episode.id}`, kind: "update" as const,
      before: value.episode, recording: value.action.recording };
  });
  const creates = raw.creates.filter(row => row.status === "ready_create").map(row => {
    const { proposed } = z.object({ proposed: proposedSchema }).parse(row);
    return { key: `create:${proposed.number}`, kind: "create" as const, proposed };
  });
  const operations = [...updates, ...creates];
  if (updates.length !== 292 || creates.length !== 260 || new Set(operations.map(o => o.key)).size !== 552) {
    throw new Error("Approved operation counts or identities do not match.");
  }
  return { operations };
}

export function validateArchiveMediaProof(text: string, now = Date.now()): string {
  const proof = z.object({ checkedAt: z.string().datetime({ offset: true }),
    planSha256: z.literal(ARCHIVE_PLAN_SHA), approvedUpdates: z.literal(292),
    approvedCreates: z.literal(260), checkedAzureObjects: z.literal(552),
    changedAzureObjects: z.array(z.unknown()).length(0),
    changedExistingRows: z.array(z.unknown()).length(0),
    newListingConflicts: z.array(z.unknown()).length(0), driftCheckPassed: z.literal(true),
    productionWritesPerformed: z.literal(0), rssRedirectChanged: z.literal(false),
  }).parse(JSON.parse(text));
  const age = now - Date.parse(proof.checkedAt);
  if (age < 0 || age > 2 * 60 * 60 * 1000) throw new Error("The Azure preflight must be less than two hours old.");
  return proof.checkedAt;
}

const entrySchema = z.object({
  state: z.enum(["inflight", "created", "done"]),
  // Persist the returned pending row before publishing a newly created listing.
  created: detailSchema.optional(),
});
const journalSchema = z.object({
  version: z.literal(1), planSha256: z.literal(ARCHIVE_PLAN_SHA), target: z.literal(ARCHIVE_TARGET),
  startedAt: z.string(), baseline: z.array(detailSchema),
  entries: z.record(entrySchema), verifiedAt: z.string().optional(),
});
export type ArchiveJournal = z.infer<typeof journalSchema>;

export function parseArchiveJournal(text: string): ArchiveJournal {
  return journalSchema.parse(JSON.parse(text));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function same(actual: unknown, expected: unknown, label: string) {
  if (canonical(actual) !== canonical(expected)) throw new Error(`${label} changed; no further writes were made.`);
}
function normalizeText(value: string | null) {
  return value?.trim().normalize("NFKC") || null;
}
function publishedCreated(before: ArchiveEpisode, proposed: Proposed): ArchiveEpisode {
  return { ...before, recording: proposed.recording, date: proposed.date,
    description: normalizeText(proposed.description), status: "published" };
}
function knownCreated(entry: z.infer<typeof entrySchema> | undefined): ArchiveEpisode | undefined {
  if (entry?.state === "inflight" && !entry.created) {
    throw new Error("A create has an uncertain outcome. Do not retry it; review the saved checkpoint and catalog first.");
  }
  return entry?.created;
}

export interface ArchiveApi {
  list(): Promise<ArchiveEpisode[]>;
  get(id: string): Promise<ArchiveEpisode>;
  create(proposed: Proposed): Promise<ArchiveEpisode>;
  update(before: ArchiveEpisode, patch: { recording: string; date?: string; description?: string | null; status?: "published" }): Promise<ArchiveEpisode>;
}

export function archiveApi(client: ConvexReactClient, authorize: () => boolean): ArchiveApi {
  function guard() {
    if (client.url !== ARCHIVE_TARGET || !authorize()) throw new Error("Archive import requires the production admin account and approved target.");
  }
  return {
    async list() {
      guard();
      const result: ArchiveEpisode[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      for (;;) {
        const page = z.object({ page: z.array(detailSchema), isDone: z.boolean(), continueCursor: z.string() }).parse(
          await client.query(api.episodes.admin.listPage, { paginationOpts: { cursor, numItems: 50 } })
        );
        result.push(...page.page);
        if (result.length > 1200 || new Set(result.map(e => e.id)).size !== result.length) throw new Error("Catalog pagination is inconsistent.");
        if (page.isDone) return result;
        if (!page.continueCursor || cursors.has(page.continueCursor)) throw new Error("Catalog pagination did not advance.");
        cursors.add(page.continueCursor);
        cursor = page.continueCursor;
      }
    },
    async get(id) {
      guard();
      return detailSchema.parse(await client.query(api.episodes.admin.getById, { id: documentId("episodes", id) }));
    },
    async create(proposed) {
      guard();
      return detailSchema.parse(await client.mutation(api.episodes.admin.createEpisode, {
        clientApiVersion: BBPC_CLIENT_API_VERSION, number: proposed.number, title: proposed.title,
      }));
    },
    async update(before, patch) {
      guard();
      return detailSchema.parse(await client.mutation(api.episodes.admin.updateEpisode, {
        clientApiVersion: BBPC_CLIENT_API_VERSION, id: documentId("episodes", before.id),
        ...patch, expected: episodeEditableSnapshot(before),
      }));
    },
  };
}

export function checkArchiveState(plan: ArchivePlan, journal: ArchiveJournal, current: ArchiveEpisode[]) {
  const currentById = new Map(current.map(e => [e.id, e]));
  const baselineById = new Map(journal.baseline.map(e => [e.id, e]));
  const keys = new Set(plan.operations.map(o => o.key));
  if (Object.keys(journal.entries).some(key => !keys.has(key))) throw new Error("Checkpoint contains unapproved operations.");
  for (const op of plan.operations) {
    const entry = journal.entries[op.key];
    if (op.kind === "update") {
      if (entry?.created || entry?.state === "created") throw new Error("Invalid recording-update checkpoint.");
      const before = baselineById.get(op.before.id);
      if (!before) throw new Error(`Missing baseline for episode ${op.before.number}.`);
      for (const field of publicFields) same(before[field], op.before[field], `Approved episode ${op.before.number} (${field})`);
      const expected = entry ? { ...before, recording: op.recording } : before;
      const actual = currentById.get(before.id);
      // A lost update response may be safely reconciled as before OR exactly after.
      if (entry?.state === "inflight" && canonical(actual) === canonical(before)) continue;
      same(actual, expected, `Episode ${before.number}`);
    } else {
      const created = knownCreated(entry);
      const conflicts = current.filter(e => e.number === op.proposed.number || e.recording === op.proposed.recording);
      if (!created) {
        if (entry || conflicts.length) throw new Error(`Episode ${op.proposed.number} already exists or its checkpoint is incomplete.`);
      } else {
        if (baselineById.has(created.id) || created.number !== op.proposed.number || created.title !== op.proposed.title || created.status !== "pending" || created.recording !== null || created.assignments.length || created.links.length || created.extras.length) {
          throw new Error("Created episode checkpoint does not describe an untouched new listing.");
        }
        if (conflicts.length !== 1 || conflicts[0]?.id !== created.id) throw new Error(`Episode ${op.proposed.number} has conflicting listings.`);
        const actual = currentById.get(created.id);
        if (entry?.state !== "done" && canonical(actual) === canonical(created)) continue;
        same(actual, publishedCreated(created, op.proposed), `New episode ${op.proposed.number}`);
      }
    }
  }
}

export async function prepareArchiveImport(plan: ArchivePlan, apiClient: ArchiveApi, previous?: ArchiveJournal): Promise<ArchiveJournal> {
  const current = await apiClient.list();
  const journal: ArchiveJournal = previous ?? {
    version: 1, planSha256: ARCHIVE_PLAN_SHA, target: ARCHIVE_TARGET,
    startedAt: new Date().toISOString(), baseline: current, entries: {},
  };
  checkArchiveState(plan, journal, current);
  return journal;
}

export async function runArchiveImport(options: {
  plan: ArchivePlan; journal: ArchiveJournal; apiClient: ArchiveApi;
  persist: (journal: ArchiveJournal) => void; stop: () => boolean;
  progress: (completed: number, label: string) => void;
}): Promise<"paused" | "complete"> {
  const { plan, journal, apiClient, persist, stop, progress } = options;
  checkArchiveState(plan, journal, await apiClient.list());
  persist(journal); // Storage/quota failure must occur before any network mutation.
  let completed = 0;
  for (const op of plan.operations) {
    if (stop()) return "paused";
    const entry = journal.entries[op.key];
    if (entry?.state === "done") { completed++; continue; }
    progress(completed, op.kind === "update" ? `Updating recording for ${op.before.number}` : `Creating historical listing ${op.proposed.number}`);
    if (op.kind === "update") {
      const before = journal.baseline.find(e => e.id === op.before.id);
      if (!before) throw new Error("Missing recording update checkpoint.");
      const expected = { ...before, recording: op.recording };
      const current = await apiClient.get(before.id);
      if (entry?.state !== "inflight" || canonical(current) !== canonical(expected)) {
        same(current, before, `Episode ${before.number}`);
        journal.entries[op.key] = { state: "inflight" };
        persist(journal);
        // Intentionally no status, slug, title, description or other patch fields.
        same(await apiClient.update(current, { recording: op.recording }), expected, `Updated episode ${before.number}`);
      }
      same(await apiClient.get(before.id), expected, `Verified episode ${before.number}`);
      journal.entries[op.key] = { state: "done" };
    } else {
      let created = knownCreated(entry);
      if (!created) {
        // Refresh before each create: backend createEpisode has no unique-number constraint.
        const current = await apiClient.list();
        if (current.some(e => e.number === op.proposed.number || e.recording === op.proposed.recording)) throw new Error(`Episode ${op.proposed.number} is no longer missing.`);
        journal.entries[op.key] = { state: "inflight" };
        persist(journal);
        created = await apiClient.create(op.proposed);
        journal.entries[op.key] = { state: "created", created };
        persist(journal); // Never retry create if its response or this durable save fails.
        checkArchiveState({ operations: [op] }, { ...journal, entries: { [op.key]: { state: "created", created } } }, [created]);
      }
      const expected = publishedCreated(created, op.proposed);
      const current = await apiClient.get(created.id);
      if (canonical(current) !== canonical(expected)) {
        same(current, created, `Pending episode ${op.proposed.number}`);
        same(await apiClient.update(current, { recording: op.proposed.recording, date: op.proposed.date,
          description: op.proposed.description, status: "published" }), expected, `Published episode ${op.proposed.number}`);
      }
      same(await apiClient.get(created.id), expected, `Verified new episode ${op.proposed.number}`);
      journal.entries[op.key] = { state: "done", created };
    }
    persist(journal);
    progress(++completed, `Verified ${completed} of ${plan.operations.length}`);
  }
  const final = await apiClient.list();
  checkArchiveState(plan, journal, final);
  const updated = new Map(plan.operations.filter(o => o.kind === "update").map(o => [o.before.id, o.recording]));
  for (const before of journal.baseline) {
    same(final.find(e => e.id === before.id), updated.has(before.id) ? { ...before, recording: updated.get(before.id) } : before, `Final verification of episode ${before.number}`);
  }
  journal.verifiedAt = new Date().toISOString();
  persist(journal);
  progress(completed, "All approved changes verified; unrelated catalog fields preserved. RSS untouched.");
  return "complete";
}
