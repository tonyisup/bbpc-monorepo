import { domainError } from "./errors.js";

export function normalizeLookupKey(
  value: string,
  label: string,
): string {
  const normalized = value.trim().normalize("NFKC").toLowerCase();
  if (normalized.length === 0) {
    domainError(
      "VALIDATION_FAILED",
      `${label} cannot be blank after normalization.`,
    );
  }
  return normalized;
}

export function normalizeEmail(value: string): string {
  return normalizeLookupKey(value, "Email");
}
