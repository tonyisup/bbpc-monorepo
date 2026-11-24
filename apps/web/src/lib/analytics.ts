import type { PostHog } from "posthog-js";

import type { SyllabusInsertPosition } from "@/lib/syllabus";

/**
 * Product events the site sends to PostHog, with their properties.
 *
 * Each event records a completed action, so call `track` only after the
 * write it describes has succeeded. Never put free text a listener typed
 * (feedback, quotes, notes, search queries) or contact details in here.
 */
export interface AnalyticsEvents {
  sign_in_started: { page_path: string };
  feedback_submitted: { category: string; page_path: string | null };
  prediction_submitted: { assignment_id: string; host_id: string; changed: boolean };
  wager_placed: {
    assignment_id: string;
    gambling_type_id: string;
    points: number;
    has_target: boolean;
  };
  quotabunga_submitted: {
    episode_id: string;
    first_entry: boolean;
    source_type: string;
    has_clip: boolean;
    has_notes: boolean;
  };
  quotabunga_withdrawn: { episode_id: string };
  voicemail_sent: { episode_id: string; has_notes: boolean };
  voicemail_deleted: { episode_id: string };
  assignment_audio_sent: { assignment_id: string };
  assignment_audio_deleted: { assignment_id: string };
  syllabus_movie_added: {
    movie_id: string;
    position: SyllabusInsertPosition;
    source: "catalog" | "tmdb";
  };
  syllabus_movie_removed: Record<string, never>;
  syllabus_reordered: { pending_count: number };
  syllabus_notes_saved: { has_notes: boolean };
  extra_added: {
    episode_id: string;
    kind: "movie" | "show";
    source: "catalog" | "tmdb";
  };
  year_ranking_item_saved: { movie_id: string; rank: number };
  year_ranking_item_removed: Record<string, never>;
  year_ranking_reordered: { item_count: number };
  scorecard_viewed: { year: number };
  scorecard_movie_completed: { year: number };
  scorecard_applied_to_list: { item_count: number };
  scorecard_csv_downloaded: { year: number };
  profile_updated: { changed_image: boolean };
  movie_link_preference_saved: { preference: string };
  transcript_searched: {
    query_length: number;
    result_count: number;
    limited: boolean;
  };
  youtube_searched: {
    query_length: number;
    result_count: number;
    page: "first" | "more";
  };
  quote_locate_finished: {
    status: "found" | "not_found";
    candidate_count: number;
  };
}

export type AnalyticsEventName = keyof AnalyticsEvents;

export interface AnalyticsUser {
  appUserId: string;
  isAdmin: boolean;
  isHost: boolean;
}

let client: PostHog | null = null;

/**
 * The PostHog provider registers its client here once it has initialized.
 * Until then, and whenever PostHog is not configured, every call is a no-op.
 */
export function setAnalyticsClient(next: PostHog | null): void {
  client = next;
}

export function track<E extends AnalyticsEventName>(
  event: E,
  properties: AnalyticsEvents[E],
  options: { sendInstantly?: boolean } = {}
): void {
  try {
    client?.capture(
      event,
      properties,
      options.sendInstantly ? { send_instantly: true } : undefined
    );
  } catch {
    // Analytics must never break the action it describes.
  }
}

/** Link this browser's events to the canonical Convex user. */
export function identifyAnalyticsUser(user: AnalyticsUser): void {
  try {
    // Repeating identify for the same user only refreshes the properties.
    client?.identify(user.appUserId, {
      is_admin: user.isAdmin,
      is_host: user.isHost,
    });
  } catch {
    // Analytics must never break sign-in.
  }
}

/** Whether this browser is still linked to a signed-in user. */
export function isAnalyticsUserIdentified(): boolean {
  try {
    return client?._isIdentified() ?? false;
  } catch {
    return false;
  }
}

/** Unlink this browser from the signed-in user, e.g. on sign-out. */
export function resetAnalytics(): void {
  try {
    client?.reset();
  } catch {
    // Analytics must never break sign-out.
  }
}
