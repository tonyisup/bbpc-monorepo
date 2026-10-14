import { z } from "zod";

const quotabungaDraftSchema = z.object({
  /** `updatedAt` of the saved entry being edited, or null for a first entry. */
  basedOn: z.number().nullable(),
  quoteText: z.string(),
  sourceTitle: z.string(),
  sourceType: z.enum(["MOVIE", "TV", "OTHER"]),
  clipUrl: z.string(),
  clipStartSeconds: z.string(),
  clipEndSeconds: z.string(),
  listenerNotes: z.string(),
});

export type QuotabungaDraft = z.infer<typeof quotabungaDraftSchema>;

// The caller's key names one member and one episode, so people sharing a
// browser never see each other's quote and a draft never moves to another round.
function draftStorageKey(draftKey: string): string {
  return `bbpc.quotabungaDraft:${draftKey}`;
}

export function readQuotabungaDraft(draftKey: string): QuotabungaDraft | null {
  try {
    const stored = window.localStorage.getItem(draftStorageKey(draftKey));
    if (stored === null) {
      return null;
    }
    const parsed = quotabungaDraftSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeQuotabungaDraft(draftKey: string, draft: QuotabungaDraft) {
  try {
    window.localStorage.setItem(
      draftStorageKey(draftKey),
      JSON.stringify(draft)
    );
  } catch {
    // The form still holds the quote for this page view.
  }
}

export function clearQuotabungaDraft(draftKey: string) {
  try {
    window.localStorage.removeItem(draftStorageKey(draftKey));
  } catch {
    // Nothing was stored if storage is unavailable.
  }
}
