import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { z } from "zod";

export const BBPC_CLIENT_API_VERSION = "0.1.0";

const identityProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  isAdmin: z.boolean(),
  isHost: z.boolean(),
});

const identityLinkResultSchema = identityProfileSchema.extend({
  linkMode: z.enum(["alreadyLinked", "existingUser", "newUser"]),
});

const domainErrorSchema = z.object({
  code: z.enum([
    "AUTHENTICATION_REQUIRED",
    "IDENTITY_NOT_LINKED",
    "IDENTITY_CONFLICT",
    "ACCOUNT_DISABLED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "VALIDATION_FAILED",
    "WRITE_DISABLED",
    "STALE_CLIENT",
    "SERVICE_UNAVAILABLE",
    "INTERNAL_ERROR",
  ]),
});

const administratorMeReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("identity/profile:administratorMe");

const linkOrCreateMeReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string },
  unknown
>("identity/linking:linkOrCreateMe");

export type ConvexIdentityProfile = z.infer<typeof identityProfileSchema>;
export type ConvexIdentityIssue =
  | "account-disabled"
  | "identity-conflict"
  | "linking-disabled"
  | "stale-client"
  | "unavailable";

export function getConvexDomainErrorCode(error: unknown) {
  if (!(error instanceof ConvexError)) {
    return null;
  }
  const parsed = domainErrorSchema.safeParse(error.data);
  return parsed.success ? parsed.data.code : null;
}

export function getConvexIdentityIssue(error: unknown): ConvexIdentityIssue {
  switch (getConvexDomainErrorCode(error)) {
    case "ACCOUNT_DISABLED":
      return "account-disabled";
    case "IDENTITY_CONFLICT":
      return "identity-conflict";
    case "WRITE_DISABLED":
      return "linking-disabled";
    case "STALE_CLIENT":
      return "stale-client";
    default:
      return "unavailable";
  }
}

export async function resolveConvexIdentity(
  client: ConvexReactClient
): Promise<ConvexIdentityProfile> {
  try {
    return identityProfileSchema.parse(
      await client.query(administratorMeReference, {})
    );
  } catch (error) {
    if (getConvexDomainErrorCode(error) !== "IDENTITY_NOT_LINKED") {
      throw error;
    }
  }

  identityLinkResultSchema.parse(
    await client.mutation(linkOrCreateMeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
    })
  );
  return identityProfileSchema.parse(
    await client.query(administratorMeReference, {})
  );
}
