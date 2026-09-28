import { api } from "@tonyisup/bbpc-convex-api";
import { BBPC_API_VERSION } from "@tonyisup/bbpc-convex-api/contracts";
import "server-only";

import { z } from "zod";

import { fetchMutationForSignedInUser } from "@/server/convex/client";

const reservationSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({
    ok: z.literal(false),
    scope: z.enum(["user", "site"]),
    retryAt: z.number(),
  }),
]);

export type BudgetReservation = z.infer<typeof reservationSchema>;

/** Spends one Quote Finder search for the listener; null when signed out. */
export async function reserveVideoSearch(): Promise<BudgetReservation | null> {
  const result = await fetchMutationForSignedInUser(
    api.games.quotes.reserveVideoSearch,
    { clientApiVersion: BBPC_API_VERSION }
  );
  return result === null ? null : reservationSchema.parse(result);
}

/**
 * Spends one Quote Finder assistant run for the listener; null when signed
 * out. The server key proves the locate route asked, not a browser.
 */
export async function reserveQuoteLocate(
  serverKey: string
): Promise<BudgetReservation | null> {
  const result = await fetchMutationForSignedInUser(
    api.games.quotes.reserveQuoteLocate,
    { clientApiVersion: BBPC_API_VERSION, serverKey }
  );
  return result === null ? null : reservationSchema.parse(result);
}
