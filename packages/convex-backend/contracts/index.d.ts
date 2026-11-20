import type { GenericId } from "convex/values";

export declare const BBPC_API_VERSION: "0.1.0";

export type BbpcApiVersion = typeof BBPC_API_VERSION;

/** Restore a document ID's table brand after an HTML/validated JSON boundary. */
export declare function documentId<Table extends string, Value extends string | null | undefined>(
  table: Table,
  value: Value,
): Value extends string ? GenericId<Table> : Value;

/** Recording session, client, event and RTC signal identifier format. */
export declare const RECORDING_PORTABLE_ID_PATTERN: RegExp;

export declare function isRecordingPortableId(value: unknown): value is string;

/** File extensions a recording take's track may be stored with. */
export declare const RECORDING_TAKE_EXTENSIONS: readonly ["webm", "ogg", "m4a"];

/** The storage name of one track of one recording take. */
export declare function recordingTakeBlobName(take: {
  sessionId: string;
  clientId: string;
  startedAt: number;
  trackType: "mic" | "sounders";
  extension: (typeof RECORDING_TAKE_EXTENSIONS)[number];
}): string;

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
