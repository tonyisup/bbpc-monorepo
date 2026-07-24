import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import {
  adminMutation,
  adminQuery,
  authenticatedMutation,
  authenticatedQuery,
} from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  MAX_QUOTE_EPISODE_SELECTOR_SIZE,
  MAX_QUOTE_RANDOM_SEED_LENGTH,
  MAX_QUOTE_SUBMISSIONS_FOR_SELECTOR,
} from "./limits.js";
import {
  findQuoteForEpisodeUser,
  findSubmissionEpisode,
  hydrateAdminQuoteSubmission,
  listQuoteSubmissionsForEpisode,
  requireQuoteEpisode,
  requireQuoteSubmission,
  toMemberQuoteSubmission,
  toQuoteEpisode,
} from "./quoteReadModel.js";
import {
  assertQuotePointOwnedOnly,
  deleteOwnedQuotePoint,
  quotePlacementAdjustment,
  quotePlacementReason,
  resolveQuoteSeasonForEpisode,
  validateBracketOrder,
  validatePlacement,
  validateQuoteAdminNotes,
  validateQuoteClipStart,
  validateQuoteClipUrl,
  validateQuoteListenerNotes,
  validateQuoteSourceTitle,
  validateQuoteSourceType,
  validateQuoteStatus,
  validateQuoteText,
  validateQuoteTimestamp,
} from "./quoteWriteModel.js";
import {
  insertPoint,
  requirePointUser,
} from "./pointWriteModel.js";
import {
  currentQuoteSubmissionValidator,
  quoteAdminEpisodeValidator,
  quoteAdminSubmissionValidator,
  quoteMemberSubmissionValidator,
  quoteSourceTypeValidator,
  quoteStatusValidator,
} from "./validators.js";

const quoteContentArgs = {
  quoteText: v.string(),
  sourceTitle: v.string(),
  sourceType: quoteSourceTypeValidator,
  clipUrl: v.optional(v.union(v.string(), v.null())),
  clipStartSeconds: v.optional(v.union(v.number(), v.null())),
  listenerNotes: v.optional(v.union(v.string(), v.null())),
};

const quoteAwardSnapshotValidator = v.object({
  submissionId: v.id("quoteSubmissions"),
  pointId: v.union(v.id("points"), v.null()),
  placement: v.union(v.number(), v.null()),
});

interface QuoteAwardSnapshot {
  submissionId: Id<"quoteSubmissions">;
  pointId: Id<"points"> | null;
  placement: number | null;
}

function contentPatch(args: {
  quoteText: string;
  sourceTitle: string;
  sourceType: string;
  clipUrl?: string | null;
  clipStartSeconds?: number | null;
  listenerNotes?: string | null;
}) {
  return {
    quoteText: validateQuoteText(args.quoteText),
    sourceTitle: validateQuoteSourceTitle(args.sourceTitle),
    sourceType: validateQuoteSourceType(args.sourceType),
    clipUrl: validateQuoteClipUrl(args.clipUrl ?? null),
    clipStartSeconds: validateQuoteClipStart(
      args.clipStartSeconds ?? null,
    ),
    listenerNotes: validateQuoteListenerNotes(
      args.listenerNotes ?? null,
    ),
  };
}

async function hydrateAdminSubmissions(
  ctx: Parameters<typeof hydrateAdminQuoteSubmission>[0],
  submissions: Array<Doc<"quoteSubmissions">>,
) {
  return await Promise.all(
    submissions.map((submission) =>
      hydrateAdminQuoteSubmission(ctx, submission),
    ),
  );
}

function seedState(rawSeed: string): number {
  const seed = rawSeed.trim().normalize("NFKC");
  if (seed.length < 1 || seed.length > MAX_QUOTE_RANDOM_SEED_LENGTH) {
    domainError(
      "VALIDATION_FAILED",
      `Quote random seed must contain 1 through ${String(MAX_QUOTE_RANDOM_SEED_LENGTH)} characters.`,
    );
  }
  let state = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16_777_619);
  }
  return state >>> 0;
}

