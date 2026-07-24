import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  applicationWriteModeValidator,
  cutoverStageValidator,
} from "./lib/validators.js";

const userStatus = v.union(v.literal("active"), v.literal("disabled"));
const principalStatus = v.union(v.literal("active"), v.literal("disabled"));
const migrationRunStatus = v.union(
  v.literal("running"),
  v.literal("transformed"),
  v.literal("reconciled"),
  v.literal("failed"),
);
const migrationCheckpointStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
);
const auditValue = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
);

export default defineSchema({
  users: defineTable({
    legacyId: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    normalizedEmail: v.optional(v.string()),
    emailVerifiedAt: v.optional(v.number()),
    image: v.optional(v.string()),
    status: userStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedEmail", ["normalizedEmail"])
    .index("by_status", ["status"]),

  authIdentities: defineTable({
    tokenIdentifier: v.string(),
    issuer: v.string(),
    subject: v.string(),
    userId: v.id("users"),
    verifiedEmail: v.optional(v.string()),
    linkedAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_issuer_and_subject", ["issuer", "subject"])
    .index("by_userId", ["userId"]),

  roles: defineTable({
    legacyId: v.optional(v.number()),
    name: v.string(),
    normalizedName: v.string(),
    description: v.string(),
    admin: v.boolean(),
    permissions: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_normalizedName", ["normalizedName"]),

  userRoles: defineTable({
    legacyId: v.optional(v.string()),
    userId: v.id("users"),
    roleId: v.id("roles"),
    assignedAt: v.optional(v.number()),
    assignedBy: v.optional(v.id("users")),
  })
    .index("by_legacyId", ["legacyId"])
    .index("by_userId", ["userId"])
    .index("by_roleId", ["roleId"])
    .index("by_userId_and_roleId", ["userId", "roleId"]),

  impersonationSessions: defineTable({
    actorUserId: v.id("users"),
    targetUserId: v.id("users"),
    reason: v.string(),
    startedAt: v.number(),
    endsAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id("users")),
  })
    .index("by_actorUserId_and_startedAt", ["actorUserId", "startedAt"])
    .index("by_targetUserId_and_startedAt", ["targetUserId", "startedAt"]),

  servicePrincipals: defineTable({
    tokenIdentifier: v.string(),
    issuer: v.string(),
    subject: v.string(),
    name: v.string(),
    status: principalStatus,
    permissions: v.array(v.string()),
    cutoverRunId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSeenAt: v.optional(v.number()),
    rotatedAt: v.optional(v.number()),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_issuer_and_subject", ["issuer", "subject"])
    .index("by_status", ["status"]),

  systemState: defineTable({
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
  }).index("by_singletonKey", ["singletonKey"]),

  auditEvents: defineTable({
    actorType: v.union(
      v.literal("user"),
      v.literal("service"),
      v.literal("internal"),
      v.literal("control"),
    ),
    actorUserId: v.optional(v.id("users")),
    servicePrincipalId: v.optional(v.id("servicePrincipals")),
    impersonationSessionId: v.optional(v.id("impersonationSessions")),
    action: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    cutoverRunId: v.optional(v.string()),
    createdAt: v.number(),
    metadata: v.optional(v.record(v.string(), auditValue)),
  })
    .index("by_createdAt", ["createdAt"])
    .index("by_actorUserId_and_createdAt", ["actorUserId", "createdAt"])
    .index("by_servicePrincipalId_and_createdAt", [
      "servicePrincipalId",
      "createdAt",
    ])
    .index("by_cutoverRunId_and_createdAt", ["cutoverRunId", "createdAt"]),

  migrationRuns: defineTable({
    runId: v.string(),
    sourceSchemaFingerprint: v.string(),
    status: migrationRunStatus,
    expectedUsers: v.number(),
    expectedRoles: v.number(),
    expectedUserRoles: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_runId", ["runId"]),

  migrationCheckpoints: defineTable({
    runId: v.string(),
    operation: v.string(),
    status: migrationCheckpointStatus,
    lastLegacyKey: v.optional(v.string()),
    processedCount: v.number(),
    insertedCount: v.number(),
    reusedCount: v.number(),
    updatedAt: v.number(),
  }).index("by_runId_and_operation", ["runId", "operation"]),

  migrationRawUsers: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerifiedAt: v.optional(v.number()),
    image: v.optional(v.string()),
    legacyImpersonatedUserId: v.optional(v.string()),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawRoles: defineTable({
    runId: v.string(),
    legacyId: v.number(),
    name: v.string(),
    description: v.string(),
    admin: v.boolean(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),

  migrationRawUserRoles: defineTable({
    runId: v.string(),
    legacyId: v.string(),
    userLegacyId: v.string(),
    roleLegacyId: v.number(),
    sourceRowHash: v.string(),
  }).index("by_runId_and_legacyId", ["runId", "legacyId"]),
});
