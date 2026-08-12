import "server-only";

import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { ConvexError } from "convex/values";
import { z } from "zod";

import { fetchQueryForSignedInUser, publicQueryReference } from "./client";

const hasWonForEpisodeReference = publicQueryReference<{
  episodeId: string;
}>("games/gambling:hasWonForEpisode");

const optionalAccountErrorSchema = z.object({
  code: z.enum([
    "AUTHENTICATION_REQUIRED",
    "IDENTITY_NOT_LINKED",
    "IDENTITY_CONFLICT",
    "ACCOUNT_DISABLED",
  ]),
});

export async function hasSignedInUserWonForEpisode(
  episodeId: string
): Promise<boolean> {
  try {
    const result = await fetchQueryForSignedInUser(hasWonForEpisodeReference, {
      episodeId,
    });
    return result === null ? false : z.boolean().parse(result);
  } catch (error) {
    if (isClerkAPIResponseError(error) && error.status === 404) {
      return false;
    }
    if (
      error instanceof ConvexError &&
      optionalAccountErrorSchema.safeParse(error.data).success
    ) {
      return false;
    }
    throw error;
  }
}