function nextRandom(state: number): number {
  let next = state;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next >>> 0;
}

function deterministicShuffle<T>(values: T[], seed: string): T[] {
  let state = seedState(seed);
  return values
    .map((value) => {
      state = nextRandom(state);
      return { order: state, value };
    })
    .sort((left, right) => left.order - right.order)
    .map(({ value }) => value);
}

function currentQuoteAwardSnapshots(
  submissions: Array<Doc<"quoteSubmissions">>,
): QuoteAwardSnapshot[] {
  return submissions
    // convex-query-audit: allow-filter bounded per-episode in-memory rows
    .filter(
      (submission) =>
        submission.pointId !== undefined ||
        submission.placement !== undefined,
    )
    .map((submission) => ({
      submissionId: submission._id,
      pointId: submission.pointId ?? null,
      placement: submission.placement ?? null,
    }))
    .sort((left, right) =>
      String(left.submissionId).localeCompare(
        String(right.submissionId),
      ),
    );
}

function validateExpectedQuoteAwards(
  expected: QuoteAwardSnapshot[],
): QuoteAwardSnapshot[] {
  const submissionIds = new Set<string>();
  return expected
    .map((snapshot) => {
      const submissionId = String(snapshot.submissionId);
      if (submissionIds.has(submissionId)) {
        domainError(
          "VALIDATION_FAILED",
          "Each expected quote award must reference a unique submission.",
        );
      }
      submissionIds.add(submissionId);
      return {
        ...snapshot,
        placement:
          snapshot.placement === null
            ? null
            : validatePlacement(snapshot.placement),
      };
    })
    .sort((left, right) =>
      String(left.submissionId).localeCompare(
        String(right.submissionId),
      ),
    );
}

