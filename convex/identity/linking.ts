import { identityLinkMutation } from "../functions.js";
import { requireUserActor } from "../lib/actors.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import { linkOrCreateIdentity } from "./linkingWriteModel.js";
import { identityLinkResultValidator } from "./validators.js";

export const linkOrCreateMe = identityLinkMutation({
  args: {},
  returns: identityLinkResultValidator,
  handler: async (ctx) => {
    const result = await linkOrCreateIdentity(
      ctx,
      ctx.identity,
    );
    const actor = await requireUserActor(ctx);
    if (actor.user._id !== result.userId) {
      domainError(
        "IDENTITY_CONFLICT",
        "The linked BBPC account changed during identity resolution.",
      );
    }
    if (result.linkMode !== "alreadyLinked") {
      await writeAuditEvent(ctx, {
        actor,
        action: "identity.linked",
        targetType: "user",
        targetId: actor.user._id,
        cutoverRunId: ctx.systemState.cutoverRunId,
        metadata: {
          linkMode: result.linkMode,
        },
      });
    }
    return {
      id: actor.user._id,
      name: actor.user.name ?? null,
      email: actor.user.email ?? null,
      image: actor.user.image ?? null,
      isAdmin: actor.isAdmin,
      linkMode: result.linkMode,
    };
  },
});
