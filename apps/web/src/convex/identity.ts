"use client";

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

const meReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("identity/profile:me");

const linkOrCreateMeReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string },
  unknown
>("identity/linking:linkOrCreateMe");

const updateMyNameReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; name: string },
  unknown
>("identity/profile:updateMyName");

const actionGateReference = makeFunctionReference<
  "action",
  { clientApiVersion: string },
  unknown
>("identity/profile:actionGateProbe");

const updateMyProfileWithImageReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    name: string;
    image: string;
    fileKey: string;
    uploadId: string;
    expectedImage: string | null;
  },
  unknown
>("identity/profile:updateMyProfileWithImage");

const discardMyProfileImageUploadReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    fileKey: string;
    uploadId: string;
  },
  unknown
>("identity/profile:discardMyProfileImageUpload");

const updateMyNameResultSchema = z.object({
  name: z.string(),
  updatedAt: z.number(),
});

const actionGateResultSchema = z.object({
  allowed: z.literal(true),
  cutoverStage: z.enum(["S0", "S1", "S2", "S3", "S4"]),
  isAdmin: z.boolean(),
});

const updateProfileWithImageResultSchema = z.object({
  name: z.string(),
  image: z.string().url(),
  updatedAt: z.number(),
});

const discardProfileImageResultSchema = z.object({
  queued: z.literal(true),
  intentId: z.string().min(1),
});

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
    return identityProfileSchema.parse(await client.query(meReference, {}));
  } catch (error) {
    if (getConvexDomainErrorCode(error) !== "IDENTITY_NOT_LINKED") {
      throw error;
    }
  }

  return identityLinkResultSchema.parse(
    await client.mutation(linkOrCreateMeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
    })
  );
}

export async function updateConvexProfileName(
  client: ConvexReactClient,
  name: string
) {
  return updateMyNameResultSchema.parse(
    await client.mutation(updateMyNameReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      name,
    })
  );
}

export async function assertConvexProfileImageUploadAllowed(
  client: ConvexReactClient
) {
  return actionGateResultSchema.parse(
    await client.action(actionGateReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
    })
  );
}

export async function updateConvexProfileWithImage(
  client: ConvexReactClient,
  input: {
    name: string;
    image: string;
    fileKey: string;
    uploadId: string;
    expectedImage: string | null;
  }
) {
  return updateProfileWithImageResultSchema.parse(
    await client.mutation(updateMyProfileWithImageReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function discardConvexProfileImageUpload(
  client: ConvexReactClient,
  input: { fileKey: string; uploadId: string }
) {
  return discardProfileImageResultSchema.parse(
    await client.mutation(discardMyProfileImageUploadReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}
