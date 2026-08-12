import { v } from "convex/values";

import { domainError } from "../lib/errors.js";

export const recordingRoleValidator = v.union(
  v.literal("owner"),
  v.literal("participant"),
);

export const recordingStatusValidator = v.union(
  v.literal("active"),
  v.literal("ended"),
);

export const recordingParticipantValidator = v.object({
  clientId: v.string(),
  displayName: v.string(),
  role: recordingRoleValidator,
  joinedAt: v.string(),
});

export const recordingSessionValidator = v.object({
  id: v.string(),
  episodeId: v.union(v.id("episodes"), v.null()),
  episode: v.string(),
  createdAt: v.string(),
  endedAt: v.union(v.string(), v.null()),
  status: recordingStatusValidator,
  participants: v.array(recordingParticipantValidator),
});

const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

function requireBoundedString(
  value: string,
  label: string,
  maximumLength: number,
): string {
  const normalized = value.trim().normalize("NFKC");
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(maximumLength)} characters.`,
    );
  }
  return normalized;
}

export function requirePortableId(
  value: string,
  label: string,
  maximumLength = 100,
): string {
  const normalized = requireBoundedString(
    value,
    label,
    maximumLength,
  );
  if (!PORTABLE_ID.test(normalized)) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a portable identifier.`,
    );
  }
  return normalized;
}

export function requireCapabilityToken(
  value: string,
  label: string,
): string {
  const normalized = requirePortableId(value, label, 256);
  if (normalized.length < 24) {
    domainError(
      "VALIDATION_FAILED",
      `${label} is too short.`,
    );
  }
  return normalized;
}

export function requireDisplayName(value: string): string {
  const normalized = requireBoundedString(
    value.replace(/\s+/gu, " "),
    "Participant display name",
    80,
  );
  if (
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Participant display names cannot contain control characters.",
    );
  }
  return normalized;
}

export function requireEpisodeLabel(value: string): string {
  return requireBoundedString(value, "Episode label", 80);
}

export function requireRecordingTimestamp(
  value: number,
  label: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 8_640_000_000_000_000
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a valid millisecond timestamp.`,
    );
  }
  return value;
}

export function requireBoundedPayload(
  payload: unknown,
  label: string,
  maximumBytes: number,
): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be JSON serializable.`,
    );
  }
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    domainError(
      "VALIDATION_FAILED",
      `${label} exceeds its ${String(maximumBytes)}-byte limit.`,
    );
  }
}