function quoteAwardSnapshotsMatch(
  actual: QuoteAwardSnapshot[],
  expected: QuoteAwardSnapshot[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  const expectedBySubmissionId = new Map(
    expected.map((snapshot) => [
      snapshot.submissionId,
      snapshot,
    ]),
  );
  return actual.every((snapshot) => {
    const expectedSnapshot = expectedBySubmissionId.get(
      snapshot.submissionId,
    );
    if (expectedSnapshot === undefined) {
      return false;
    }
    return (
      snapshot.pointId === expectedSnapshot.pointId &&
      snapshot.placement === expectedSnapshot.placement
    );
  });
}

export const currentForMe = authenticatedQuery({
  args: {},
  returns: currentQuoteSubmissionValidator,
  handler: async (ctx) => {
    const episode = await findSubmissionEpisode(ctx, [
      "next",
      "recording",
    ]);
    if (episode === null) {
      return { episode: null, isOpen: false, submission: null };
    }
    const submission = await findQuoteForEpisodeUser(
      ctx,
      episode._id,
      ctx.actor.user._id,
    );
    return {
      episode: toQuoteEpisode(episode),
      isOpen: episode.status === "next",
      submission:
        submission === null
          ? null
          : toMemberQuoteSubmission(submission),
    };
  },
});

export const submitMine = authenticatedMutation({
  args: {
    ...quoteContentArgs,
    today: v.string(),
    now: v.optional(v.number()),
  },
  returns: quoteMemberSubmissionValidator,
  handler: async (ctx, args) => {
    const episode = await findSubmissionEpisode(ctx, ["next"]);
    if (episode === null) {
      domainError(
        "CONFLICT",
        "Quotabunga submissions are currently closed.",
        { details: { reason: "ROUND_LOCKED" } },
      );
    }
    const existing = await findQuoteForEpisodeUser(
      ctx,
      episode._id,
      ctx.actor.user._id,
    );
    if (existing?.pointId !== undefined) {
      domainError(
        "CONFLICT",
        "A scored quote submission cannot be edited.",
      );
    }
    const now = validateQuoteTimestamp(
      args.now ?? Date.now(),
      "Quote update time",
    );
    const content = contentPatch(args);
    let submissionId: Id<"quoteSubmissions">;
    let created: boolean;
    if (existing === null) {
      const season = await resolveQuoteSeasonForEpisode(
        ctx,
        episode._id,
        args.today,
      );
      submissionId = await ctx.db.insert("quoteSubmissions", {
        userId: ctx.actor.user._id,
        episodeId: episode._id,
        seasonId: season._id,
        quoteText: content.quoteText,
        sourceTitle: content.sourceTitle,
        sourceType: content.sourceType,
        ...(content.clipUrl === undefined
          ? {}
          : { clipUrl: content.clipUrl }),
        ...(content.clipStartSeconds === undefined
          ? {}
          : { clipStartSeconds: content.clipStartSeconds }),
        ...(content.listenerNotes === undefined
          ? {}
          : { listenerNotes: content.listenerNotes }),
        status: "SUBMITTED",
        createdAt: now,
        updatedAt: now,
      });
      created = true;
    } else {
      await ctx.db.patch("quoteSubmissions", existing._id, {
        ...content,
        status: "SUBMITTED",
        bracketOrder: undefined,
        placement: undefined,
        updatedAt: now,
      });
      submissionId = existing._id;
      created = false;
    }
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: created
        ? "games.member.quoteSubmitted"
        : "games.member.quoteUpdated",
      targetType: "quoteSubmission",
      targetId: submissionId,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return toMemberQuoteSubmission(
      await requireQuoteSubmission(ctx, submissionId),
    );
  },
});

export const withdrawMine = authenticatedMutation({
  args: {},
  returns: v.object({ id: v.id("quoteSubmissions") }),
  handler: async (ctx) => {
    const episode = await findSubmissionEpisode(ctx, ["next"]);
    if (episode === null) {
      domainError(
        "CONFLICT",
        "Quotabunga submissions are currently locked.",
        { details: { reason: "ROUND_LOCKED" } },
      );
    }
    const submission = await findQuoteForEpisodeUser(
      ctx,
      episode._id,
      ctx.actor.user._id,
    );
    if (submission === null) {
      domainError("NOT_FOUND", "The quote submission is unavailable.");
    }
    if (submission.pointId !== undefined) {
      domainError(
        "CONFLICT",
        "A scored quote submission cannot be withdrawn.",
      );
    }
    await ctx.db.delete("quoteSubmissions", submission._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.member.quoteWithdrawn",
      targetType: "quoteSubmission",
      targetId: submission._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: submission._id };
  },
});

export const listAdminEpisodes = adminQuery({
  args: {},
  returns: v.array(quoteAdminEpisodeValidator),
  handler: async (ctx) => {
    const submissions = await ctx.db
      .query("quoteSubmissions")
      .withIndex("by_episodeId")
      .take(MAX_QUOTE_SUBMISSIONS_FOR_SELECTOR + 1);
    if (submissions.length > MAX_QUOTE_SUBMISSIONS_FOR_SELECTOR) {
      domainError(
        "CONFLICT",
        "Quote episode selection exceeds the supported submission limit.",
        { details: { limit: MAX_QUOTE_SUBMISSIONS_FOR_SELECTOR } },
      );
    }
    const episodeIds = new Set<Id<"episodes">>(
      submissions.map((submission) => submission.episodeId),
    );
    const active = await Promise.all(
      ["next", "recording"].map(async (status) => {
        return await ctx.db
          .query("episodes")
          .withIndex("by_status_and_number", (index) =>
            index.eq("status", status),
          )
          .order("desc")
          .take(MAX_QUOTE_EPISODE_SELECTOR_SIZE + 1);
      }),
    );
    for (const episode of active.flat()) {
      episodeIds.add(episode._id);
    }
    const episodes = await Promise.all(
      [...episodeIds].map(async (episodeId) => {
        const episode = await ctx.db.get("episodes", episodeId);
        if (episode === null) {
          domainError(
            "CONFLICT",
            "Quote submission references a missing episode.",
            { details: { episodeId } },
          );
        }
        // convex-query-audit: allow-filter bounded in-memory selector rows
        const count = submissions.filter(
          (submission) => submission.episodeId === episodeId,
        ).length;
        return { ...toQuoteEpisode(episode), submissionCount: count };
      }),
    );
    episodes.sort((left, right) => right.number - left.number);
    return episodes.slice(0, MAX_QUOTE_EPISODE_SELECTOR_SIZE);
  },
});

export const getAdminById = adminQuery({
  args: { id: v.id("quoteSubmissions") },
  returns: v.union(quoteAdminSubmissionValidator, v.null()),
  handler: async (ctx, args) => {
    const submission = await ctx.db.get("quoteSubmissions", args.id);
    return submission === null
      ? null
      : await hydrateAdminQuoteSubmission(ctx, submission);
  },
});

export const listAdminForEpisode = adminQuery({
  args: { episodeId: v.id("episodes") },
  returns: v.array(quoteAdminSubmissionValidator),
  handler: async (ctx, args) => {
    await requireQuoteEpisode(ctx, args.episodeId);
    return await hydrateAdminSubmissions(
      ctx,
      await listQuoteSubmissionsForEpisode(ctx, args.episodeId),
    );
  },
});

export const createForUser = adminMutation({
  args: {
    ...quoteContentArgs,
    episodeId: v.id("episodes"),
    userId: v.id("users"),
    today: v.string(),
    now: v.optional(v.number()),
  },
  returns: quoteAdminSubmissionValidator,
  handler: async (ctx, args) => {
    const [episode, user] = await Promise.all([
      requireQuoteEpisode(ctx, args.episodeId),
      requirePointUser(ctx, args.userId),
    ]);
    if (
      (await findQuoteForEpisodeUser(
        ctx,
        episode._id,
        user._id,
      )) !== null
    ) {
      domainError(
        "CONFLICT",
        "The user already has a quote submission for this episode.",
      );
    }
    const season = await resolveQuoteSeasonForEpisode(
      ctx,
      episode._id,
      args.today,
    );
    const now = validateQuoteTimestamp(
      args.now ?? Date.now(),
      "Quote creation time",
    );
    const content = contentPatch(args);
    const id = await ctx.db.insert("quoteSubmissions", {
      userId: user._id,
      episodeId: episode._id,
      seasonId: season._id,
      quoteText: content.quoteText,
      sourceTitle: content.sourceTitle,
      sourceType: content.sourceType,
      ...(content.clipUrl === undefined
        ? {}
        : { clipUrl: content.clipUrl }),
      ...(content.clipStartSeconds === undefined
        ? {}
        : { clipStartSeconds: content.clipStartSeconds }),
      ...(content.listenerNotes === undefined
        ? {}
        : { listenerNotes: content.listenerNotes }),
      status: "SUBMITTED",
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.quoteCreated",
      targetType: "quoteSubmission",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateAdminQuoteSubmission(
      ctx,
      await requireQuoteSubmission(ctx, id),
    );
  },
});

export const updateContent = adminMutation({
  args: {
    ...quoteContentArgs,
    id: v.id("quoteSubmissions"),
    adminNotes: v.optional(v.union(v.string(), v.null())),
    now: v.optional(v.number()),
  },
  returns: quoteAdminSubmissionValidator,
  handler: async (ctx, args) => {
    const submission = await requireQuoteSubmission(ctx, args.id);
    if (submission.pointId !== undefined) {
      domainError(
        "CONFLICT",
        "A scored quote submission cannot be edited.",
      );
    }
    await ctx.db.patch("quoteSubmissions", submission._id, {
      ...contentPatch(args),
      adminNotes: validateQuoteAdminNotes(
        args.adminNotes ?? null,
      ),
      updatedAt: validateQuoteTimestamp(
        args.now ?? Date.now(),
        "Quote update time",
      ),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.quoteUpdated",
      targetType: "quoteSubmission",
      targetId: submission._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateAdminQuoteSubmission(
      ctx,
      await requireQuoteSubmission(ctx, submission._id),
    );
  },
});

export const setStatus = adminMutation({
  args: {
    id: v.id("quoteSubmissions"),
    status: quoteStatusValidator,
    now: v.optional(v.number()),
  },
  returns: quoteAdminSubmissionValidator,
  handler: async (ctx, args) => {
    const submission = await requireQuoteSubmission(ctx, args.id);
    const status = validateQuoteStatus(args.status);
    if (
      submission.pointId !== undefined &&
      status !== "INCLUDED"
    ) {
      domainError(
        "CONFLICT",
        "Clear the scored result before excluding the quote submission.",
      );
    }
    await ctx.db.patch("quoteSubmissions", submission._id, {
      status,
      ...(status === "INCLUDED"
        ? {}
        : { bracketOrder: undefined, placement: undefined }),
      updatedAt: validateQuoteTimestamp(
        args.now ?? Date.now(),
        "Quote update time",
      ),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.quoteStatusChanged",
      targetType: "quoteSubmission",
      targetId: submission._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { status },
    });
    return await hydrateAdminQuoteSubmission(
      ctx,
      await requireQuoteSubmission(ctx, submission._id),
    );
  },
});

export const randomizeIncluded = adminMutation({
  args: {
    episodeId: v.id("episodes"),
    seed: v.string(),
    now: v.optional(v.number()),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, args) => {
    await requireQuoteEpisode(ctx, args.episodeId);
    const included = (
      await listQuoteSubmissionsForEpisode(ctx, args.episodeId)
    )
      // convex-query-audit: allow-filter bounded per-episode in-memory rows
      .filter((submission) => submission.status === "INCLUDED")
      .sort((left, right) =>
        String(left._id).localeCompare(String(right._id)),
      );
    const randomized = deterministicShuffle(included, args.seed);
    const now = validateQuoteTimestamp(
      args.now ?? Date.now(),
      "Quote update time",
    );
    for (const [index, submission] of randomized.entries()) {
      await ctx.db.patch("quoteSubmissions", submission._id, {
        bracketOrder: validateBracketOrder(index + 1),
        updatedAt: now,
      });
    }
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.quoteBracketRandomized",
      targetType: "episode",
      targetId: args.episodeId,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: { count: randomized.length },
    });
    return { count: randomized.length };
  },
});

export const awardPlacements = adminMutation({
  args: {
    episodeId: v.id("episodes"),
    placements: v.array(
      v.object({
        submissionId: v.id("quoteSubmissions"),
        placement: v.number(),
      }),
    ),
    expectedAwards: v.optional(
      v.array(quoteAwardSnapshotValidator),
    ),
    earnedAt: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  returns: v.object({
    awarded: v.number(),
    cleared: v.number(),
  }),
  handler: async (ctx, args) => {
    if (args.placements.length > 3) {
      domainError(
        "VALIDATION_FAILED",
        "At most three quote placements can be awarded.",
      );
    }
    const validatedPlacements = args.placements.map((result) => ({
      submissionId: result.submissionId,
      placement: validatePlacement(result.placement),
    }));
    const submissionIds = validatedPlacements.map(
      (result) => result.submissionId,
    );
    const placements = validatedPlacements.map(
      (result) => result.placement,
    );
    if (new Set(submissionIds).size !== submissionIds.length) {
      domainError(
        "VALIDATION_FAILED",
        "Each quote submission can receive only one placement.",
      );
    }
    if (new Set(placements).size !== placements.length) {
      domainError(
        "VALIDATION_FAILED",
        "Each quote placement can be awarded only once.",
      );
    }
    const episode = await requireQuoteEpisode(ctx, args.episodeId);
    const submissions = await listQuoteSubmissionsForEpisode(
      ctx,
      episode._id,
    );
    if (args.expectedAwards !== undefined) {
      const expectedAwards = validateExpectedQuoteAwards(
        args.expectedAwards,
      );
      const actualAwards = currentQuoteAwardSnapshots(submissions);
      if (!quoteAwardSnapshotsMatch(actualAwards, expectedAwards)) {
        domainError(
          "CONFLICT",
          "Quote awards changed after they were inspected.",
        );
      }
    }
    const byId = new Map(
      submissions.map((submission) => [
        submission._id,
        submission,
      ]),
    );
    const awards = validatedPlacements.map((result) => {
      const submission = byId.get(result.submissionId);
      if (submission?.status !== "INCLUDED") {
        domainError(
          "VALIDATION_FAILED",
          "Only included quote submissions can receive a placement.",
        );
      }
      return { placement: result.placement, submission };
    });
    const awardedIds = new Set(submissionIds);
    const now = validateQuoteTimestamp(
      args.now ?? Date.now(),
      "Quote update time",
    );
    const earnedAt = validateQuoteTimestamp(
      args.earnedAt ?? Date.now(),
      "Quote point earned time",
    );
    let cleared = 0;
    for (const submission of submissions) {
      if (
        !awardedIds.has(submission._id) &&
        (submission.pointId !== undefined ||
          submission.placement !== undefined)
      ) {
        await deleteOwnedQuotePoint(ctx, submission);
        await ctx.db.patch("quoteSubmissions", submission._id, {
          placement: undefined,
          updatedAt: now,
        });
        cleared += 1;
      }
    }
    for (const result of awards) {
      const placement = result.placement;
      const submission = result.submission;
      const adjustment = quotePlacementAdjustment(placement);
      const reason = quotePlacementReason(
        episode.number,
        placement,
      );
      let pointId = submission.pointId;
      if (pointId === undefined) {
        const point = await insertPoint(ctx, {
          userId: submission.userId,
          seasonId: submission.seasonId,
          reason,
          adjustment,
          earnedAt,
          gamePointTypeId: undefined,
        });
        pointId = point._id;
      } else {
        const point = await assertQuotePointOwnedOnly(
          ctx,
          submission,
        );
        await ctx.db.patch("points", point._id, {
          userId: submission.userId,
          seasonId: submission.seasonId,
          adjustment,
          reason,
        });
      }
      await ctx.db.patch("quoteSubmissions", submission._id, {
        placement,
        pointId,
        updatedAt: now,
      });
    }
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.quotePlacementsAwarded",
      targetType: "episode",
      targetId: episode._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        awarded: args.placements.length,
        cleared,
      },
    });
    return { awarded: args.placements.length, cleared };
  },
});

export const remove = adminMutation({
  args: {
    id: v.id("quoteSubmissions"),
    expectedAward: v.optional(
      v.object({
        pointId: v.union(v.id("points"), v.null()),
        placement: v.union(v.number(), v.null()),
      }),
    ),
  },
  returns: v.object({ id: v.id("quoteSubmissions") }),
  handler: async (ctx, args) => {
    const submission = await requireQuoteSubmission(ctx, args.id);
    if (
      args.expectedAward !== undefined &&
      (args.expectedAward.pointId !==
        (submission.pointId ?? null) ||
        args.expectedAward.placement !==
          (submission.placement ?? null))
    ) {
      domainError(
        "CONFLICT",
        "The quote award changed after it was inspected.",
      );
    }
    await deleteOwnedQuotePoint(ctx, submission);
    await ctx.db.delete("quoteSubmissions", submission._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "games.admin.quoteDeleted",
      targetType: "quoteSubmission",
      targetId: submission._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
      metadata: {
        awardDeleted: submission.pointId !== undefined,
      },
    });
    return { id: submission._id };
  },
});
