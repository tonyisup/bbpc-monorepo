import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { domainError } from "../lib/errors.js";
import { isPublishedEpisode } from "../lib/transcriptVisibility.js";
import {
  MAX_QUOTE_REUSE_PASSAGES_PER_EPISODE,
  MAX_QUOTE_SIMILARITY_CANDIDATES_PER_SEARCH,
  MAX_QUOTE_SUBMISSIONS_PER_EPISODE,
  MAX_QUOTE_TRANSCRIPT_CANDIDATES_FOR_ADMIN,
  MAX_QUOTE_TRANSCRIPT_CANDIDATES_FOR_MEMBER,
  MAX_QUOTE_TRANSCRIPT_MATCHES_FOR_MEMBER,
} from "./limits.js";
import {
  REUSE_EVIDENCE_FLOOR,
  combineReuseLikelihoods,
  quoteSearchAnchors,
  quoteTextSimilarity,
  sourceTitlesPossiblyMatch,
  submissionEvidenceIsDistinct,
  submissionReuseLikelihood,
  transcriptEvidenceIsDistinct,
  transcriptMatchThreshold,
  transcriptQuoteMatch,
  transcriptReuseLikelihood,
  transcriptSearchQuery,
} from "./quoteSimilarity.js";
import type {
  quoteAdminSubmissionValidator,
  quoteEpisodeValidator,
  quoteMemberSubmissionValidator,
  quoteReusePassageValidator,
  quoteReuseReportValidator,
  quoteReuseSubmissionValidator,
  quoteTranscriptMatchValidator,
} from "./validators.js";

type QuoteReadContext = Pick<QueryCtx, "db">;
type QuoteEpisode = Infer<typeof quoteEpisodeValidator>;
type QuoteMemberSubmission = Infer<
  typeof quoteMemberSubmissionValidator
>;
type QuoteAdminSubmission = Infer<
  typeof quoteAdminSubmissionValidator
>;
type QuoteTranscriptMatch = Infer<typeof quoteTranscriptMatchValidator>;
type QuoteReuseReport = Infer<typeof quoteReuseReportValidator>;
type QuoteReuseSubmission = Infer<typeof quoteReuseSubmissionValidator>;
type QuoteReusePassage = Infer<typeof quoteReusePassageValidator>;

export function toQuoteEpisode(
  episode: Doc<"episodes">,
): QuoteEpisode {
  return {
    id: episode._id,
    number: episode.number,
    title: episode.title,
    status: episode.status ?? null,
  };
}

export function toMemberQuoteSubmission(
  submission: Doc<"quoteSubmissions">,
): QuoteMemberSubmission {
  return {
    id: submission._id,
    quoteText: submission.quoteText,
    sourceTitle: submission.sourceTitle,
    sourceType: submission.sourceType,
    clipUrl: submission.clipUrl ?? null,
    clipStartSeconds: submission.clipStartSeconds ?? null,
    clipEndSeconds: submission.clipEndSeconds ?? null,
    listenerNotes: submission.listenerNotes ?? null,
    status: submission.status,
    bracketOrder: submission.bracketOrder ?? null,
    placement: submission.placement ?? null,
    scored: submission.pointId !== undefined,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  };
}

export async function requireQuoteSubmission(
  ctx: QuoteReadContext,
  id: Id<"quoteSubmissions">,
): Promise<Doc<"quoteSubmissions">> {
  const submission = await ctx.db.get("quoteSubmissions", id);
  if (submission === null) {
    domainError("NOT_FOUND", "The quote submission is unavailable.");
  }
  return submission;
}

export async function requireQuoteEpisode(
  ctx: QuoteReadContext,
  id: Id<"episodes">,
): Promise<Doc<"episodes">> {
  const episode = await ctx.db.get("episodes", id);
  if (episode === null) {
    domainError("NOT_FOUND", "The quote episode is unavailable.");
  }
  return episode;
}

