import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel.js";
import type {
  MutationCtx,
  QueryCtx,
} from "../_generated/server.js";
import {
  internalMigrationMutation,
  internalReadQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  requireContentType,
  requireFileSize,
  requireOptionalSounderBlobName,
  requireRecordingBlobName,
  requireRecordingSounder,
  requireSortOrder,
  requireTemplateLabel,
} from "../recording/catalogModel.js";
import {
  requirePortableId,
  requireRecordingTimestamp,
} from "../recording/validators.js";
import { RECORDING_CATALOG_OPERATIONS } from "./constants.js";
import { requireMigrationOperation } from "./runtime.js";

const MAX_SOUNDERS = 1_000;
const MAX_TEMPLATES = 100;

const sounderInputValidator = v.object({
  id: v.string(),
  blobName: v.string(),
  name: v.string(),
  category: v.string(),
  url: v.string(),
  duration: v.number(),
  size: v.number(),
  contentType: v.string(),
});
const templateInputValidator = v.object({
  id: v.string(),
  label: v.string(),
  type: v.union(
    v.literal("intro"),
    v.literal("segment"),
    v.literal("ad"),
    v.literal("outro"),
    v.literal("news"),
    v.literal("interview"),
  ),
  introSounder: v.optional(v.string()),
  outroSounder: v.optional(v.string()),
  sortOrder: v.optional(v.number()),
});
const importResultValidator = v.object({
  imported: v.boolean(),
  sounders: v.number(),
  templates: v.number(),
  digest: v.string(),
});

interface SounderInput {
  id: string;
  blobName: string;
  name: string;
  category: string;
  url: string;
  duration: number;
  size: number;
  contentType: string;
}
interface TemplateInput {
  id: string;
  label: string;
  type:
    | "intro"
    | "segment"
    | "ad"
    | "outro"
    | "news"
    | "interview";
  introSounder?: string;
  outroSounder?: string;
  sortOrder?: number;
}
type CanonicalSounder = ReturnType<typeof normalizeSounder>;
type CanonicalTemplate = ReturnType<typeof normalizeTemplate>;
type DatabaseContext = Pick<
  QueryCtx | MutationCtx,
  "db"
>;

function normalizeSounder(
  input: SounderInput,
  sortOrder: number,
) {
  const sounder = requireRecordingSounder(input);
  return {
    id: sounder.sounderId,
    blobName: requireRecordingBlobName(input.blobName),
    name: sounder.name,
    category: sounder.category,
    url: sounder.url,
    duration: sounder.duration,
    size: requireFileSize(input.size),
    contentType: requireContentType(input.contentType),
    sortOrder: requireSortOrder(sortOrder),
  };
}

function normalizeTemplate(
  input: TemplateInput,
  index: number,
) {
  const introSounder = requireOptionalSounderBlobName(
    input.introSounder,
  );
  const outroSounder = requireOptionalSounderBlobName(
    input.outroSounder,
  );
  return {
    id: requirePortableId(
      input.id,
      "Segment template ID",
      160,
    ),
    label: requireTemplateLabel(input.label),
    type: input.type,
    ...(introSounder === undefined
      ? {}
      : { introSounder }),
    ...(outroSounder === undefined
      ? {}
      : { outroSounder }),
    sortOrder: requireSortOrder(input.sortOrder ?? index),
  };
}

function digestCatalogs(
  sounders: CanonicalSounder[],
  templates: CanonicalTemplate[],
): string {
  const encoded = new TextEncoder().encode(
    JSON.stringify({ sounders, templates }),
  );
  return `sha256:${bytesToHex(sha256(encoded))}`;
}

function requireDigest(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/u.test(normalized)) {
    domainError(
      "VALIDATION_FAILED",
      "Recording catalog source digests must be SHA-256 values.",
    );
  }
  return normalized;
}

function requireUniqueCatalogKeys(
  sounders: CanonicalSounder[],
  templates: CanonicalTemplate[],
): void {
  if (
    new Set(sounders.map((sounder) => sounder.id)).size !==
      sounders.length ||
    new Set(sounders.map((sounder) => sounder.blobName)).size !==
      sounders.length ||
    new Set(templates.map((template) => template.id)).size !==
      templates.length
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Recording catalogs cannot contain duplicate identifiers or blob names.",
    );
  }
}

function sounderFromDocument(
  sounder: Doc<"recordingSounders">,
): CanonicalSounder {
  return {
    id: sounder.sounderId,
    blobName: sounder.blobName,
    name: sounder.name,
    category: sounder.category,
    url: sounder.url,
    duration: sounder.duration,
    size: sounder.size,
    contentType: sounder.contentType,
    sortOrder: sounder.sortOrder,
  };
}

function templateFromDocument(
  template: Doc<"recordingSegmentTemplates">,
): CanonicalTemplate {
  return {
    id: template.templateId,
    label: template.label,
    type: template.type,
    ...(template.introSounder === undefined
      ? {}
      : { introSounder: template.introSounder }),
    ...(template.outroSounder === undefined
      ? {}
      : { outroSounder: template.outroSounder }),
    sortOrder: template.sortOrder,
  };
}

