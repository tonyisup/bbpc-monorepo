import { v } from "convex/values";

export const cutoverStageValidator = v.union(
  v.literal("S0"),
  v.literal("S1"),
  v.literal("S2"),
  v.literal("S3"),
  v.literal("S4"),
);

export const applicationWriteModeValidator = v.union(
  v.literal("disabled"),
  v.literal("enabled"),
);

export const systemStateDocumentValidator = v.object({
  _id: v.id("systemState"),
  _creationTime: v.number(),
  singletonKey: v.literal("global"),
  cutoverStage: cutoverStageValidator,
  applicationWriteMode: applicationWriteModeValidator,
  cutoverRunId: v.string(),
  apiVersion: v.string(),
  approvedBackupId: v.optional(v.string()),
  approvedBackupChecksum: v.optional(v.string()),
  goNoGoApprovedAt: v.optional(v.number()),
  firstApplicationWriteAt: v.optional(v.number()),
  initializedAt: v.number(),
  updatedAt: v.number(),
  updatedBy: v.string(),
});