export async function findQuoteForEpisodeUser(
  ctx: QuoteReadContext,
  episodeId: Id<"episodes">,
  userId: Id<"users">,
): Promise<Doc<"quoteSubmissions"> | null> {
  return await ctx.db
    .query("quoteSubmissions")
    .withIndex("by_episodeId_and_userId", (index) =>
      index.eq("episodeId", episodeId).eq("userId", userId),
    )
    .unique();
}

/**
 * The episode Quotabunga entries belong to: the newest episode that is next
 * or recording. Whether it still accepts entries is a separate question the
 * shared round window answers.
 */
export async function findSubmissionEpisode(
  ctx: QuoteReadContext,
): Promise<Doc<"episodes"> | null> {
  const candidates = await Promise.all(
    (["next", "recording"] as const).map(async (status) => {
      return await ctx.db
        .query("episodes")
        .withIndex("by_status_and_number", (index) =>
          index.eq("status", status),
        )
        .order("desc")
        .first();
    }),
  );
  let selected: Doc<"episodes"> | null = null;
  for (const candidate of candidates) {
    if (
      candidate !== null &&
      (selected === null || candidate.number > selected.number)
    ) {
      selected = candidate;
    }
  }
  return selected;
}

export async function listQuoteSubmissionsForEpisode(
  ctx: QuoteReadContext,
  episodeId: Id<"episodes">,
): Promise<Array<Doc<"quoteSubmissions">>> {
  const submissions = await ctx.db
    .query("quoteSubmissions")
    .withIndex(
      "by_episodeId_and_bracketOrder_and_createdAt",
      (index) => index.eq("episodeId", episodeId),
    )
    .take(MAX_QUOTE_SUBMISSIONS_PER_EPISODE + 1);
  if (submissions.length > MAX_QUOTE_SUBMISSIONS_PER_EPISODE) {
    domainError(
      "CONFLICT",
      "Quote submissions exceed the supported episode limit.",
      { details: { limit: MAX_QUOTE_SUBMISSIONS_PER_EPISODE } },
    );
  }
  return submissions;
}

export async function hydrateAdminQuoteSubmission(
  ctx: QueryCtx,
  submission: Doc<"quoteSubmissions">,
): Promise<QuoteAdminSubmission> {
  const [user, episode, season, point] = await Promise.all([
    ctx.db.get("users", submission.userId),
    ctx.db.get("episodes", submission.episodeId),
    ctx.db.get("seasons", submission.seasonId),
    submission.pointId === undefined
      ? null
      : ctx.db.get("points", submission.pointId),
  ]);
  if (user === null || episode === null || season === null) {
    domainError(
      "CONFLICT",
      "Quote submission has a missing canonical relationship.",
      { details: { quoteSubmissionId: submission._id } },
    );
  }
  if (submission.pointId !== undefined) {
    if (point === null) {
      domainError(
        "CONFLICT",
        "Quote submission has a missing award point.",
        { details: { quoteSubmissionId: submission._id } },
      );
    }
    if (
      point.userId !== submission.userId ||
      point.seasonId !== submission.seasonId
    ) {
      domainError(
        "CONFLICT",
        "Quote award point belongs to a different user or season.",
        { details: { quoteSubmissionId: submission._id } },
      );
    }
  }
  return {
    ...toMemberQuoteSubmission(submission),
    userId: user._id,
    episodeId: episode._id,
    seasonId: season._id,
    adminNotes: submission.adminNotes ?? null,
    user: adminUser(user, user._id),
    episode: toQuoteEpisode(episode),
    season: { id: season._id, title: season.title },
    point:
      point === null
        ? null
        : {
            id: point._id,
            adjustment: point.adjustment,
            reason: point.reason ?? null,
          },
  };
}

/**
 * Find stored submissions whose quote text shares the quote's rarest words. The
 * last result of each search that hit its limit is returned too, so callers can
 * tell whether relevant candidates may have been cut off.
 */
