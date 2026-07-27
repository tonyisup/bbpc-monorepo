import { v } from "convex/values";

import {
  adminMutation,
  anonymousQuery,
} from "../functions.js";
import { domainError } from "../lib/errors.js";
import {
  requireContentType,
  requireFileSize,
  requireRecordingBlobName,
  requireRecordingSounder,
} from "./catalogModel.js";
import { requireRecordingTimestamp } from "./validators.js";

const MAX_SOUNDERS = 1_000;
const sounderInput = v.object({
  id: v.string(),
  blobName: v.string(),
  name: v.string(),
  category: v.string(),
  url: v.string(),
  duration: v.number(),
  size: v.number(),
  contentType: v.string(),
});
const sounderValidator = v.object({
  id: v.string(),
  blobName: v.string(),
  name: v.string(),
  category: v.string(),
  url: v.string(),
  duration: v.number(),
  size: v.number(),
  contentType: v.string(),
});

export const list = anonymousQuery({
  args: {},
  returns: v.array(sounderValidator),
  handler: async (ctx) => {
    const sounders = await ctx.db
      .query("recordingSounders")
      .take(MAX_SOUNDERS + 1);
    if (sounders.length > MAX_SOUNDERS) {
      domainError(
        "CONFLICT",
        "The recording sounder catalog exceeds its limit.",
        { details: { limit: MAX_SOUNDERS } },
      );
    }
    return sounders
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.category.localeCompare(right.category) ||
          left.name.localeCompare(right.name),
      )
      .map((sounder) => ({
        id: sounder.sounderId,
        blobName: sounder.blobName,
        name: sounder.name,
        category: sounder.category,
        url: sounder.url,
        duration: sounder.duration,
        size: sounder.size,
        contentType: sounder.contentType,
      }));
  },
});

export const replaceAll = adminMutation({
  args: {
    sounders: v.array(sounderInput),
    updatedAt: v.number(),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, args) => {
    if (args.sounders.length > MAX_SOUNDERS) {
      domainError(
        "VALIDATION_FAILED",
        `The recording sounder catalog can contain at most ${String(MAX_SOUNDERS)} items.`,
      );
    }
    const updatedAt = requireRecordingTimestamp(
      args.updatedAt,
      "Sounder catalog update time",
    );
    const sounders = args.sounders.map((sounder) => ({
      ...requireRecordingSounder(sounder),
      blobName: requireRecordingBlobName(
        sounder.blobName,
      ),
      size: requireFileSize(sounder.size),
      contentType: requireContentType(
        sounder.contentType,
      ),
    }));
    if (
      new Set(
        sounders.map((sounder) => sounder.sounderId),
      ).size !== sounders.length ||
      new Set(
        sounders.map((sounder) => sounder.blobName),
      ).size !== sounders.length
    ) {
      domainError(
        "VALIDATION_FAILED",
        "Recording sounders cannot contain duplicate IDs or blob names.",
      );
    }
    const existing = await ctx.db
      .query("recordingSounders")
      .take(MAX_SOUNDERS + 1);
    if (existing.length > MAX_SOUNDERS) {
      domainError(
        "CONFLICT",
        "The recording sounder catalog exceeds its limit.",
      );
    }
    for (const sounder of existing) {
      await ctx.db.delete(
        "recordingSounders",
        sounder._id,
      );
    }
    for (const [sortOrder, sounder] of sounders.entries()) {
      await ctx.db.insert("recordingSounders", {
        ...sounder,
        sortOrder,
        updatedAt,
      });
    }
    return { count: sounders.length };
  },
});
