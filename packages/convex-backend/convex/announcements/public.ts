import { v } from "convex/values";

import { anonymousQuery } from "../functions.js";
import {
  compareLiveAnnouncements,
  listUnendedAnnouncements,
  MAX_UNENDED_ANNOUNCEMENTS,
  toPublicAnnouncement,
  validateAnnouncementNow,
} from "./model.js";
import { publicAnnouncementValidator } from "./validators.js";

// Queries must not read the wall clock, so the client supplies `now`. Clients
// round it to the minute to share one cached result. Scheduled announcements are
// therefore readable before they start and must not hold secrets.
export const listLive = anonymousQuery({
  args: { now: v.number() },
  returns: v.array(publicAnnouncementValidator),
  handler: async (ctx, args) => {
    const now = validateAnnouncementNow(args.now);
    const unended = await listUnendedAnnouncements(
      ctx,
      now,
      MAX_UNENDED_ANNOUNCEMENTS,
    );
    return unended
      .filter((announcement) => announcement.startsAt <= now)
      .sort(compareLiveAnnouncements)
      .map(toPublicAnnouncement);
  },
});