export async function searchQuoteSubmissionCandidates(
  ctx: QuoteReadContext,
  quoteText: string,
): Promise<{
  candidates: Array<Doc<"quoteSubmissions">>;
  cutoffs: Array<Doc<"quoteSubmissions">>;
}> {
  const anchors = quoteSearchAnchors(quoteText);
  if (anchors.length === 0) {
    return { candidates: [], cutoffs: [] };
  }
  const searchQueries = [...new Set([anchors.join(" "), ...anchors])];
  const groups = await Promise.all(
    searchQueries.map(async (searchQuery) => {
      return await ctx.db
        .query("quoteSubmissions")
        .withSearchIndex("search_quoteText", (search) =>
          search.search("quoteText", searchQuery),
        )
        .take(MAX_QUOTE_SIMILARITY_CANDIDATES_PER_SEARCH);
    }),
  );
  const candidates = new Map(
    groups.flat().map((submission) => [submission._id, submission]),
  );
  return {
    candidates: [...candidates.values()],
    cutoffs: groups.flatMap((group) => {
      const last = group.at(-1);
      return group.length === MAX_QUOTE_SIMILARITY_CANDIDATES_PER_SEARCH &&
        last !== undefined
        ? [last]
        : [];
    }),
  };
}

/** Find transcript passages that share the most words with a quote. */
async function searchTranscriptCandidates(
  ctx: QuoteReadContext,
  quoteText: string,
  options: { publicOnly: boolean; limit: number },
): Promise<{
  passages: Array<Doc<"transcriptPassages">>;
  cutoff: Doc<"transcriptPassages"> | null;
}> {
  const query = transcriptSearchQuery(quoteText);
  if (query === null) {
    return { passages: [], cutoff: null };
  }
  const passages = await ctx.db
    .query("transcriptPassages")
    .withSearchIndex("search_text", (search) =>
      options.publicOnly
        ? search.search("text", query).eq("isPublic", true)
        : search.search("text", query),
    )
    .take(options.limit);
  return {
    passages,
    cutoff: passages.length === options.limit ? (passages.at(-1) ?? null) : null,
  };
}

async function loadEpisodes(
  ctx: QuoteReadContext,
  episodeIds: Iterable<Id<"episodes">>,
): Promise<Map<Id<"episodes">, Doc<"episodes">>> {
  const episodes = await Promise.all(
    [...new Set(episodeIds)].map(
      async (episodeId) => await ctx.db.get("episodes", episodeId),
    ),
  );
  return new Map(
    episodes.flatMap((episode) =>
      episode === null ? [] : [[episode._id, episode] as const],
    ),
  );
}

/** Published episodes whose transcript contains something close to the quote. */
export async function findPublicTranscriptMatches(
  ctx: QuoteReadContext,
  quoteText: string,
): Promise<QuoteTranscriptMatch[]> {
  const { passages } = await searchTranscriptCandidates(ctx, quoteText, {
    publicOnly: true,
    limit: MAX_QUOTE_TRANSCRIPT_CANDIDATES_FOR_MEMBER,
  });
  const threshold = transcriptMatchThreshold(quoteText);
  const bestByEpisode = new Map<
    Id<"episodes">,
    { passage: Doc<"transcriptPassages">; similarity: number; excerpt: string }
  >();
  for (const passage of passages) {
    const match = transcriptQuoteMatch(quoteText, passage.text);
    if (match === null || match.similarity < threshold) {
      continue;
    }
    const current = bestByEpisode.get(passage.episodeId);
    if (current === undefined || match.similarity > current.similarity) {
      bestByEpisode.set(passage.episodeId, { passage, ...match });
    }
  }
  const episodes = await loadEpisodes(ctx, bestByEpisode.keys());
  const ranked: Array<{ match: QuoteTranscriptMatch; similarity: number }> =
    [];
  for (const [episodeId, best] of bestByEpisode) {
    const episode = episodes.get(episodeId) ?? null;
    // The index flag can trail an unpublish, so read canonical visibility here too.
    if (episode === null || !isPublishedEpisode(episode)) {
      continue;
    }
    ranked.push({
      match: {
        episodeNumber: episode.number,
        episodeTitle: episode.title,
        episodeSlug: episode.slug ?? null,
        start: best.passage.start,
        excerpt: best.excerpt,
      },
      similarity: best.similarity,
    });
  }
  return ranked
    .sort(
      (left, right) =>
        right.similarity - left.similarity ||
        right.match.episodeNumber - left.match.episodeNumber,
    )
    .slice(0, MAX_QUOTE_TRANSCRIPT_MATCHES_FOR_MEMBER)
    .map(({ match }) => match);
}

