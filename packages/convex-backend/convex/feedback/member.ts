import { authenticatedMutation } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import {
  assertFeedbackRateLimit,
  validateFeedbackMessage,
  validateFeedbackPagePath,
} from "./model.js";
import {
  feedbackSubmitFields,
  feedbackSubmitResultValidator,
} from "./validators.js";

// Feedback is attributed to the signed-in person, not to a member an
// administrator is impersonating, so a test submission never speaks for them.
export const submit = authenticatedMutation({
  args: feedbackSubmitFields,
  returns: feedbackSubmitResultValidator,
  handler: async (ctx, args) => {
    const message = validateFeedbackMessage(args.message);
    const pagePath = validateFeedbackPagePath(args.pagePath);
    const submittedByUserId = ctx.actor.authenticatedUser._id;
    const now = Date.now();
    await assertFeedbackRateLimit(ctx, submittedByUserId, now);
    const id = await ctx.db.insert("feedback", {
      category: args.category,
      message,
      ...(pagePath === null ? {} : { pagePath }),
      status: "new",
      submittedByUserId,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "feedback.member.submitted",
      targetType: "feedback",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { category: args.category },
    });
    return { id, createdAt: now };
  },
});
