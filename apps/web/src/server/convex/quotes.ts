import { api } from "@tonyisup/bbpc-convex-api";
import { BBPC_API_VERSION } from "@tonyisup/bbpc-convex-api/contracts";
import "server-only";

import { z } from "zod";

import { fetchMutationForSignedInUser } from "@/server/convex/client";

const videoSearchReservationSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    scope: z.enum(["user", "site"]),
    retryAt: z.number(),
  }),
]);

export type VideoSearchReservation = z.infer<
  typeof videoSearchReservationSchema
>;

/** Spends one Quote Finder search for the listener; null when signed out. */
export async function reserveVideoSearch(): Promise<VideoSearchReservation | null> {
  const result = await fetchMutationForSignedInUser(
    api.games.quotes.reserveVideoSearch,
    { clientApiVersion: BBPC_API_VERSION }
  );
  return result === null ? null : videoSearchReservationSchema.parse(result);
}
