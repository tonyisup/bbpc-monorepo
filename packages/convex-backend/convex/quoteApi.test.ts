/// <reference types="vite/client" />

import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { BBPC_API_VERSION } from "../contracts/index.js";
import { api, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  validateBracketOrder,
  validatePlacement,
  validateQuoteAdminNotes,
  validateQuoteListenerNotes,
  validateQuoteSourceType,
  validateQuoteStatus,
  validateQuoteTimestamp,
} from "./games/quoteWriteModel.js";
import {
  SHORT_TRANSCRIPT_MATCH_THRESHOLD,
  TRANSCRIPT_MATCH_THRESHOLD,
  combineReuseLikelihoods,
  quoteSearchAnchors,
  quotesPossiblyMatch,
  submissionReuseLikelihood,
  transcriptMatchThreshold,
  transcriptReuseLikelihood,
  transcriptQuoteMatch,
  transcriptSearchQuery,
} from "./games/quoteSimilarity.js";
import { MAX_QUOTE_TRANSCRIPT_CANDIDATES_FOR_ADMIN } from "./games/limits.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const CUTOVER_RUN_ID = "quote-api-test";
const ADMIN_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|quote-admin",
  issuer: "https://issuer.example.test",
  subject: "quote-admin",
};
const MEMBER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|quote-member",
  issuer: "https://issuer.example.test",
  subject: "quote-member",
};
const OTHER_IDENTITY = {
  tokenIdentifier: "https://issuer.example.test|quote-other",
  issuer: "https://issuer.example.test",
  subject: "quote-other",
};

function createTestBackend() {
  return convexTest(schema, modules);
}

type TestBackend = ReturnType<typeof createTestBackend>;
type TestIdentity = typeof ADMIN_IDENTITY;

async function expectDomainError(
  promise: Promise<unknown>,
  expectedCode: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({
      code: expectedCode,
      ...(details === undefined ? {} : { details }),
    });
    return;
  }
  throw new Error(`Expected domain error ${expectedCode}`);
}

async function seedUser(
  t: TestBackend,
  input: {
    identity: TestIdentity;
    name: string;
    admin?: boolean;
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const normalizedEmail = `${input.identity.subject}@example.test`;
    const userId = await ctx.db.insert("users", {
      name: input.name,
      email: normalizedEmail,
      normalizedEmail,
      image: `https://images.example.test/${input.identity.subject}.jpg`,
      status: "active",
      createdAt: 1,
      updatedAt: 1,
    });
    await ctx.db.insert("authIdentities", {
      ...input.identity,
      userId,
      linkedAt: 1,
      lastSeenAt: 1,
    });
    if (input.admin === true) {
      const roleId = await ctx.db.insert("roles", {
        name: "Administrator",
        normalizedName: "administrator",
        description: "Administrator role",
        admin: true,
        permissions: ["admin"],
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("userRoles", {
        userId,
        roleId,
        assignedAt: 1,
      });
    }
    return userId;
  });
}

async function seedActors(t: TestBackend) {
  const adminId = await seedUser(t, {
    identity: ADMIN_IDENTITY,
    name: "Quote Admin",
    admin: true,
  });
  const memberId = await seedUser(t, {
    identity: MEMBER_IDENTITY,
    name: "Quote Member",
  });
  const otherId = await seedUser(t, {
    identity: OTHER_IDENTITY,
    name: "Quote Other",
  });
  return { adminId, memberId, otherId };
}

async function initializeS1(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.initialize, {
    cutoverRunId: CUTOVER_RUN_ID,
    apiVersion: BBPC_API_VERSION,
    actor: "quote-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S0",
    nextStage: "S1",
    actor: "quote-api-test",
  });
}

async function advanceFromS1ToS3(t: TestBackend): Promise<void> {
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S1",
    nextStage: "S2",
    actor: "quote-api-test",
  });
  await t.mutation(internal.system.cutover.transition, {
    cutoverRunId: CUTOVER_RUN_ID,
    expectedStage: "S2",
    nextStage: "S3",
    actor: "quote-api-test",
    approvedBackupId: "quote-api-backup",
    approvedBackupChecksum: "sha256:quote-api",
  });
}

async function advanceToS3(t: TestBackend): Promise<void> {
  await initializeS1(t);
  await advanceFromS1ToS3(t);
}

async function seedFoundation(t: TestBackend) {
  return await t.run(async (ctx) => {
    const gameTypeId = await ctx.db.insert("gameTypes", {
      title: "Quotabunga",
      lookupId: "quotabunga",
      normalizedLookupId: "quotabunga",
    });
    const seasonId = await ctx.db.insert("seasons", {
      title: "Current season",
      gameTypeId,
      startedOn: "2026-01-01",
      endedOn: "2026-12-31",
    });
    const nextEpisodeId = await ctx.db.insert("episodes", {
      number: 12,
      title: "Next episode",
      status: "next",
    });
    const recordingEpisodeId = await ctx.db.insert("episodes", {
      number: 11,
      title: "Recording episode",
      status: "recording",
    });
    const oldEpisodeId = await ctx.db.insert("episodes", {
      number: 10,
      title: "Old episode",
      status: "published",
    });
    return {
      gameTypeId,
      seasonId,
      nextEpisodeId,
      recordingEpisodeId,
      oldEpisodeId,
    };
  });
}

const memberContent = {
  quoteText: " Great quote ",
  sourceTitle: " Great movie ",
  sourceType: "MOVIE" as const,
  clipUrl: " https://example.test/clip ",
  clipStartSeconds: 42,
  listenerNotes: " Listen closely ",
  today: "2026-07-24",
};

async function insertQuote(
  t: TestBackend,
  input: {
    userId: Id<"users">;
    episodeId: Id<"episodes">;
    seasonId: Id<"seasons">;
    status?: "SUBMITTED" | "INCLUDED" | "REJECTED";
    bracketOrder?: number;
    placement?: number;
    pointId?: Id<"points">;
    createdAt?: number;
    quoteText?: string;
    sourceTitle?: string;
  },
): Promise<Id<"quoteSubmissions">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("quoteSubmissions", {
      userId: input.userId,
      episodeId: input.episodeId,
      seasonId: input.seasonId,
      quoteText: input.quoteText ?? "Synthetic quote",
      sourceTitle: input.sourceTitle ?? "Synthetic source",
      sourceType: "MOVIE",
      status: input.status ?? "SUBMITTED",
      ...(input.bracketOrder === undefined
        ? {}
        : { bracketOrder: input.bracketOrder }),
      ...(input.placement === undefined
        ? {}
        : { placement: input.placement }),
      ...(input.pointId === undefined
        ? {}
        : { pointId: input.pointId }),
      createdAt: input.createdAt ?? 1,
      updatedAt: input.createdAt ?? 1,
    });
  });
}

async function insertPassage(
  t: TestBackend,
  input: {
    episodeId: Id<"episodes">;
    text: string;
    start?: number;
    end?: number;
    isPublic?: boolean;
  },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("transcriptPassages", {
      episodeId: input.episodeId,
      isPublic: input.isPublic ?? true,
      hash: "synthetic-transcript",
      sequence: 0,
      start: input.start ?? 0,
      end: input.end ?? (input.start ?? 0) + 30,
      text: input.text,
    });
  });
}

