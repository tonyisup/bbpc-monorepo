import { domainError } from "../lib/errors.js";

export const MAX_SYLLABUS_ENTRIES_PER_USER = 100;
export const MAX_SYLLABUS_NOTES_LENGTH = 5000;
export const MAX_SYLLABUS_ADMIN_PAGE_SIZE = 100;

export function validateSyllabusAdminPageSize(
  numItems: number,
): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_SYLLABUS_ADMIN_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Syllabus page size must be an integer from 1 through ${String(MAX_SYLLABUS_ADMIN_PAGE_SIZE)}.`,
      { details: { limit: MAX_SYLLABUS_ADMIN_PAGE_SIZE } },
    );
  }
}
