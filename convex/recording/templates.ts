import { v } from "convex/values";

import {
  adminMutation,
  anonymousQuery,
} from "../functions.js";
import { domainError } from "../lib/errors.js";
import {
  requireOptionalSounderId,
  requireSortOrder,
  requireTemplateLabel,
} from "./catalogModel.js";
import {
  requirePortableId,
  requireRecordingTimestamp,
} from "./validators.js";

const MAX_SEGMENT_TEMPLATES = 100;
const segmentType = v.union(
  v.literal("intro"),
  v.literal("segment"),
  v.literal("ad"),
  v.literal("outro"),
  v.literal("news"),
  v.literal("interview"),
);
const segmentTemplateInput = v.object({
  id: v.string(),
  label: v.string(),
  type: segmentType,
  introSounder: v.optional(v.string()),
  outroSounder: v.optional(v.string()),
  sortOrder: v.optional(v.number()),
});
const segmentTemplateValidator = v.object({
  id: v.string(),
  label: v.string(),
  type: segmentType,
  introSounder: v.union(v.string(), v.null()),
  outroSounder: v.union(v.string(), v.null()),
  sortOrder: v.number(),
});

export const list = anonymousQuery({
  args: {},
  returns: v.array(segmentTemplateValidator),
  handler: async (ctx) => {
    const templates = await ctx.db
      .query("recordingSegmentTemplates")
      .withIndex("by_sortOrder")
      .take(MAX_SEGMENT_TEMPLATES + 1);
    if (templates.length > MAX_SEGMENT_TEMPLATES) {
      domainError(
        "CONFLICT",
        "The recording template catalog exceeds its limit.",
        { details: { limit: MAX_SEGMENT_TEMPLATES } },
      );
    }
    return templates.map((template) => ({
      id: template.templateId,
      label: template.label,
      type: template.type,
      introSounder: template.introSounder ?? null,
      outroSounder: template.outroSounder ?? null,
      sortOrder: template.sortOrder,
    }));
  },
});

export const upsertMany = adminMutation({
  args: {
    templates: v.array(segmentTemplateInput),
    updatedAt: v.number(),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, args) => {
    if (args.templates.length > MAX_SEGMENT_TEMPLATES) {
      domainError(
        "VALIDATION_FAILED",
        `At most ${String(MAX_SEGMENT_TEMPLATES)} recording templates can be updated at once.`,
      );
    }
    const updatedAt = requireRecordingTimestamp(
      args.updatedAt,
      "Recording template update time",
    );
    const templates = args.templates.map(
      (template, index) => {
        const introSounder = requireOptionalSounderId(
          template.introSounder,
        );
        const outroSounder = requireOptionalSounderId(
          template.outroSounder,
        );
        return {
          templateId: requirePortableId(
            template.id,
            "Segment template ID",
            160,
          ),
          label: requireTemplateLabel(template.label),
          type: template.type,
          ...(introSounder === undefined
            ? {}
            : { introSounder }),
          ...(outroSounder === undefined
            ? {}
            : { outroSounder }),
          sortOrder: requireSortOrder(
            template.sortOrder ?? index,
          ),
          updatedAt,
        };
      },
    );
    if (
      new Set(
        templates.map((template) => template.templateId),
      ).size !== templates.length
    ) {
      domainError(
        "VALIDATION_FAILED",
        "Recording templates cannot contain duplicate IDs.",
      );
    }
    for (const template of templates) {
      const existing = await ctx.db
        .query("recordingSegmentTemplates")
        .withIndex("by_templateId", (query) =>
          query.eq("templateId", template.templateId),
        )
        .take(2);
      if (existing.length > 1) {
        domainError(
          "CONFLICT",
          "The recording template ID is ambiguous.",
        );
      }
      const current = existing.at(0);
      if (current === undefined) {
        await ctx.db.insert(
          "recordingSegmentTemplates",
          template,
        );
      } else {
        await ctx.db.patch(
          "recordingSegmentTemplates",
          current._id,
          {
            ...template,
            // Convex patch treats explicit undefined as field deletion.
            // Preserve replacement semantics when a sounder is cleared.
            introSounder: template.introSounder,
            outroSounder: template.outroSounder,
          },
        );
      }
    }
    return { count: templates.length };
  },
});
