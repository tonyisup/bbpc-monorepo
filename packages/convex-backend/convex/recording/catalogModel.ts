import { domainError } from "../lib/errors.js";
import { requirePortableId } from "./validators.js";

export interface RecordingSounderInput {
  id: string;
  name: string;
  category: string;
  duration: number;
  url: string;
}

function requireText(
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

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function requireRecordingUrl(
  value: string,
  label: string,
): string {
  const normalized = requireText(value, label, 2_048);
  if (normalized.startsWith("/")) {
    if (
      normalized.startsWith("//") ||
      containsControlCharacter(normalized)
    ) {
      domainError(
        "VALIDATION_FAILED",
        `${label} must be a safe relative URL or an HTTPS URL.`,
      );
    }
    return normalized;
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a safe relative URL or an HTTPS URL.`,
    );
  }
  if (parsed.protocol !== "https:") {
    domainError(
      "VALIDATION_FAILED",
      `${label} must be a safe relative URL or an HTTPS URL.`,
    );
  }
  return parsed.toString();
}

export function requireRecordingSounder(
  input: RecordingSounderInput,
) {
  if (
    !Number.isSafeInteger(input.duration) ||
    input.duration < 0 ||
    input.duration > 3_600_000
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Sounder durations must be integer milliseconds from 0 through 3600000.",
    );
  }
  return {
    sounderId: requirePortableId(
      input.id,
      "Sounder ID",
      160,
    ),
    name: requireText(input.name, "Sounder name", 200),
    category: requireText(
      input.category,
      "Sounder category",
      100,
    ),
    duration: input.duration,
    url: requireRecordingUrl(input.url, "Sounder URL"),
  };
}

export function requireRecordingBlobName(value: string): string {
  const blobName = requireText(value, "Sounder blob name", 1_024);
  if (containsControlCharacter(blobName)) {
    domainError(
      "VALIDATION_FAILED",
      "Sounder blob names cannot contain control characters.",
    );
  }
  return blobName;
}

export function requireContentType(value: string): string {
  return requireText(value, "Sounder content type", 100);
}

export function requireFileSize(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 1_073_741_824
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Sounder sizes must be integer bytes from 0 through 1073741824.",
    );
  }
  return value;
}

export function requireTemplateLabel(value: string): string {
  return requireText(value, "Segment template label", 200);
}

export function requireOptionalSounderBlobName(
  value: string | undefined,
): string | undefined {
  return value === undefined
    ? undefined
    : requireRecordingBlobName(value);
}

export function requireSortOrder(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 10_000
  ) {
    domainError(
      "VALIDATION_FAILED",
      "Recording sort orders must be integers from 0 through 10000.",
    );
  }
  return value;
}
