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
  quoteSearchAnchors,
  quotesPossiblyMatch,
} from "./games/quoteSimilarity.js";
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

describe("Quotabunga workflows", () => {
  test("classifies possible duplicates without treating every shared phrase as a match", () => {
    expect(
      quoteSearchAnchors(
        "I'm gonna make him an offer he can't refuse.",
      ),
    ).toEqual(["refuse", "gonna", "offer"]);
    expect(
      quotesPossiblyMatch(
        {
          quoteText: "I'm gonna make him an offer he can't refuse.",
          sourceTitle: "The Godfather",
        },
        {
          quoteText: "Im going to make him an offer he cannot refuse",
          sourceTitle: "Godfather",
        },
      ),
    ).toBe(true);
    expect(
      quotesPossiblyMatch(
        {
          quoteText: "I'll be back.",
          sourceTitle: "The Terminator",
        },
        {
          quoteText: "Ill be back",
          sourceTitle: "Terminator",
        },
      ),
    ).toBe(true);
    expect(
      quotesPossiblyMatch(
        {
          quoteText: "I'll be back.",
          sourceTitle: "The Terminator",
        },
        {
          quoteText: "I'll be back.",
          sourceTitle: "Last Action Hero",
        },
      ),
    ).toBe(false);
    expect(
      quotesPossiblyMatch(
        {
          quoteText: "Im going to make him an offer he cannot refuse",
          sourceTitle: "",
        },
        {
          quoteText: "I'm gonna make him an offer he can't refuse.",
          sourceTitle: "The Godfather",
        },
      ),
    ).toBe(true);
    expect(
      quotesPossiblyMatch(
        {
          quoteText: "This town needs an enema.",
          sourceTitle: "Batman",
        },
        {
          quoteText: "I'm Batman.",
          sourceTitle: "Batman",
        },
      ),
    ).toBe(false);
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
    ).resolves.toEqual({ possibleMatch: true });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "Im going to make him an offer he cannot refuse",
          sourceTitle: "",
        },
      ),
    ).resolves.toEqual({ possibleMatch: true });
    await expect(
      t.withIdentity(MEMBER_IDENTITY).query(
        api.games.quotes.checkPossibleDuplicate,
        {
          quoteText: "Leave the gun. Take the cannoli.",
          sourceTitle: "Godfather",
        },
      ),
    ).resolves.toEqual({ possibleMatch: false });

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
    ).resolves.toEqual({ possibleMatch: false });
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
});
