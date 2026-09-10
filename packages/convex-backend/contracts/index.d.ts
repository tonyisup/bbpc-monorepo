import type { GenericId } from "convex/values";

export declare const BBPC_API_VERSION: "0.1.0";

export type BbpcApiVersion = typeof BBPC_API_VERSION;

/** Restore a document ID's table brand after an HTML/validated JSON boundary. */
export declare function documentId<Table extends string, Value extends string | null | undefined>(
  table: Table,
  value: Value,
): Value extends string ? GenericId<Table> : Value;

export type DomainErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "IDENTITY_NOT_LINKED"
  | "IDENTITY_CONFLICT"
  | "ACCOUNT_DISABLED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_FAILED"
  | "WRITE_DISABLED"
  | "STALE_CLIENT"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface DomainErrorData {
  code: DomainErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, string | number | boolean | null>;
  incidentId?: string;
}
