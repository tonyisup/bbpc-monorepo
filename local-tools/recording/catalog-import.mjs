import { createHash } from "node:crypto";
import { URL } from "node:url";

const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const SEGMENT_TYPES = new Set([
  "intro",
  "segment",
  "ad",
  "outro",
  "news",
  "interview",
]);

function text(value, label, maximumLength) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const normalized = value.trim().normalize("NFKC");
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength
  ) {
    throw new Error(`${label} is outside its size bound`);
  }
  return normalized;
}

function portableId(value, label, maximumLength) {
  const normalized = text(value, label, maximumLength);
  if (!PORTABLE_ID.test(normalized)) {
    throw new Error(`${label} is not portable`);
  }
  return normalized;
}

function safeBlobName(value, label) {
  const normalized = text(value, label, 1_024);
  if (
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new Error(`${label} contains a control character`);
  }
  return normalized;
}

function safeUrl(value) {
  const normalized = text(value, "Sounder URL", 2_048);
  if (normalized.startsWith("/")) {
    if (normalized.startsWith("//")) {
      throw new Error("Sounder URL is not a safe relative URL");
    }
    return normalized;
  }
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:") {
    throw new Error("Sounder URL must use HTTPS");
  }
  return parsed.toString();
}

function integer(value, label, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} is outside its numeric bound`);
  }
  return value;
}

export function canonicalizeRecordingCatalogs(
  rawSounders,
  rawTemplates,
) {
  if (!Array.isArray(rawSounders) || rawSounders.length > 1_000) {
    throw new Error("Sounder source exceeds its migration bound");
  }
  if (!Array.isArray(rawTemplates) || rawTemplates.length > 100) {
    throw new Error("Template source exceeds its migration bound");
  }
  const sounders = rawSounders.map((raw, sortOrder) => ({
    id: portableId(raw.id, "Sounder ID", 160),
    blobName: safeBlobName(raw.blobName, "Sounder blob name"),
    name: text(raw.name, "Sounder name", 200),
    category: text(raw.category, "Sounder category", 100),
    url: safeUrl(raw.url),
    duration: integer(
      raw.duration,
      "Sounder duration",
      0,
      3_600_000,
    ),
    size: integer(
      raw.size,
      "Sounder size",
      0,
      1_073_741_824,
    ),
    contentType: text(
      raw.contentType,
      "Sounder content type",
      100,
    ),
    sortOrder,
  }));
  const templates = rawTemplates.map((raw, index) => {
    if (!SEGMENT_TYPES.has(raw.type)) {
      throw new Error("Segment template type is invalid");
    }
    const introSounder =
      typeof raw.introSounder === "string"
        ? safeBlobName(
            raw.introSounder,
            "Template intro sounder",
          )
        : undefined;
    const outroSounder =
      typeof raw.outroSounder === "string"
        ? safeBlobName(
            raw.outroSounder,
            "Template outro sounder",
          )
        : undefined;
    return {
      id: portableId(raw.id, "Segment template ID", 160),
      label: text(raw.label, "Segment template label", 200),
      type: raw.type,
      ...(introSounder === undefined
        ? {}
        : { introSounder }),
      ...(outroSounder === undefined
        ? {}
        : { outroSounder }),
      sortOrder: integer(
        raw.sortOrder ?? index,
        "Segment template sort order",
        0,
        10_000,
      ),
    };
  });
  if (
    new Set(sounders.map((sounder) => sounder.id)).size !==
      sounders.length ||
    new Set(sounders.map((sounder) => sounder.blobName)).size !==
      sounders.length ||
    new Set(templates.map((template) => template.id)).size !==
      templates.length
  ) {
    throw new Error(
      "Recording catalog source contains duplicate keys",
    );
  }
  return { sounders, templates };
}

export function recordingCatalogDigest(catalogs) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(catalogs))
    .digest("hex")}`;
}

export function recordingCatalogImportPayload(
  catalogs,
  sourceObservedAt,
) {
  return {
    sourceObservedAt,
    sourceDigest: recordingCatalogDigest(catalogs),
    sounders: catalogs.sounders.map((sounder) => {
      const imported = { ...sounder };
      delete imported.sortOrder;
      return imported;
    }),
    templates: catalogs.templates,
  };
}