function adminUser(user: Doc<"users"> | null, userId: Id<"users">) {
  return {
    id: userId,
    name: user?.name ?? null,
    email: user?.email ?? null,
    image: user?.image ?? null,
  };
}

/**
 * Estimate whether a submission's quote was used on an earlier episode, from similar
 * earlier submissions and from earlier transcripts. Only episodes numbered before the
 * submission's own episode count, since the quote is expected to appear in its own.
 */
export async function buildQuoteReuseReport(
  ctx: QuoteReadContext,
  submission: Doc<"quoteSubmissions">,
): Promise<QuoteReuseReport> {
  const [subjectEpisode, subjectUser, submissionSearch, transcriptSearch] =
    await Promise.all([
      ctx.db.get("episodes", submission.episodeId),
      ctx.db.get("users", submission.userId),
      searchQuoteSubmissionCandidates(ctx, submission.quoteText),
      searchTranscriptCandidates(ctx, submission.quoteText, {
        publicOnly: false,
        limit: MAX_QUOTE_TRANSCRIPT_CANDIDATES_FOR_ADMIN,
      }),
    ]);
  if (subjectEpisode === null) {
    domainError(
      "CONFLICT",
      "Quote submission has a missing canonical relationship.",
      { details: { quoteSubmissionId: submission._id } },
    );
  }

  const similarSubmissions: Array<{
    candidate: Doc<"quoteSubmissions">;
    similarity: number;
  }> = [];
  for (const candidate of submissionSearch.candidates) {
    if (candidate.episodeId === submission.episodeId) {
      continue;
    }
    const similarity = quoteTextSimilarity(
      submission.quoteText,
      candidate.quoteText,
    );
    if (similarity > REUSE_EVIDENCE_FLOOR) {
      similarSubmissions.push({ candidate, similarity });
    }
  }
  const similarPassages: Array<{
    passage: Doc<"transcriptPassages">;
    similarity: number;
    excerpt: string;
  }> = [];
  for (const passage of transcriptSearch.passages) {
    if (passage.episodeId === submission.episodeId) {
      continue;
    }
    const match = transcriptQuoteMatch(submission.quoteText, passage.text);
    if (match !== null && match.similarity > REUSE_EVIDENCE_FLOOR) {
      similarPassages.push({ passage, ...match });
    }
  }

  const [episodes, users] = await Promise.all([
    loadEpisodes(ctx, [
      ...similarSubmissions.map(({ candidate }) => candidate.episodeId),
      ...similarPassages.map(({ passage }) => passage.episodeId),
    ]),
    Promise.all(
      [...new Set(similarSubmissions.map(({ candidate }) => candidate.userId))]
        .map(async (userId) => [userId, await ctx.db.get("users", userId)] as const),
    ).then((entries) => new Map(entries)),
  ]);
  const isEarlier = (episodeId: Id<"episodes">) => {
    const episode = episodes.get(episodeId);
    return episode !== undefined && episode.number < subjectEpisode.number;
  };

  const byEpisode = new Map<
    Id<"episodes">,
    {
      submissions: QuoteReuseSubmission[];
      transcriptPassages: QuoteReusePassage[];
      distinct: number;
      other: number;
    }
  >();
  const evidenceFor = (episodeId: Id<"episodes">) => {
    let evidence = byEpisode.get(episodeId);
    if (evidence === undefined) {
      evidence = {
        submissions: [],
        transcriptPassages: [],
        distinct: 0,
        other: 0,
      };
      byEpisode.set(episodeId, evidence);
    }
    return evidence;
  };
  const weigh = (
    evidence: { distinct: number; other: number },
    likelihood: number,
    distinct: boolean,
  ) => {
    if (distinct) {
      evidence.distinct = Math.max(evidence.distinct, likelihood);
    } else {
      evidence.other = Math.max(evidence.other, likelihood);
    }
  };
  for (const { candidate, similarity } of similarSubmissions) {
    if (!isEarlier(candidate.episodeId)) {
      continue;
    }
    const sourceTitleMatches = sourceTitlesPossiblyMatch(
      submission.sourceTitle,
      candidate.sourceTitle,
    );
    const likelihood = submissionReuseLikelihood({
      similarity,
      status: candidate.status,
      placed: candidate.placement !== undefined,
      sourceTitleMatches,
    });
    const evidence = evidenceFor(candidate.episodeId);
    weigh(evidence, likelihood, submissionEvidenceIsDistinct(similarity));
    evidence.submissions.push({
      id: candidate._id,
      quoteText: candidate.quoteText,
      sourceTitle: candidate.sourceTitle,
      sourceType: candidate.sourceType,
      status: candidate.status,
      placement: candidate.placement ?? null,
      user: adminUser(users.get(candidate.userId) ?? null, candidate.userId),
      similarity,
      sourceTitleMatches,
      likelihood,
    });
  }
  similarPassages.sort((left, right) => right.similarity - left.similarity);
  for (const { passage, similarity, excerpt } of similarPassages) {
    if (!isEarlier(passage.episodeId)) {
      continue;
    }
    const evidence = evidenceFor(passage.episodeId);
    const passages = evidence.transcriptPassages;
    // Adjacent passages overlap, so keep only the strongest of overlapping ones.
    if (
      passages.length === MAX_QUOTE_REUSE_PASSAGES_PER_EPISODE ||
      passages.some(
        (kept) => kept.start <= passage.end && passage.start <= kept.end,
      )
    ) {
      continue;
    }
    const likelihood = transcriptReuseLikelihood(
      submission.quoteText,
      similarity,
    );
    weigh(
      evidence,
      likelihood,
      transcriptEvidenceIsDistinct(submission.quoteText, similarity),
    );
    passages.push({
      start: passage.start,
      end: passage.end,
      excerpt,
      similarity,
      likelihood,
    });
  }

  const weighedEpisodes = [...byEpisode].flatMap(([episodeId, evidence]) => {
    const episode = episodes.get(episodeId);
    if (episode === undefined) {
      return [];
    }
    const { submissions, transcriptPassages, distinct, other } = evidence;
    submissions.sort((left, right) => right.likelihood - left.likelihood);
    return [
      {
        report: {
          episode: {
            ...toQuoteEpisode(episode),
            date: episode.date ?? null,
            slug: episode.slug ?? null,
          },
          // Evidence within one episode describes the same use, so take the strongest.
          likelihood: Math.max(distinct, other),
          submissions,
          transcriptPassages,
        },
        distinct,
        other,
      },
    ];
  });
  const reportEpisodes = weighedEpisodes.map(({ report }) => report);
  reportEpisodes.sort(
    (left, right) =>
      right.likelihood - left.likelihood ||
      right.episode.number - left.episode.number,
  );

  return {
    submission: {
      id: submission._id,
      quoteText: submission.quoteText,
      sourceTitle: submission.sourceTitle,
      sourceType: submission.sourceType,
      status: submission.status,
      user: adminUser(subjectUser, submission.userId),
      episode: toQuoteEpisode(subjectEpisode),
    },
    likelihood: combineReuseLikelihoods(weighedEpisodes),
    // A search that stopped at its limit matters only if its last result was still
    // relevant; otherwise everything past it is less relevant still.
    limited:
      submissionSearch.cutoffs.some(
        (cutoff) =>
          quoteTextSimilarity(submission.quoteText, cutoff.quoteText) >
          REUSE_EVIDENCE_FLOOR,
      ) ||
      (transcriptSearch.cutoff !== null &&
        (transcriptQuoteMatch(submission.quoteText, transcriptSearch.cutoff.text)
          ?.similarity ?? 0) > REUSE_EVIDENCE_FLOOR),
    episodes: reportEpisodes,
  };
}
