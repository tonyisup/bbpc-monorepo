import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { z } from "zod";

import { BBPC_API_VERSION } from "@tonyisup/bbpc-convex-api/contracts";

import {
  fetchActionForSignedInUser,
  publicActionReference,
} from "@/server/convex/client";

const f = createUploadthing();
const BBPC_CLIENT_API_VERSION = BBPC_API_VERSION;

const actionGateReference = publicActionReference<{
  clientApiVersion: string;
}>("identity/profile:actionGateProbe");

async function requireConvexUploadAccess() {
  const gate = await fetchActionForSignedInUser(actionGateReference, {
    clientApiVersion: BBPC_CLIENT_API_VERSION,
  });
  if (gate === null) {
    throw new UploadThingError("Unauthorized");
  }
  return {};
}

export const convexFileRouter = {
  imageUploader: f({
    image: { maxFileSize: "4MB", maxFileCount: 1 },
  })
    .middleware(requireConvexUploadAccess)
    .onUploadComplete(async ({ file }) => ({
      uploaded: true as const,
      fileKey: file.key,
    })),

  audioUploader: f({ audio: { maxFileSize: "8MB" } })
    .input(
      z.object({
        episodeId: z.string().optional(),
        assignmentId: z.string().optional(),
      })
    )
    .middleware(requireConvexUploadAccess)
    .onUploadComplete(async ({ file }) => ({
      uploaded: true as const,
      fileKey: file.key,
    })),
} satisfies FileRouter;

export type ConvexFileRouter = typeof convexFileRouter;