async function storedCatalogs(ctx: DatabaseContext): Promise<{
  sounders: CanonicalSounder[];
  templates: CanonicalTemplate[];
}> {
  const [sounderRows, templateRows] = await Promise.all([
    ctx.db
      .query("recordingSounders")
      .take(MAX_SOUNDERS + 1),
    ctx.db
      .query("recordingSegmentTemplates")
      .withIndex("by_sortOrder")
      .take(MAX_TEMPLATES + 1),
  ]);
  if (
    sounderRows.length > MAX_SOUNDERS ||
    templateRows.length > MAX_TEMPLATES
  ) {
    domainError(
      "CONFLICT",
      "Stored recording catalogs exceed their migration safety bounds.",
    );
  }
  return {
    sounders: sounderRows
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder,
      )
      .map(sounderFromDocument),
    templates: templateRows.map(templateFromDocument),
  };
}

export const importRecordingCatalogs =
  internalMigrationMutation({
    args: {
      sourceDigest: v.string(),
      sourceObservedAt: v.number(),
      sounders: v.array(sounderInputValidator),
      templates: v.array(templateInputValidator),
    },
    returns: importResultValidator,
    handler: async (ctx, args) => {
      requireMigrationOperation(
        ctx.migrationOperationId,
        RECORDING_CATALOG_OPERATIONS.import,
      );
      if (
        args.sounders.length > MAX_SOUNDERS ||
        args.templates.length > MAX_TEMPLATES
      ) {
        domainError(
          "VALIDATION_FAILED",
          "Recording catalog import exceeds its safety bounds.",
        );
      }
      const sounders = args.sounders.map(normalizeSounder);
      const templates = args.templates.map(normalizeTemplate);
      requireUniqueCatalogKeys(sounders, templates);
      const digest = digestCatalogs(sounders, templates);
      if (requireDigest(args.sourceDigest) !== digest) {
        domainError(
          "CONFLICT",
          "Recording catalog source digest does not match the import payload.",
        );
      }
      const sourceObservedAt = requireRecordingTimestamp(
        args.sourceObservedAt,
        "Recording catalog observation time",
      );
      const stored = await storedCatalogs(ctx);
      if (
        stored.sounders.length > 0 ||
        stored.templates.length > 0
      ) {
        if (
          digestCatalogs(
            stored.sounders,
            stored.templates,
          ) !== digest
        ) {
          domainError(
            "CONFLICT",
            "Stored recording catalogs conflict with the import payload.",
          );
        }
        return {
          imported: false,
          sounders: sounders.length,
          templates: templates.length,
          digest,
        };
      }
      for (const sounder of sounders) {
        await ctx.db.insert("recordingSounders", {
          sounderId: sounder.id,
          blobName: sounder.blobName,
          name: sounder.name,
          category: sounder.category,
          url: sounder.url,
          duration: sounder.duration,
          size: sounder.size,
          contentType: sounder.contentType,
          sortOrder: sounder.sortOrder,
          updatedAt: sourceObservedAt,
        });
      }
      for (const template of templates) {
        await ctx.db.insert("recordingSegmentTemplates", {
          templateId: template.id,
          label: template.label,
          type: template.type,
          ...(template.introSounder === undefined
            ? {}
            : {
                introSounder:
                  template.introSounder,
              }),
          ...(template.outroSounder === undefined
            ? {}
            : {
                outroSounder:
                  template.outroSounder,
              }),
          sortOrder: template.sortOrder,
          updatedAt: sourceObservedAt,
        });
      }
      await writeAuditEvent(ctx, {
        actor: ctx.actor,
        action: "migration.recording.catalogsImported",
        targetType: "recordingCatalogs",
        targetId: digest,
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: {
          sounders: sounders.length,
          templates: templates.length,
        },
      });
      return {
        imported: true,
        sounders: sounders.length,
        templates: templates.length,
        digest,
      };
    },
  });

export const inspectRecordingCatalogs = internalReadQuery({
  args: {
    expectedDigest: v.string(),
    expectedSounders: v.number(),
    expectedTemplates: v.number(),
  },
  returns: v.object({
    sounders: v.number(),
    templates: v.number(),
    digest: v.string(),
    countsMatch: v.boolean(),
    digestMatches: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const expectedDigest = requireDigest(args.expectedDigest);
    const stored = await storedCatalogs(ctx);
    const digest = digestCatalogs(
      stored.sounders,
      stored.templates,
    );
    return {
      sounders: stored.sounders.length,
      templates: stored.templates.length,
      digest,
      countsMatch:
        stored.sounders.length === args.expectedSounders &&
        stored.templates.length === args.expectedTemplates,
      digestMatches: digest === expectedDigest,
    };
  },
});
