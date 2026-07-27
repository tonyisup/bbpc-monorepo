import { v } from "convex/values";

export const SIDE_EFFECT_OPERATION = "uploadthing.deleteFile" as const;
export const SIDE_EFFECT_MAX_ATTEMPTS = 5;
export const SIDE_EFFECT_LEASE_MS = 5 * 60 * 1000;
export const SIDE_EFFECT_MAX_PROVIDER_KEY_LENGTH = 1024;

export const sideEffectResourceTypeValidator = v.union(
  v.literal("episodeAudioMessage"),
  v.literal("assignmentAudioMessage"),
  v.literal("profileImage"),
);

export const sideEffectStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("retryScheduled"),
  v.literal("succeeded"),
  v.literal("terminal"),
);

export const sideEffectErrorCodeValidator = v.union(
  v.literal("configuration_missing"),
  v.literal("provider_rejected"),
  v.literal("provider_unavailable"),
);

export type SideEffectResourceType =
  | "episodeAudioMessage"
  | "assignmentAudioMessage"
  | "profileImage";

export type SideEffectStatus =
  | "pending"
  | "processing"
  | "retryScheduled"
  | "succeeded"
  | "terminal";

export type SideEffectErrorCode =
  | "configuration_missing"
  | "provider_rejected"
  | "provider_unavailable";

export function retryDelayForAttempt(attemptCount: number): number {
  if (attemptCount <= 1) {
    return 60 * 1000;
  }
  if (attemptCount === 2) {
    return 5 * 60 * 1000;
  }
  if (attemptCount === 3) {
    return 30 * 60 * 1000;
  }
  return 2 * 60 * 60 * 1000;
}
