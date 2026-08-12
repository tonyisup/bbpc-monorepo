"use client";

import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import {
  BBPC_CLIENT_API_VERSION,
  getConvexDomainErrorCode,
} from "./identity";

const impersonationSessionSchema = z.object({
  id: z.string().min(1),
  targetUserId: z.string().min(1),
  targetName: z.string().nullable(),
  reason: z.string(),
  startedAt: z.number(),
  endsAt: z.number(),
});

const currentReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("identity/impersonation:current");

const revokeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    sessionId: string;
  },
  unknown
>("identity/impersonation:revoke");

const revokeResultSchema = z.object({
  revoked: z.boolean(),
  revokedAt: z.number().nullable(),
});

export type ConvexImpersonationSession = z.infer<
  typeof impersonationSessionSchema
>;

export async function loadCurrentConvexImpersonation(
  client: ConvexReactClient
): Promise<ConvexImpersonationSession | null> {
  try {
    const result = await client.query(currentReference, {});
    return result === null
      ? null
      : impersonationSessionSchema.parse(result);
  } catch (error) {
    if (getConvexDomainErrorCode(error) === "FORBIDDEN") {
      return null;
    }
    throw error;
  }
}

export async function revokeConvexImpersonation(
  client: ConvexReactClient,
  sessionId: string
): Promise<void> {
  revokeResultSchema.parse(
    await client.mutation(revokeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      sessionId,
    })
  );
}
