import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { Doc } from "../_generated/dataModel.js";
import type {
  MutationCtx,
  QueryCtx,
} from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import {
  requireCapabilityToken,
  requirePortableId,
} from "./validators.js";

type RecordingDatabaseContext = Pick<
  QueryCtx | MutationCtx,
  "db"
>;

export function digestRecordingCapability(token: string): string {
  return bytesToHex(
    sha256(new TextEncoder().encode(token)),
  );
}

function equalDigest(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |=
      (left.charCodeAt(index) | 0) ^
      (right.charCodeAt(index) | 0);
  }
  return mismatch === 0;
}

export async function requireRecordingParticipant(
  ctx: RecordingDatabaseContext,
  input: {
    publicSessionId: string;
    clientId: string;
    accessToken: string;
  },
): Promise<Doc<"recordingParticipants">> {
  const publicSessionId = requirePortableId(
    input.publicSessionId,
    "Recording session ID",
  );
  const clientId = requirePortableId(
    input.clientId,
    "Recording client ID",
  );
  const accessToken = requireCapabilityToken(
    input.accessToken,
    "Recording access token",
  );
  const participants = await ctx.db
    .query("recordingParticipants")
    .withIndex(
      "by_publicSessionId_and_clientId",
      (query) =>
        query
          .eq("publicSessionId", publicSessionId)
          .eq("clientId", clientId),
    )
    .take(2);
  const participant = participants.at(0);
  if (
    participants.length !== 1 ||
    participant === undefined ||
    !equalDigest(
      participant.accessTokenDigest,
      digestRecordingCapability(accessToken),
    )
  ) {
    domainError(
      "FORBIDDEN",
      "Recording session access is denied.",
    );
  }
  return participant;
}

export async function requireRecordingOwner(
  ctx: RecordingDatabaseContext,
  input: {
    publicSessionId: string;
    clientId: string;
    accessToken: string;
  },
): Promise<Doc<"recordingParticipants">> {
  const participant = await requireRecordingParticipant(
    ctx,
    input,
  );
  if (participant.role !== "owner") {
    domainError(
      "FORBIDDEN",
      "Recording session owner access is required.",
    );
  }
  return participant;
}
