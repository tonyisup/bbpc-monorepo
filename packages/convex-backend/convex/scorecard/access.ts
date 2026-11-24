import type { Id } from "../_generated/dataModel.js";
import type { UserActor } from "../lib/actors.js";
import { domainError } from "../lib/errors.js";

/**
 * Scorecards are private to their owner. There is deliberately no admin
 * branch, and an impersonated session is refused because the actor's `user`
 * is then the impersonated target (lib/actors.ts).
 */
export function requireScorecardOwner(actor: UserActor): Id<"users"> {
  if (actor.impersonationSession !== undefined) {
    domainError("FORBIDDEN", "Scorecards are private to their owner.");
  }
  return actor.user._id;
}