const GODFATHER_PASSAGE =
  "okay so my quote this week is from the godfather and it goes I'm gonna make him an offer he can't refuse which honestly is the best line in the movie and nobody can tell me otherwise";

describe("Quotabunga workflows", () => {
  test("returns no search anchors for quotes below the minimum length", () => {
    expect(quoteSearchAnchors("Tiny")).toEqual([]);
  });

  test("falls back to stop words when a quote has no meaningful anchor", () => {
    expect(quoteSearchAnchors("the and you")).toEqual([
      "and",
      "the",
      "you",
    ]);
  });

  test("deduplicates repeated quote search anchors", () => {
    expect(quoteSearchAnchors("echo echo alpha")).toEqual([
      "alpha",
      "echo",
    ]);
  });

  test("sorts and limits meaningful quote search anchors", () => {
    expect(
      quoteSearchAnchors(
        "I'm gonna make him an offer he can't refuse.",
      ),
    ).toEqual(["refuse", "gonna", "offer"]);
  });

  test.each([
    {
      label: "matches normalized wording from the same movie",
      submitted: {
        quoteText: "I'm gonna make him an offer he can't refuse.",
        sourceTitle: "The Godfather",
      },
      candidate: {
        quoteText: "Im going to make him an offer he cannot refuse",
        sourceTitle: "Godfather",
      },
      expected: true,
    },
    {
      label: "normalizes ampersands in otherwise equal quotes",
      submitted: {
        quoteText: "Rock & roll forever",
        sourceTitle: "Star Wars",
      },
      candidate: {
        quoteText: "Rock and roll forever",
        sourceTitle: "Star Wars Episode IV",
      },
      expected: true,
    },
    {
      label: "matches a contained quote with a fuzzy source title",
      submitted: {
        quoteText: "May the Force be with you",
        sourceTitle: "Star Wars New Hope",
      },
      candidate: {
        quoteText: "May the Force be with you always",
        sourceTitle: "Star Wars A New Hope",
      },
      expected: true,
    },
    {
      label: "tolerates a small source-title typo",
      submitted: {
        quoteText: "Come with me if you want to live",
        sourceTitle: "Terminator",
      },
      candidate: {
        quoteText: "Come with me if you want to live",
        sourceTitle: "Terminatr",
      },
      expected: true,
    },
    {
      label: "normalizes punctuation and leading source articles",
      submitted: {
        quoteText: "I'll be back.",
        sourceTitle: "The Terminator",
      },
      candidate: {
        quoteText: "Ill be back",
        sourceTitle: "Terminator",
      },
      expected: true,
    },
    {
      label: "rejects equal quotes from different submitted sources",
      submitted: {
        quoteText: "I'll be back.",
        sourceTitle: "The Terminator",
      },
      candidate: {
        quoteText: "I'll be back.",
        sourceTitle: "Last Action Hero",
      },
      expected: false,
    },
    {
      label: "rejects a blank candidate source when submitted source is set",
      submitted: {
        quoteText: "I'll be back.",
        sourceTitle: "The Terminator",
      },
      candidate: {
        quoteText: "I'll be back.",
        sourceTitle: "",
      },
      expected: false,
    },
    {
      label: "skips the source gate when the submitted source is blank",
      submitted: {
        quoteText: "Im going to make him an offer he cannot refuse",
        sourceTitle: "",
      },
      candidate: {
        quoteText: "I'm gonna make him an offer he can't refuse.",
        sourceTitle: "The Godfather",
      },
      expected: true,
    },
    {
      label: "rejects unrelated quotes that share a source",
      submitted: {
        quoteText: "This town needs an enema.",
        sourceTitle: "Batman",
      },
      candidate: {
        quoteText: "I'm Batman.",
        sourceTitle: "Batman",
      },
      expected: false,
    },
    {
      label: "rejects quote text below the minimum length",
      submitted: {
        quoteText: "Tiny",
        sourceTitle: "Same source",
      },
      candidate: {
        quoteText: "Tiny bit",
        sourceTitle: "Same source",
      },
      expected: false,
    },
    {
      label: "rejects unrelated comparable-length quotes",
      submitted: {
        quoteText: "Nobody puts Baby in a corner",
        sourceTitle: "Same source",
      },
      candidate: {
        quoteText: "There is no place like home today",
        sourceTitle: "Same source",
      },
      expected: false,
    },
  ])("$label", ({ submitted, candidate, expected }) => {
    expect(
      quotesPossiblyMatch(
        submitted,
        candidate,
      ),
    ).toBe(expected);
  });

  test("validates canonical quote-domain boundaries", async () => {
    expect(validateQuoteAdminNotes("   ")).toBeUndefined();
    expect(validateQuoteSourceType("TV")).toBe("TV");
    expect(validateQuoteStatus("REJECTED")).toBe("REJECTED");
    expect(validateQuoteTimestamp(0, "Quote time")).toBe(0);
    expect(validateBracketOrder(-32_768)).toBe(-32_768);
    expect(validatePlacement(3)).toBe(3);

    const invalidValidations: Array<() => unknown> = [
      () => validateQuoteListenerNotes("x".repeat(1001)),
      () => validateQuoteSourceType("BOOK"),
      () => validateQuoteStatus("PENDING"),
      () => validateQuoteTimestamp(1.5, "Quote time"),
      () => validateBracketOrder(32_768),
      () => validatePlacement(4),
    ];
    for (const invalid of invalidValidations) {
      await expectDomainError(
        Promise.resolve().then(invalid),
        "VALIDATION_FAILED",
      );
    }
  });

  test("returns only a warning verdict for another listener's possible duplicate", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    await insertQuote(t, {
      userId: otherId,
      episodeId: foundation.oldEpisodeId,
      seasonId: foundation.seasonId,
      quoteText: "I'm gonna make him an offer he can't refuse.",
      sourceTitle: "The Godfather",
    });

    await expectDomainError(
      t.query(api.games.quotes.checkPossibleDuplicate, {
        quoteText: "Im going to make him an offer he cannot refuse",
        sourceTitle: "Godfather",
      }),
      "AUTHENTICATION_REQUIRED",
    );
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "Im going to make him an offer he cannot refuse",
          sourceTitle: "Godfather",
        },
      ),
    ).resolves.toEqual({ possibleMatch: true, transcriptMatches: [] });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "Im going to make him an offer he cannot refuse",
          sourceTitle: "",
        },
      ),
    ).resolves.toEqual({ possibleMatch: true, transcriptMatches: [] });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "Leave the gun. Take the cannoli.",
          sourceTitle: "Godfather",
        },
      ),
    ).resolves.toEqual({ possibleMatch: false, transcriptMatches: [] });

    expect(memberId).not.toBe(otherId);
  });

  test("does not flag a listener's own current entry while they edit it", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      quoteText: "I'll be back.",
      sourceTitle: "The Terminator",
    });

    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "Ill be back",
          sourceTitle: "Terminator",
        },
      ),
    ).resolves.toEqual({ possibleMatch: false, transcriptMatches: [] });
  });

  test("handles short quotes and historical matches without an active round", async () => {
    const t = createTestBackend();
    const { otherId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    await t.run(async (ctx) => {
      await ctx.db.patch("episodes", foundation.nextEpisodeId, {
        status: "published",
      });
    });
    await insertQuote(t, {
      userId: otherId,
      episodeId: foundation.oldEpisodeId,
      seasonId: foundation.seasonId,
      quoteText: "May the Force be with you.",
      sourceTitle: "Star Wars",
    });

    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        { quoteText: "Short", sourceTitle: "" },
      ),
    ).resolves.toEqual({ possibleMatch: false, transcriptMatches: [] });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "May the Force be with you",
          sourceTitle: "Star Wars",
        },
      ),
    ).resolves.toEqual({ possibleMatch: true, transcriptMatches: [] });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "May the Force be with you",
          sourceTitle: "x".repeat(501),
        },
      ),
      "VALIDATION_FAILED",
    );
  });

  test("derives member ownership and preserves open-round edit rules", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await initializeS1(t);

    await expectDomainError(
      t.query(api.games.quotes.currentForMe, {}),
      "AUTHENTICATION_REQUIRED",
    );
    await expect(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.quotes.currentForMe, {}),
    ).resolves.toEqual({
      episode: null,
      isOpen: false,
      submission: null,
    });
    const foundation = await seedFoundation(t);
    await expect(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.quotes.currentForMe, {}),
    ).resolves.toMatchObject({
      episode: { id: foundation.nextEpisodeId, number: 12 },
      isOpen: true,
      submission: null,
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.quotes.submitMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          ...memberContent,
        },
      ),
      "WRITE_DISABLED",
    );

    await advanceFromS1ToS3(t);
    const minimal = await t.withIdentity(OTHER_IDENTITY).mutation(
      api.games.quotes.submitMine,
      {
        clientApiVersion: BBPC_API_VERSION,
        quoteText: "Minimal quote",
        sourceTitle: "Minimal source",
        sourceType: "OTHER",
        today: "2026-07-24",
      },
    );
    expect(minimal).toMatchObject({
      clipUrl: null,
      clipStartSeconds: null,
      listenerNotes: null,
    });
    await t.withIdentity(OTHER_IDENTITY).mutation(
      api.games.quotes.withdrawMine,
      { clientApiVersion: BBPC_API_VERSION },
    );

    for (const invalid of [
      { quoteText: " ", sourceTitle: "Movie", clipUrl: null },
      {
        quoteText: "Quote",
        sourceTitle: "Movie",
        clipUrl: "ftp://example.test/clip",
      },
      {
        quoteText: "Quote",
        sourceTitle: "Movie",
        clipUrl: null,
        clipStartSeconds: 86_401,
      },
    ]) {
      await expectDomainError(
        t.withIdentity(MEMBER_IDENTITY).mutation(
          api.games.quotes.submitMine,
          {
            clientApiVersion: BBPC_API_VERSION,
            ...memberContent,
            ...invalid,
          },
        ),
        "VALIDATION_FAILED",
      );
    }

    const created = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.games.quotes.submitMine,
      {
        clientApiVersion: BBPC_API_VERSION,
        ...memberContent,
        now: 100,
      },
    );
    expect(created).toMatchObject({
      quoteText: "Great quote",
      sourceTitle: "Great movie",
      clipUrl: "https://example.test/clip",
      clipStartSeconds: 42,
      listenerNotes: "Listen closely",
      status: "SUBMITTED",
      scored: false,
      createdAt: 100,
      updatedAt: 100,
    });
    const stored = await t.run(
      async (ctx) => await ctx.db.get("quoteSubmissions", created.id),
    );
    expect(stored).toMatchObject({
      userId: memberId,
      seasonId: foundation.seasonId,
      episodeId: foundation.nextEpisodeId,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("quoteSubmissions", created.id, {
        status: "INCLUDED",
        bracketOrder: 4,
        placement: 2,
        adminNotes: "Private moderation note",
      });
    });
    const updated = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.games.quotes.submitMine,
      {
        clientApiVersion: BBPC_API_VERSION,
        quoteText: "Replacement",
        sourceTitle: "Replacement source",
        sourceType: "TV",
        clipUrl: null,
        clipStartSeconds: null,
        listenerNotes: null,
        today: "2026-07-24",
        now: 200,
      },
    );
    expect(updated).toMatchObject({
      id: created.id,
      status: "SUBMITTED",
      bracketOrder: null,
      placement: null,
      clipUrl: null,
      listenerNotes: null,
      createdAt: 100,
      updatedAt: 200,
    });
    expect(JSON.stringify(updated)).not.toContain(
      "Private moderation note",
    );

    await expect(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.quotes.withdrawMine,
        { clientApiVersion: BBPC_API_VERSION },
      ),
    ).resolves.toEqual({ id: created.id });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.quotes.withdrawMine,
        { clientApiVersion: BBPC_API_VERSION },
      ),
      "NOT_FOUND",
    );

    const scored = await t.withIdentity(MEMBER_IDENTITY).mutation(
      api.games.quotes.submitMine,
      {
        clientApiVersion: BBPC_API_VERSION,
        ...memberContent,
        now: 300,
      },
    );
    await t.run(async (ctx) => {
      const pointId = await ctx.db.insert("points", {
        userId: memberId,
        seasonId: foundation.seasonId,
        reason: "Scored",
        adjustment: 40,
        earnedAt: 300,
      });
      await ctx.db.patch("quoteSubmissions", scored.id, { pointId });
    });
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.quotes.submitMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          ...memberContent,
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(MEMBER_IDENTITY).mutation(
        api.games.quotes.withdrawMine,
        { clientApiVersion: BBPC_API_VERSION },
      ),
      "CONFLICT",
    );

    await t.run(async (ctx) => {
      await ctx.db.patch("episodes", foundation.nextEpisodeId, {
        status: "published",
      });
    });
    await expectDomainError(
      t.withIdentity(OTHER_IDENTITY).mutation(
        api.games.quotes.submitMine,
        {
          clientApiVersion: BBPC_API_VERSION,
          ...memberContent,
        },
      ),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );
    await expectDomainError(
      t.withIdentity(OTHER_IDENTITY).mutation(
        api.games.quotes.withdrawMine,
        { clientApiVersion: BBPC_API_VERSION },
      ),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );

    const audits = await t.run(async (ctx) => {
      return await ctx.db
        .query("auditEvents")
        .withIndex("by_cutoverRunId_and_createdAt", (index) =>
          index.eq("cutoverRunId", CUTOVER_RUN_ID),
        )
        .collect();
    });
    expect(audits.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "games.member.quoteSubmitted",
        "games.member.quoteUpdated",
        "games.member.quoteWithdrawn",
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain("Great quote");
  });

  test("locks Quotabunga on the same deadline as predictions", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await initializeS1(t);
    await advanceFromS1ToS3(t);
    const foundation = await seedFoundation(t);
    const member = t.withIdentity(MEMBER_IDENTITY);
    // Only the recording episode remains, inside its ten-minute grace window.
    await t.run(async (ctx) => {
      await ctx.db.patch("episodes", foundation.nextEpisodeId, {
        status: "published",
      });
      await ctx.db.patch("episodes", foundation.recordingEpisodeId, {
        predictionClosesAt: Date.now() + 600_000,
      });
    });

    await expect(
      member.query(api.games.quotes.currentForMe, { now: Date.now() }),
    ).resolves.toMatchObject({
      episode: { id: foundation.recordingEpisodeId, number: 11 },
      isOpen: true,
    });
    const created = await member.mutation(api.games.quotes.submitMine, {
      clientApiVersion: BBPC_API_VERSION,
      ...memberContent,
    });
    expect(created).toMatchObject({ quoteText: "Great quote" });
    await expect(
      member.mutation(api.games.quotes.withdrawMine, {
        clientApiVersion: BBPC_API_VERSION,
      }),
    ).resolves.toEqual({ id: created.id });

    // The deadline passes: the flag, submissions, and withdrawals all lock,
    // and a client cannot reopen the round by sending an earlier clock.
    await t.run(async (ctx) => {
      await ctx.db.patch("episodes", foundation.recordingEpisodeId, {
        predictionClosesAt: Date.now() - 1,
      });
    });
    await expect(
      member.query(api.games.quotes.currentForMe, { now: Date.now() }),
    ).resolves.toMatchObject({
      episode: { id: foundation.recordingEpisodeId },
      isOpen: false,
    });
    await expectDomainError(
      member.mutation(api.games.quotes.submitMine, {
        clientApiVersion: BBPC_API_VERSION,
        ...memberContent,
        now: 500,
      }),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );
    await expectDomainError(
      member.mutation(api.games.quotes.withdrawMine, {
        clientApiVersion: BBPC_API_VERSION,
      }),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );

    // A recording episode with no deadline never accepts entries.
    await t.run(async (ctx) => {
      await ctx.db.patch("episodes", foundation.recordingEpisodeId, {
        predictionClosesAt: undefined,
      });
    });
    await expect(
      member.query(api.games.quotes.currentForMe, { now: Date.now() }),
    ).resolves.toMatchObject({ isOpen: false });
    await expectDomainError(
      member.mutation(api.games.quotes.submitMine, {
        clientApiVersion: BBPC_API_VERSION,
        ...memberContent,
      }),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );
  });

  test("keeps entries attached to their episode and locks aired ones", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await initializeS1(t);
    await advanceFromS1ToS3(t);
    const foundation = await seedFoundation(t);
    const member = t.withIdentity(MEMBER_IDENTITY);
    await t.run(async (ctx) => {
      await ctx.db.insert("quoteSubmissions", {
        userId: memberId,
        episodeId: foundation.oldEpisodeId,
        seasonId: foundation.seasonId,
        quoteText: "Old favorite",
        sourceTitle: "Old movie",
        sourceType: "MOVIE",
        status: "INCLUDED",
        placement: 2,
        createdAt: 1,
        updatedAt: 1,
      });
    });

    await expect(
      member.query(api.games.quotes.mineForEpisode, {
        episodeId: foundation.nextEpisodeId,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({
      episode: { id: foundation.nextEpisodeId },
      isOpen: true,
      submission: null,
    });
    await expect(
      member.query(api.games.quotes.mineForEpisode, {
        episodeId: foundation.oldEpisodeId,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({
      episode: { id: foundation.oldEpisodeId, number: 10 },
      isOpen: false,
      submission: { quoteText: "Old favorite", placement: 2 },
    });

    const created = await member.mutation(api.games.quotes.submitMine, {
      clientApiVersion: BBPC_API_VERSION,
      ...memberContent,
      episodeId: foundation.nextEpisodeId,
    });
    await expect(
      member.query(api.games.quotes.mineForEpisode, {
        episodeId: foundation.nextEpisodeId,
        now: Date.now(),
      }),
    ).resolves.toMatchObject({ submission: { id: created.id } });
    await expectDomainError(
      member.mutation(api.games.quotes.submitMine, {
        clientApiVersion: BBPC_API_VERSION,
        ...memberContent,
        episodeId: foundation.oldEpisodeId,
      }),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );
    await expectDomainError(
      member.mutation(api.games.quotes.withdrawMine, {
        clientApiVersion: BBPC_API_VERSION,
        episodeId: foundation.oldEpisodeId,
      }),
      "CONFLICT",
      { reason: "ROUND_LOCKED" },
    );
    await expect(
      member.mutation(api.games.quotes.withdrawMine, {
        clientApiVersion: BBPC_API_VERSION,
        episodeId: foundation.nextEpisodeId,
      }),
    ).resolves.toEqual({ id: created.id });

    const removedEpisodeId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("episodes", {
        number: 99,
        title: "Removed",
        status: "published",
      });
      await ctx.db.delete("episodes", id);
      return id;
    });
    await expectDomainError(
      member.query(api.games.quotes.mineForEpisode, {
        episodeId: removedEpisodeId,
        now: Date.now(),
      }),
      "NOT_FOUND",
    );
    await expectDomainError(
      t.query(api.games.quotes.mineForEpisode, {
        episodeId: foundation.nextEpisodeId,
        now: Date.now(),
      }),
      "AUTHENTICATION_REQUIRED",
    );
  });

  test("provides bounded administrator episode and submission reads", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const oldQuote = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.oldEpisodeId,
      seasonId: foundation.seasonId,
      createdAt: 10,
    });
    const nextWithOrder = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      status: "INCLUDED",
      bracketOrder: 2,
      createdAt: 20,
    });
    const nextWithoutOrder = await insertQuote(t, {
      userId: otherId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      createdAt: 30,
    });

    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.quotes.listAdminEpisodes, {}),
      "FORBIDDEN",
    );
    const episodes = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.quotes.listAdminEpisodes, {});
    expect(episodes.map((episode) => episode.number)).toEqual([
      12, 11, 10,
    ]);
    expect(episodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: foundation.nextEpisodeId,
          submissionCount: 2,
        }),
        expect.objectContaining({
          id: foundation.oldEpisodeId,
          submissionCount: 1,
        }),
      ]),
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("episodes", foundation.oldEpisodeId, {
        status: undefined,
      });
    });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.quotes.listAdminEpisodes, {}),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: foundation.oldEpisodeId,
          status: null,
        }),
      ]),
    );

    const list = await t.withIdentity(ADMIN_IDENTITY).query(
      api.games.quotes.listAdminForEpisode,
      { episodeId: foundation.nextEpisodeId },
    );
    expect(list.map((submission) => submission.id)).toEqual([
      nextWithoutOrder,
      nextWithOrder,
    ]);
    expect(list[0]).toMatchObject({
      user: {
        id: otherId,
        email: "quote-other@example.test",
      },
      episode: { id: foundation.nextEpisodeId },
      season: { id: foundation.seasonId },
      point: null,
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.quotes.getAdminById,
        { id: oldQuote },
      ),
    ).resolves.toMatchObject({ id: oldQuote });
    await t.run(async (ctx) => {
      await ctx.db.delete("quoteSubmissions", oldQuote);
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.quotes.getAdminById,
        { id: oldQuote },
      ),
    ).resolves.toBeNull();
  });

  test("supports administrator creation, content correction, and moderation", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);

    const created = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.quotes.createForUser,
      {
        clientApiVersion: BBPC_API_VERSION,
        episodeId: foundation.nextEpisodeId,
        userId: memberId,
        ...memberContent,
        now: 100,
      },
    );
    expect(created).toMatchObject({
      userId: memberId,
      status: "SUBMITTED",
      adminNotes: null,
      seasonId: foundation.seasonId,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.createForUser,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: foundation.nextEpisodeId,
          userId: memberId,
          ...memberContent,
        },
      ),
      "CONFLICT",
    );

    const second = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.quotes.createForUser,
      {
        clientApiVersion: BBPC_API_VERSION,
        episodeId: foundation.nextEpisodeId,
        userId: otherId,
        quoteText: "Minimal administrator quote",
        sourceTitle: "Minimal administrator source",
        sourceType: "OTHER",
        today: "2030-01-01",
      },
    );
    expect(second.seasonId).toBe(foundation.seasonId);
    expect(second).toMatchObject({
      clipUrl: null,
      clipStartSeconds: null,
      listenerNotes: null,
    });

    const updated = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.quotes.updateContent,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        quoteText: " Corrected ",
        sourceTitle: " Corrected source ",
        sourceType: "OTHER",
        clipUrl: null,
        clipStartSeconds: null,
        listenerNotes: null,
        adminNotes: " Private ",
        now: 120,
      },
    );
    expect(updated).toMatchObject({
      quoteText: "Corrected",
      adminNotes: "Private",
      clipUrl: null,
      updatedAt: 120,
    });
    const included = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.quotes.setStatus,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        status: "INCLUDED",
      },
    );
    expect(included.status).toBe("INCLUDED");
    await t.run(async (ctx) => {
      await ctx.db.patch("quoteSubmissions", created.id, {
        bracketOrder: 1,
        placement: 1,
      });
    });
    const rejected = await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.quotes.setStatus,
      {
        clientApiVersion: BBPC_API_VERSION,
        id: created.id,
        status: "REJECTED",
        now: 140,
      },
    );
    expect(rejected).toMatchObject({
      status: "REJECTED",
      bracketOrder: null,
      placement: null,
    });

    await t.run(async (ctx) => {
      const pointId = await ctx.db.insert("points", {
        userId: memberId,
        seasonId: foundation.seasonId,
        adjustment: 40,
        reason: "Award",
        earnedAt: 1,
      });
      await ctx.db.patch("quoteSubmissions", created.id, {
        status: "INCLUDED",
        pointId,
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.updateContent,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: created.id,
          quoteText: "Blocked",
          sourceTitle: "Blocked",
          sourceType: "MOVIE",
        },
      ),
      "CONFLICT",
    );
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.setStatus,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: created.id,
          status: "REJECTED",
        },
      ),
      "CONFLICT",
    );

    const mine = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.quotes.currentForMe, {});
    expect(mine.submission?.scored).toBe(true);
    expect(JSON.stringify(mine)).not.toContain("Private");
  });

  test("randomizes only included entries with a deterministic dense order", async () => {
    const t = createTestBackend();
    const { adminId, memberId, otherId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const ids = await Promise.all([
      insertQuote(t, {
        userId: adminId,
        episodeId: foundation.nextEpisodeId,
        seasonId: foundation.seasonId,
        status: "INCLUDED",
        createdAt: 1,
      }),
      insertQuote(t, {
        userId: memberId,
        episodeId: foundation.nextEpisodeId,
        seasonId: foundation.seasonId,
        status: "INCLUDED",
        createdAt: 2,
      }),
      insertQuote(t, {
        userId: otherId,
        episodeId: foundation.nextEpisodeId,
        seasonId: foundation.seasonId,
        status: "REJECTED",
        bracketOrder: 9,
        createdAt: 3,
      }),
    ]);

    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.randomizeIncluded,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: foundation.nextEpisodeId,
          seed: " ",
        },
      ),
      "VALIDATION_FAILED",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.randomizeIncluded,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: foundation.nextEpisodeId,
          seed: "round-one",
          now: 100,
        },
      ),
    ).resolves.toEqual({ count: 2 });
    const firstOrder = await t.run(async (ctx) => {
      const rows = await Promise.all(
        ids.map(async (id) => await ctx.db.get("quoteSubmissions", id)),
      );
      return rows.map((row) => row?.bracketOrder);
    });
    expect(firstOrder.slice(0, 2).sort()).toEqual([1, 2]);
    expect(firstOrder[2]).toBe(9);
    await t.withIdentity(ADMIN_IDENTITY).mutation(
      api.games.quotes.randomizeIncluded,
      {
        clientApiVersion: BBPC_API_VERSION,
        episodeId: foundation.nextEpisodeId,
        seed: "round-one",
      },
    );
    const secondOrder = await t.run(async (ctx) => {
      const rows = await Promise.all(
        ids.map(async (id) => await ctx.db.get("quoteSubmissions", id)),
      );
      return rows.map((row) => row?.bracketOrder);
    });
    expect(secondOrder).toEqual(firstOrder);
  });

  test("awards, recalculates, clears, and safely deletes placement points", async () => {
    const t = createTestBackend();
    const { adminId, memberId, otherId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const firstId = await insertQuote(t, {
      userId: adminId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      status: "INCLUDED",
      createdAt: 1,
    });
    const secondId = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      status: "INCLUDED",
      createdAt: 2,
    });
    const thirdId = await insertQuote(t, {
      userId: otherId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      status: "INCLUDED",
      createdAt: 3,
    });
    const rejectedId = await insertQuote(t, {
      userId: otherId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      status: "REJECTED",
      createdAt: 4,
    });
    const otherEpisodeId = await insertQuote(t, {
      userId: otherId,
      episodeId: foundation.recordingEpisodeId,
      seasonId: foundation.seasonId,
      status: "INCLUDED",
      createdAt: 5,
    });

    for (const placements of [
      [
        { submissionId: firstId, placement: 1 },
        { submissionId: firstId, placement: 2 },
      ],
      [
        { submissionId: firstId, placement: 1 },
        { submissionId: secondId, placement: 1 },
      ],
      [
        { submissionId: firstId, placement: 1 },
        { submissionId: secondId, placement: 2 },
        { submissionId: thirdId, placement: 3 },
        { submissionId: firstId, placement: 2 },
      ],
    ]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.games.quotes.awardPlacements,
          {
            clientApiVersion: BBPC_API_VERSION,
            episodeId: foundation.nextEpisodeId,
            placements,
          },
        ),
        "VALIDATION_FAILED",
      );
    }
    for (const submissionId of [rejectedId, otherEpisodeId]) {
      await expectDomainError(
        t.withIdentity(ADMIN_IDENTITY).mutation(
          api.games.quotes.awardPlacements,
          {
            clientApiVersion: BBPC_API_VERSION,
            episodeId: foundation.nextEpisodeId,
            placements: [{ submissionId, placement: 1 }],
          },
        ),
        "VALIDATION_FAILED",
      );
    }

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.awardPlacements,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: foundation.nextEpisodeId,
          placements: [],
        },
      ),
    ).resolves.toEqual({ awarded: 0, cleared: 0 });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.awardPlacements,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: foundation.nextEpisodeId,
          placements: [
            { submissionId: firstId, placement: 1 },
            { submissionId: secondId, placement: 2 },
            { submissionId: thirdId, placement: 3 },
          ],
          earnedAt: 100,
          now: 100,
        },
      ),
    ).resolves.toEqual({ awarded: 3, cleared: 0 });
    const awarded = await t.run(async (ctx) => {
      const submissions = await Promise.all(
        [firstId, secondId, thirdId].map(
          async (id) => await ctx.db.get("quoteSubmissions", id),
        ),
      );
      const points = await Promise.all(
        submissions.map(async (submission) =>
          submission?.pointId === undefined
            ? null
            : await ctx.db.get("points", submission.pointId),
        ),
      );
      return { submissions, points };
    });
    expect(
      awarded.submissions.map((submission) => submission?.placement),
    ).toEqual([1, 2, 3]);
    expect(
      awarded.points.map((point) => point?.adjustment),
    ).toEqual([40, 20, 10]);
    expect(
      awarded.points.map((point) => point?.earnedAt),
    ).toEqual([100, 100, 100]);

    const firstPointId = awarded.submissions[0]?.pointId;
    const secondPointId = awarded.submissions[1]?.pointId;
    const thirdPointId = awarded.submissions[2]?.pointId;
    if (
      firstPointId === undefined ||
      secondPointId === undefined ||
      thirdPointId === undefined
    ) {
      throw new Error("Expected quote award points");
    }
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.awardPlacements,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: foundation.nextEpisodeId,
          placements: [{ submissionId: firstId, placement: 2 }],
          expectedAwards: [
            {
              submissionId: firstId,
              pointId: firstPointId,
              placement: 2,
            },
          ],
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.awardPlacements,
        {
          clientApiVersion: BBPC_API_VERSION,
          episodeId: foundation.nextEpisodeId,
          placements: [{ submissionId: firstId, placement: 2 }],
          expectedAwards: [
            {
              submissionId: firstId,
              pointId: firstPointId,
              placement: 1,
            },
            {
              submissionId: secondId,
              pointId: secondPointId,
              placement: 2,
            },
            {
              submissionId: thirdId,
              pointId: thirdPointId,
              placement: 3,
            },
          ],
          earnedAt: 200,
          now: 200,
        },
      ),
    ).resolves.toEqual({ awarded: 1, cleared: 2 });
    const recalculated = await t.run(async (ctx) => {
      return {
        first: await ctx.db.get("points", firstPointId),
        second: await ctx.db.get("points", secondPointId),
        third: await ctx.db.get("points", thirdPointId),
        secondQuote: await ctx.db.get("quoteSubmissions", secondId),
      };
    });
    expect(recalculated.first).toMatchObject({
      adjustment: 20,
      earnedAt: 100,
    });
    expect(recalculated.second).toBeNull();
    expect(recalculated.third).toBeNull();
    expect(recalculated.secondQuote?.pointId).toBeUndefined();
    expect(recalculated.secondQuote?.placement).toBeUndefined();
    expect(recalculated.secondQuote?.updatedAt).toBe(200);

    const sharedQuoteId = await insertQuote(t, {
      userId: otherId,
      episodeId: foundation.recordingEpisodeId,
      seasonId: foundation.seasonId,
      status: "INCLUDED",
      pointId: firstPointId,
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: firstId,
        },
      ),
      "CONFLICT",
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("quoteSubmissions", sharedQuoteId, {
        pointId: undefined,
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: firstId,
          expectedAward: {
            pointId: null,
            placement: null,
          },
        },
      ),
      "CONFLICT",
    );
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: firstId,
          expectedAward: {
            pointId: firstPointId,
            placement: 2,
          },
        },
      ),
    ).resolves.toEqual({ id: firstId });
    await t.run(async (ctx) => {
      expect(await ctx.db.get("points", firstPointId)).toBeNull();
      expect(await ctx.db.get("quoteSubmissions", firstId)).toBeNull();
    });
    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(
        api.games.quotes.remove,
        {
          clientApiVersion: BBPC_API_VERSION,
          id: otherEpisodeId,
          expectedAward: {
            pointId: null,
            placement: null,
          },
        },
      ),
    ).resolves.toEqual({ id: otherEpisodeId });
  });

  test("fails closed on broken administrator hydration", async () => {
    const t = createTestBackend();
    const { adminId, memberId, otherId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const quoteId = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("users", memberId);
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.quotes.getAdminById,
        { id: quoteId },
      ),
      "CONFLICT",
    );

    const missingPointId = await t.run(async (ctx) => {
      const pointId = await ctx.db.insert("points", {
        userId: otherId,
        seasonId: foundation.seasonId,
        adjustment: 10,
        earnedAt: 1,
      });
      const id = await ctx.db.insert("quoteSubmissions", {
        userId: otherId,
        episodeId: foundation.oldEpisodeId,
        seasonId: foundation.seasonId,
        quoteText: "Missing point quote",
        sourceTitle: "Missing point source",
        sourceType: "MOVIE",
        status: "INCLUDED",
        pointId,
        createdAt: 2,
        updatedAt: 2,
      });
      await ctx.db.delete("points", pointId);
      return id;
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.quotes.getAdminById,
        { id: missingPointId },
      ),
      "CONFLICT",
    );

    const mismatchedPointId = await t.run(async (ctx) => {
      const pointId = await ctx.db.insert("points", {
        userId: otherId,
        seasonId: foundation.seasonId,
        adjustment: 20,
        earnedAt: 3,
      });
      return await ctx.db.insert("quoteSubmissions", {
        userId: adminId,
        episodeId: foundation.recordingEpisodeId,
        seasonId: foundation.seasonId,
        quoteText: "Mismatched point quote",
        sourceTitle: "Mismatched point source",
        sourceType: "TV",
        status: "INCLUDED",
        pointId,
        createdAt: 3,
        updatedAt: 3,
      });
    });
    await expectDomainError(
      t.withIdentity(ADMIN_IDENTITY).query(
        api.games.quotes.getAdminById,
        { id: mismatchedPointId },
      ),
      "CONFLICT",
    );
  });

  test("finds a quote inside a longer transcript passage", () => {
    const match = transcriptQuoteMatch(
      "Im going to make him an offer he cannot refuse",
      GODFATHER_PASSAGE,
    );
    expect(match?.similarity).toBeGreaterThanOrEqual(
      TRANSCRIPT_MATCH_THRESHOLD,
    );
    expect(match?.excerpt).toContain("offer he can't refuse");
    expect(match?.excerpt.startsWith("…")).toBe(true);
    expect(match?.excerpt.endsWith("…")).toBe(true);
    expect(
      transcriptQuoteMatch("Tiny", GODFATHER_PASSAGE),
    ).toBeNull();
  });

  test("does not treat a passage that only shares words as a transcript match", () => {
    const quote = "Nobody puts Baby in a corner";
    const match = transcriptQuoteMatch(
      quote,
      "we put the baby monitor in a corner of the room and nobody noticed it for a week",
    );
    expect(match?.similarity ?? 0).toBeLessThan(
      transcriptMatchThreshold(quote),
    );
  });

  test("requires near-exact transcript matches for short quotes and bounds search terms", () => {
    expect(transcriptMatchThreshold("I'll be back")).toBe(
      SHORT_TRANSCRIPT_MATCH_THRESHOLD,
    );
    expect(transcriptMatchThreshold("May the Force be with you")).toBe(
      TRANSCRIPT_MATCH_THRESHOLD,
    );
    expect(transcriptSearchQuery("Tiny")).toBeNull();
    expect(transcriptSearchQuery("I'll be back, I'll be back")).toBe(
      "i ll be back",
    );
    const longQuote = Array.from(
      { length: 20 },
      (_, index) => `word${"x".repeat(index)}`,
    ).join(" ");
    expect(transcriptSearchQuery(longQuote)?.split(" ")).toHaveLength(16);
  });

  test("weighs reuse evidence by similarity, status, and source", () => {
    const exact = {
      similarity: 1,
      status: "INCLUDED" as const,
      placed: false,
      sourceTitleMatches: true,
    };
    expect(submissionReuseLikelihood(exact)).toBeCloseTo(0.95);
    expect(
      submissionReuseLikelihood({ ...exact, status: "SUBMITTED" }),
    ).toBeCloseTo(0.6);
    expect(
      submissionReuseLikelihood({ ...exact, status: "REJECTED", placed: true }),
    ).toBeCloseTo(0.95);
    expect(
      submissionReuseLikelihood({ ...exact, sourceTitleMatches: false }),
    ).toBeCloseTo(0.475);
    expect(
      submissionReuseLikelihood({ ...exact, similarity: 0.6 }),
    ).toBe(0);
    expect(
      submissionReuseLikelihood({ ...exact, similarity: 0.68 }),
    ).toBeCloseTo(0.475);
    expect(combineReuseLikelihoods([])).toBe(0);
    // Distinct evidence in two episodes compounds.
    expect(
      combineReuseLikelihoods([
        { distinct: 0.5, other: 0 },
        { distinct: 0.5, other: 0 },
      ]),
    ).toBeCloseTo(0.75);
    // Near-misses count once, through the strongest of them.
    expect(
      combineReuseLikelihoods([
        { distinct: 0, other: 0.4 },
        { distinct: 0, other: 0.3 },
        { distinct: 0.5, other: 0.2 },
      ]),
    ).toBeCloseTo(1 - 0.5 * 0.6);
  });

  test("warns listeners about published transcripts that contain the quote", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const hiddenEpisodeId = await t.run(async (ctx) => {
      await ctx.db.patch("episodes", foundation.oldEpisodeId, {
        slug: "old-episode",
      });
      return await ctx.db.insert("episodes", {
        number: 9,
        title: "Hidden episode",
        status: "draft",
      });
    });
    await insertPassage(t, {
      episodeId: foundation.oldEpisodeId,
      text: GODFATHER_PASSAGE,
      start: 3723,
    });
    // Not public in the index, and public in the index but no longer published.
    await insertPassage(t, {
      episodeId: foundation.recordingEpisodeId,
      text: GODFATHER_PASSAGE,
      isPublic: false,
    });
    await insertPassage(t, {
      episodeId: hiddenEpisodeId,
      text: GODFATHER_PASSAGE,
    });

    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "Im going to make him an offer he cannot refuse",
          sourceTitle: "Godfather",
        },
      ),
    ).resolves.toMatchObject({
      possibleMatch: false,
      transcriptMatches: [
        {
          episodeNumber: 10,
          episodeTitle: "Old episode",
          episodeSlug: "old-episode",
          start: 3723,
        },
      ],
    });
    const { transcriptMatches } = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.quotes.checkPossibleDuplicate, {
        quoteText: "Im going to make him an offer he cannot refuse",
        sourceTitle: "",
      });
    expect(transcriptMatches).toHaveLength(1);
    expect(transcriptMatches[0]?.excerpt).toContain("offer he can't refuse");
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "Leave the gun. Take the cannoli.",
          sourceTitle: "Godfather",
        },
      ),
    ).resolves.toEqual({ possibleMatch: false, transcriptMatches: [] });
  });

  test("estimates administrator reuse likelihood from earlier episodes only", async () => {
    const t = createTestBackend();
    const { memberId, otherId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const { olderEpisodeId, laterEpisodeId } = await t.run(async (ctx) => ({
      olderEpisodeId: await ctx.db.insert("episodes", {
        number: 9,
        title: "Older episode",
        status: "published",
        slug: "older-episode",
        date: "2026-01-09",
      }),
      laterEpisodeId: await ctx.db.insert("episodes", {
        number: 14,
        title: "Later episode",
        status: "published",
      }),
    }));
    const subjectId = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.recordingEpisodeId,
      seasonId: foundation.seasonId,
      status: "INCLUDED",
      quoteText: "I'm gonna make him an offer he can't refuse.",
      sourceTitle: "The Godfather",
    });
    const earlierId = await insertQuote(t, {
      userId: otherId,
      episodeId: foundation.oldEpisodeId,
      seasonId: foundation.seasonId,
      status: "INCLUDED",
      placement: 1,
      quoteText: "Im going to make him an offer he cannot refuse",
      sourceTitle: "Godfather",
    });
    for (const episodeId of [
      foundation.recordingEpisodeId,
      laterEpisodeId,
    ]) {
      await insertQuote(t, {
        userId: otherId,
        episodeId,
        seasonId: foundation.seasonId,
        quoteText: "I'm gonna make him an offer he can't refuse.",
        sourceTitle: "The Godfather",
      });
    }
    await insertQuote(t, {
      userId: otherId,
      episodeId: olderEpisodeId,
      seasonId: foundation.seasonId,
      quoteText: "Leave the gun. Take the cannoli.",
      sourceTitle: "The Godfather",
    });
    for (const episodeId of [
      olderEpisodeId,
      foundation.recordingEpisodeId,
      laterEpisodeId,
    ]) {
      await insertPassage(t, {
        episodeId,
        text: GODFATHER_PASSAGE,
        start: 125,
        isPublic: episodeId !== foundation.recordingEpisodeId,
      });
    }

    await expectDomainError(
      t
        .withIdentity(MEMBER_IDENTITY)
        .query(api.games.quotes.getAdminReuseReport, { id: subjectId }),
      "FORBIDDEN",
    );
    const report = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.quotes.getAdminReuseReport, { id: subjectId });
    expect(report?.submission).toMatchObject({
      id: subjectId,
      user: { name: "Quote Member" },
      episode: { number: 11 },
    });
    expect(report?.episodes.map(({ episode }) => episode.number)).toEqual([
      9, 10,
    ]);
    const episodes = report?.episodes ?? [];
    const [older, old] = episodes;
    expect(older).toMatchObject({
      episode: { slug: "older-episode", date: "2026-01-09" },
      submissions: [],
      transcriptPassages: [{ start: 125, similarity: 1 }],
    });
    expect(episodes[0]?.transcriptPassages[0]?.excerpt).toContain(
      "offer he can't refuse",
    );
    expect(old).toMatchObject({
      submissions: [
        {
          id: earlierId,
          status: "INCLUDED",
          placement: 1,
          sourceTitleMatches: true,
          user: { name: "Quote Other" },
        },
      ],
      transcriptPassages: [],
    });
    expect(report?.likelihood).toBeGreaterThan(
      Math.max(...episodes.map(({ likelihood }) => likelihood)),
    );
    expect(report?.likelihood).toBeLessThan(1);
    expect(report?.limited).toBe(false);

    const unrelatedId = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      quoteText: "Nobody puts Baby in a corner",
      sourceTitle: "Dirty Dancing",
    });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.quotes.getAdminReuseReport, { id: unrelatedId }),
    ).resolves.toMatchObject({ likelihood: 0, episodes: [] });
    await t.run(async (ctx) => {
      await ctx.db.delete("quoteSubmissions", unrelatedId);
    });
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.quotes.getAdminReuseReport, { id: unrelatedId }),
    ).resolves.toBeNull();
  });

  test("scores weak, rejected, and short-quote evidence below strong evidence", () => {
    const base = {
      similarity: 1,
      status: "REJECTED" as const,
      placed: false,
      sourceTitleMatches: true,
    };
    expect(submissionReuseLikelihood(base)).toBeCloseTo(0.35);
    // Halfway between the evidence floor and the warning threshold.
    expect(
      submissionReuseLikelihood({
        ...base,
        status: "INCLUDED",
        similarity: 0.64,
      }),
    ).toBeCloseTo(0.25 * 0.95);
    expect(transcriptReuseLikelihood("I'll be back", 1)).toBeCloseTo(0.45);
    expect(
      transcriptReuseLikelihood("May the Force be with you", 1),
    ).toBeCloseTo(0.9);
  });

  test("handles transcript passages with no shared words or shorter than the quote", () => {
    expect(
      transcriptQuoteMatch(
        "Nobody puts Baby in a corner",
        "completely unrelated chatter about lunch",
      ),
    ).toBeNull();
    const match = transcriptQuoteMatch(
      "I'm gonna make him an offer he can't refuse",
      "an offer he can't refuse",
    );
    expect(match?.excerpt).toBe("an offer he can't refuse");
    expect(match?.similarity ?? 1).toBeLessThan(TRANSCRIPT_MATCH_THRESHOLD);
  });

  test("returns at most three transcript episodes, best match first", async () => {
    const t = createTestBackend();
    await seedActors(t);
    await advanceToS3(t);
    await seedFoundation(t);
    const episodeIds = await t.run(async (ctx) =>
      Promise.all(
        [1, 2, 3, 4].map(async (number) =>
          ctx.db.insert("episodes", {
            number,
            title: `Published ${String(number)}`,
            status: "published",
            ...(number === 1 ? {} : { slug: `published-${String(number)}` }),
          }),
        ),
      ),
    );
    const [first, second, third, fourth] = episodeIds;
    if (!first || !second || !third || !fourth) {
      throw new Error("Episodes were not created.");
    }
    // Episode 1 has the only exact match; the others read it with drift.
    const drifted =
      "and it goes Im going to make him an offer he cannot refuse which is great";
    await insertPassage(t, { episodeId: first, text: GODFATHER_PASSAGE, start: 5 });
    await insertPassage(t, { episodeId: first, text: drifted, start: 500 });
    for (const episodeId of [second, third, fourth]) {
      await insertPassage(t, { episodeId, text: drifted, start: 60 });
    }

    const { transcriptMatches } = await t
      .withIdentity(MEMBER_IDENTITY)
      .query(api.games.quotes.checkPossibleDuplicate, {
        quoteText: "I'm gonna make him an offer he can't refuse.",
        sourceTitle: "",
      });
    expect(
      transcriptMatches.map(({ episodeNumber, episodeSlug, start }) => ({
        episodeNumber,
        episodeSlug,
        start,
      })),
    ).toEqual([
      { episodeNumber: 1, episodeSlug: null, start: 5 },
      { episodeNumber: 4, episodeSlug: "published-4", start: 60 },
      { episodeNumber: 3, episodeSlug: "published-3", start: 60 },
    ]);
  });

  test("includes unpublished earlier transcripts and keeps three distinct passages per episode", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const subjectId = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.recordingEpisodeId,
      seasonId: foundation.seasonId,
      quoteText: "I'm gonna make him an offer he can't refuse.",
      sourceTitle: "The Godfather",
    });
    // Overlapping windows collapse to one; five distinct ones are capped at three.
    for (const [start, end] of [
      [0, 30],
      [10, 40],
      [100, 130],
      [200, 230],
      [300, 330],
      [400, 430],
    ] as const) {
      await insertPassage(t, {
        episodeId: foundation.oldEpisodeId,
        text: GODFATHER_PASSAGE,
        start,
        end,
        isPublic: false,
      });
    }

    const report = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.quotes.getAdminReuseReport, { id: subjectId });
    const passages = report?.episodes[0]?.transcriptPassages ?? [];
    expect(report?.episodes).toHaveLength(1);
    expect(passages).toHaveLength(3);
    for (const passage of passages) {
      for (const other of passages) {
        if (passage !== other) {
          expect(
            passage.start <= other.end && other.start <= passage.end,
          ).toBe(false);
        }
      }
    }
  });

  test("reports a capped search and fails closed on a missing subject episode", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const subjectId = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.recordingEpisodeId,
      seasonId: foundation.seasonId,
      quoteText: "I'm gonna make him an offer he can't refuse.",
      sourceTitle: "The Godfather",
    });
    for (
      let index = 0;
      index < MAX_QUOTE_TRANSCRIPT_CANDIDATES_FOR_ADMIN;
      index += 1
    ) {
      await insertPassage(t, {
        episodeId: foundation.oldEpisodeId,
        text: GODFATHER_PASSAGE,
        start: index * 100,
      });
    }
    await expect(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.quotes.getAdminReuseReport, { id: subjectId }),
    ).resolves.toMatchObject({ limited: true });

    await t.run(async (ctx) => {
      await ctx.db.delete("episodes", foundation.recordingEpisodeId);
    });
    await expectDomainError(
      t
        .withIdentity(ADMIN_IDENTITY)
        .query(api.games.quotes.getAdminReuseReport, { id: subjectId }),
      "CONFLICT",
    );
  });

  test("does not compound an everyday phrase heard across many episodes", async () => {
    const t = createTestBackend();
    const { memberId } = await seedActors(t);
    await advanceToS3(t);
    const foundation = await seedFoundation(t);
    const subjectId = await insertQuote(t, {
      userId: memberId,
      episodeId: foundation.nextEpisodeId,
      seasonId: foundation.seasonId,
      quoteText: "I'll be back",
      sourceTitle: "The Terminator",
    });
    const earlierIds = await t.run(async (ctx) =>
      Promise.all(
        [1, 2, 3, 4, 5].map(async (number) =>
          ctx.db.insert("episodes", {
            number,
            title: `Chat ${String(number)}`,
            status: "published",
          }),
        ),
      ),
    );
    for (const episodeId of earlierIds) {
      await insertPassage(t, {
        episodeId,
        text: "hold that thought I'll be back after the break",
      });
    }

    const report = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.games.quotes.getAdminReuseReport, { id: subjectId });
    expect(report?.episodes).toHaveLength(5);
    expect(report?.likelihood).toBeCloseTo(0.45);
  });
});
