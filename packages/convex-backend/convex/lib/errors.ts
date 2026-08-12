import { ConvexError } from "convex/values";

import type {
  DomainErrorCode,
  DomainErrorData,
} from "../../contracts/index.js";

type SafeDetailValue = string | number | boolean | null;

interface DomainErrorOptions {
  retryable?: boolean;
  details?: Record<string, SafeDetailValue>;
  incidentId?: string;
}

export function domainError(
  code: DomainErrorCode,
  message: string,
  options: DomainErrorOptions = {},
): never {
  const data: DomainErrorData = {
    code,
    message,
    retryable: options.retryable ?? false,
  };
  if (options.details !== undefined) {
    data.details = options.details;
  }
  if (options.incidentId !== undefined) {
    data.incidentId = options.incidentId;
  }
  throw new ConvexError({ ...data });
}

export function assertDomain(
  condition: unknown,
  code: DomainErrorCode,
  message: string,
  options?: DomainErrorOptions,
): asserts condition {
  if (!condition) {
    domainError(code, message, options);
  }
}
