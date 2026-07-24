import { domainError } from "../lib/errors.js";

export const MAX_CATALOG_PAGE_SIZE = 50;

export function validateCatalogPageSize(numItems: number): void {
  if (
    !Number.isSafeInteger(numItems) ||
    numItems < 1 ||
    numItems > MAX_CATALOG_PAGE_SIZE
  ) {
    domainError(
      "VALIDATION_FAILED",
      `Catalog page size must be an integer from 1 through ${String(MAX_CATALOG_PAGE_SIZE)}.`,
      { details: { limit: MAX_CATALOG_PAGE_SIZE } },
    );
  }
}
