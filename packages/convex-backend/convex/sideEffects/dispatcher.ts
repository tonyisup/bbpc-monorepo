import { v } from "convex/values";

import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";
import {
  env,
  type ActionCtx,
} from "../_generated/server.js";
import { internalReadAction } from "../functions.js";
import {
  type SideEffectErrorCode,
  sideEffectStatusValidator,
} from "./constants.js";

const UPLOADTHING_DELETE_URL =
  "https://api.uploadthing.com/v6/deleteFiles";
const UPLOADTHING_API_VERSION = "7.7.4";
const UPLOADTHING_TIMEOUT_MS = 10_000;

class SafeProviderError extends Error {
  constructor(
    readonly code: SideEffectErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

function uploadThingApiKey(token: string | undefined): string {
  if (token === undefined || token.trim().length === 0) {
    throw new SafeProviderError("configuration_missing", false);
  }

  let payload: unknown;
  try {
    const bytes = Uint8Array.from(
      atob(token.trim()),
      (character) => character.charCodeAt(0),
    );
    payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new SafeProviderError("configuration_missing", false);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !("apiKey" in payload) ||
    typeof payload.apiKey !== "string" ||
    !payload.apiKey.startsWith("sk_")
  ) {
    throw new SafeProviderError("configuration_missing", false);
  }
  return payload.apiKey;
}

export async function deleteUploadThingFileWith(
  providerKey: string,
  token: string | undefined,
  fetcher: typeof fetch,
): Promise<void> {
  const apiKey = uploadThingApiKey(token);
  let response: Response;
  try {
    response = await fetcher(UPLOADTHING_DELETE_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-uploadthing-api-key": apiKey,
        "x-uploadthing-be-adapter": "bbpc-convex",
        "x-uploadthing-version": UPLOADTHING_API_VERSION,
      },
      body: JSON.stringify({ fileKeys: [providerKey] }),
      signal: AbortSignal.timeout(UPLOADTHING_TIMEOUT_MS),
    });
  } catch {
    throw new SafeProviderError("provider_unavailable", true);
  }
  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500;
    throw new SafeProviderError(
      retryable ? "provider_unavailable" : "provider_rejected",
      retryable,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SafeProviderError("provider_unavailable", true);
  }
  requireSuccessfulDelete(payload);
}

export async function deleteUploadThingFile(
  providerKey: string,
): Promise<void> {
  await deleteUploadThingFileWith(
    providerKey,
    env.UPLOADTHING_TOKEN,
    fetch,
  );
}

export function requireSuccessfulDelete(response: unknown): void {
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response) ||
    !("success" in response) ||
    typeof response.success !== "boolean" ||
    !("deletedCount" in response) ||
    typeof response.deletedCount !== "number" ||
    !Number.isFinite(response.deletedCount)
  ) {
    throw new SafeProviderError("provider_unavailable", true);
  }
  if (!response.success) {
    throw new SafeProviderError("provider_rejected", true);
  }
}

function classifyProviderFailure(error: unknown): {
  errorCode: SideEffectErrorCode;
  retryable: boolean;
} {
  if (error instanceof SafeProviderError) {
    return {
      errorCode: error.code,
      retryable: error.retryable,
    };
  }
  return {
    errorCode: "provider_unavailable",
    retryable: true,
  };
}

const dispatchResultValidator = v.object({
  dispatched: v.boolean(),
  status: sideEffectStatusValidator,
});

export async function dispatchUploadThingDeleteWith(
  ctx: Pick<ActionCtx, "runMutation">,
  args: {
    intentId: Id<"sideEffectIntents">;
    cutoverRunId: string;
    clientApiVersion: string;
  },
  deleteFile: (providerKey: string) => Promise<void>,
): Promise<{
  dispatched: boolean;
  status:
    | "pending"
    | "processing"
    | "retryScheduled"
    | "succeeded"
    | "terminal";
}> {
  const common = {
    intentId: args.intentId,
    cutoverRunId: args.cutoverRunId,
    clientApiVersion: args.clientApiVersion,
  };
  const claim = (await ctx.runMutation(
    internal.sideEffects.intents.claimUploadThingDelete,
    common,
  )) as
    | {
        dispatch: false;
        status:
          | "pending"
          | "processing"
          | "retryScheduled"
          | "succeeded"
          | "terminal";
      }
    | {
        dispatch: true;
        providerKey: string;
        attemptCount: number;
      };
  if (!claim.dispatch) {
    return { dispatched: false, status: claim.status };
  }

  try {
    await deleteFile(claim.providerKey);
    const status = await ctx.runMutation(
      internal.sideEffects.intents.recordUploadThingDeleteSuccess,
      {
        ...common,
        attemptCount: claim.attemptCount,
      },
    );
    return { dispatched: true, status };
  } catch (error) {
    const failure = classifyProviderFailure(error);
    const result = (await ctx.runMutation(
      internal.sideEffects.intents.recordUploadThingDeleteFailure,
      {
        ...common,
        attemptCount: claim.attemptCount,
        ...failure,
      },
    )) as {
      status: "retryScheduled" | "terminal";
    };
    return { dispatched: true, status: result.status };
  }
}

export const dispatchUploadThingDelete = internalReadAction({
  args: {
    intentId: v.id("sideEffectIntents"),
    cutoverRunId: v.string(),
    clientApiVersion: v.string(),
  },
  returns: dispatchResultValidator,
  handler: async (ctx, args) =>
    await dispatchUploadThingDeleteWith(
      ctx,
      args,
      deleteUploadThingFile,
    ),
});
