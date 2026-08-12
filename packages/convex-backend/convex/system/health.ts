import { BBPC_API_VERSION } from "../../contracts/index.js";
import { v } from "convex/values";
import {
  adminMutation,
  anonymousQuery,
  authenticatedMutation,
  pipelineMutation,
  recordingMutation,
} from "../functions.js";
import { domainError } from "../lib/errors.js";
import { cutoverStageValidator } from "../lib/validators.js";
import { getSystemState } from "../lib/writeGate.js";

export const readiness = anonymousQuery({
  args: {},
  returns: v.object({
    apiVersion: v.string(),
    initialized: v.boolean(),
    applicationWritesEnabled: v.boolean(),
    cutoverStage: v.union(
      v.literal("uninitialized"),
      cutoverStageValidator,
    ),
    firstApplicationWriteRecorded: v.boolean(),
  }),
  handler: async (ctx) => {
    const state = await getSystemState(ctx);
    return {
      apiVersion: BBPC_API_VERSION,
      initialized: state !== null,
      applicationWritesEnabled:
        state?.applicationWriteMode === "enabled",
      cutoverStage:
        state?.cutoverStage ?? ("uninitialized" as const),
      firstApplicationWriteRecorded:
        state?.firstApplicationWriteAt !== undefined,
    };
  },
});

export const applicationWriteGateProbe = recordingMutation({
  args: {},
  returns: v.null(),
  handler: async () => rejectNonWritingProbe(),
});

function rejectNonWritingProbe(): never {
  domainError(
    "VALIDATION_FAILED",
    "The application write-gate probe never performs writes.",
  );
}

export const memberWriteGateProbe = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async () => rejectNonWritingProbe(),
});

export const administratorWriteGateProbe = adminMutation({
  args: {},
  returns: v.null(),
  handler: async () => rejectNonWritingProbe(),
});

export const pipelineWriteGateProbe = pipelineMutation({
  args: {},
  returns: v.null(),
  handler: async () => rejectNonWritingProbe(),
});
