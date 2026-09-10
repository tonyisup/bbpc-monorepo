import type { FunctionArgs } from "convex/server";
import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

import { z } from "zod";

import {
  adminGamblingEntrySchema,
  adminGuessSchema,
  adminPointSchema,
} from "./seasonDetails";
import { adminSyllabusEntrySchema } from "./syllabus";
import { adminTagVoteSchema } from "./tags";
import { BBPC_CLIENT_API_VERSION } from "./identity";
import { adminRoleMembershipSchema, adminUserSchema } from "./users";

const idResultSchema = z.object({ id: z.string().min(1) });
const totalSchema = z.number();

function pageSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    page: z.array(itemSchema),
    isDone: z.boolean(),
    continueCursor: z.string(),
    splitCursor: z.string().nullable().optional(),
    pageStatus: z
      .enum(["SplitRecommended", "SplitRequired"])
      .nullable()
      .optional(),
  });
}

export type ConvexUserDetail = z.infer<typeof adminUserSchema>;
export type ConvexUserPoint = z.infer<typeof adminPointSchema>;
export type ConvexUserGuess = z.infer<typeof adminGuessSchema>;
export type ConvexUserGamblingEntry = z.infer<typeof adminGamblingEntrySchema>;
export type ConvexUserSyllabusEntry = z.infer<typeof adminSyllabusEntrySchema>;
export type ConvexUserTagVote = z.infer<typeof adminTagVoteSchema>;
export type ConvexUserSeasonSelector =
  | { kind: "all" }
  | { kind: "current"; today: string }
  | { kind: "season"; seasonId: string };
export type ConvexUserSeasonTarget =
  | { kind: "current"; today: string }
  | { kind: "season"; seasonId: string };

export interface ConvexUserPage<T> {
  items: T[];
  isDone: boolean;
  continueCursor: string;
}

const getUserReference = api.identity.admin.getUser;

const listSyllabusReference = api.syllabus.admin.listForUser;

const listPointsReference = api.games.points.listForUserPage;

const totalPointsReference = api.games.points.totalForUser;

const listGuessesReference = api.games.guesses.listForUserPage;

const listGamblingReference = api.games.gambling.listForUserPage;

const listVotesReference = api.games.tags.listVotesForUserPage;

const updateUserReference = api.identity.admin.updateUser;

const setUserStatusReference = api.identity.admin.setUserStatus;

const assignRoleReference = api.identity.admin.assignRole;

const removeRoleReference = api.identity.admin.removeRoleMembership;

const assignEpisodeReference = api.syllabus.admin.assignEpisode;

const unlinkEpisodeReference = api.syllabus.admin.unlinkEpisode;

const removeSyllabusReference = api.syllabus.admin.removeEntry;

const reorderSyllabusReference = api.syllabus.admin.reorderPendingForUser;

const createPointReference = api.games.points.create;

const createWagerReference = api.games.gambling.create;

const updateWagerStatusReference = api.games.gambling.updateStatus;

const updateWagerPointsReference = api.games.gambling.updatePoints;

const applyVotePointsReference = api.games.tags.applyVotePoints;

const deleteVoteReference = api.games.tags.deleteVote;

export const ADMIN_USER_ACTIVITY_PAGE_SIZE = 30;

export interface ConvexUserProfileSnapshot {
  name: string | null;
  email: string | null;
  status: "active" | "disabled";
  updatedAt: number;
}

export type ConvexUserSyllabusSnapshot = FunctionArgs<
  typeof removeSyllabusReference
>["expected"];

function seasonArgument(
  season: ConvexUserSeasonTarget
): FunctionArgs<typeof createPointReference>["season"];
function seasonArgument(
  season: ConvexUserSeasonSelector
): FunctionArgs<typeof totalPointsReference>["season"];
function seasonArgument(season: ConvexUserSeasonSelector) {
  return season.kind === "season"
    ? {
        kind: "season" as const,
        seasonId: documentId("seasons", season.seasonId),
      }
    : season;
}

function profileSnapshot(user: ConvexUserDetail): ConvexUserProfileSnapshot {
  return {
    name: user.name,
    email: user.email,
    status: user.status,
    updatedAt: user.updatedAt,
  };
}

function syllabusSnapshot(
  entry: ConvexUserSyllabusEntry
): ConvexUserSyllabusSnapshot {
  return {
    userId: documentId("users", entry.user.id),
    movieId: documentId("movies", entry.movie.id),
    order: entry.order,
    createdAt: entry.createdAt,
    notes: entry.notes,
    assignmentId: documentId("assignments", entry.assignment?.id ?? null),
  };
}

function assertUserId(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} does not belong to the requested user.`);
  }
}

function assertSelectedSeason(
  actual: string | null,
  selector: ConvexUserSeasonSelector,
  label: string
) {
  if (selector.kind === "season" && actual !== selector.seasonId) {
    throw new Error(`${label} does not belong to the selected season.`);
  }
}

async function loadPage<T>(
  client: ConvexReactClient,
  reference: Parameters<ConvexReactClient["query"]>[0],
  schema: z.ZodType<T>,
  args: Record<string, unknown>,
  cursor: string | null
): Promise<ConvexUserPage<T>> {
  const result = pageSchema(schema).parse(
    await client.query(reference, {
      ...args,
      paginationOpts: {
        cursor,
        numItems: ADMIN_USER_ACTIVITY_PAGE_SIZE,
      },
    })
  );
  return {
    items: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function loadConvexUserDetail(
  client: ConvexReactClient,
  userId: string
): Promise<ConvexUserDetail | null> {
  return adminUserSchema
    .nullable()
    .parse(
      await client.query(getUserReference, { id: documentId("users", userId) })
    );
}

export async function loadConvexUserSyllabus(
  client: ConvexReactClient,
  userId: string
): Promise<ConvexUserSyllabusEntry[]> {
  const entries = z
    .array(adminSyllabusEntrySchema)
    .max(100)
    .parse(
      await client.query(listSyllabusReference, {
        userId: documentId("users", userId),
      })
    );
  entries.forEach((entry) =>
    assertUserId(entry.user.id, userId, "Syllabus entry")
  );
  return entries;
}

export async function loadConvexUserPointsPage(
  client: ConvexReactClient,
  userId: string,
  season: ConvexUserSeasonSelector,
  cursor: string | null
): Promise<ConvexUserPage<ConvexUserPoint>> {
  const result = await loadPage(
    client,
    listPointsReference,
    adminPointSchema,
    { userId, season },
    cursor
  );
  result.items.forEach((point) => {
    assertUserId(point.user.id, userId, "Point");
    assertSelectedSeason(point.season.id, season, "Point");
  });
  return result;
}

export async function loadConvexUserPointTotal(
  client: ConvexReactClient,
  userId: string,
  season: ConvexUserSeasonSelector
): Promise<number> {
  return totalSchema.parse(
    await client.query(totalPointsReference, {
      userId: documentId("users", userId),
      season: seasonArgument(season),
    })
  );
}

export async function loadConvexUserGuessesPage(
  client: ConvexReactClient,
  userId: string,
  season: ConvexUserSeasonSelector,
  cursor: string | null
): Promise<ConvexUserPage<ConvexUserGuess>> {
  const result = await loadPage(
    client,
    listGuessesReference,
    adminGuessSchema,
    { userId, season },
    cursor
  );
  result.items.forEach((guess) => {
    assertUserId(guess.user.id, userId, "Guess");
    assertSelectedSeason(guess.season.id, season, "Guess");
  });
  return result;
}

export async function loadConvexUserGamblingPage(
  client: ConvexReactClient,
  userId: string,
  season: ConvexUserSeasonSelector,
  cursor: string | null
): Promise<ConvexUserPage<ConvexUserGamblingEntry>> {
  const result = await loadPage(
    client,
    listGamblingReference,
    adminGamblingEntrySchema,
    { userId, season },
    cursor
  );
  result.items.forEach((entry) => {
    assertUserId(entry.user.id, userId, "Wager");
    assertSelectedSeason(entry.season?.id ?? null, season, "Wager");
  });
  return result;
}

export async function loadConvexUserVotesPage(
  client: ConvexReactClient,
  userId: string,
  cursor: string | null
): Promise<ConvexUserPage<ConvexUserTagVote>> {
  const result = await loadPage(
    client,
    listVotesReference,
    adminTagVoteSchema,
    { userId },
    cursor
  );
  result.items.forEach((vote) => {
    if (vote.user === null) {
      throw new Error("A user-scoped tag vote is missing its user.");
    }
    assertUserId(vote.user.id, userId, "Tag vote");
  });
  return result;
}

export async function updateConvexUserProfile(
  client: ConvexReactClient,
  user: ConvexUserDetail,
  input: { name: string; email: string }
): Promise<void> {
  adminUserSchema.parse(
    await client.mutation(updateUserReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("users", user.id),
      expected: profileSnapshot(user),
      ...input,
    })
  );
}

export async function setConvexUserStatus(
  client: ConvexReactClient,
  user: ConvexUserDetail,
  status: ConvexUserDetail["status"]
): Promise<void> {
  adminUserSchema.parse(
    await client.mutation(setUserStatusReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("users", user.id),
      expected: profileSnapshot(user),
      status,
    })
  );
}

export async function assignConvexUserRole(
  client: ConvexReactClient,
  userId: string,
  roleId: string
): Promise<void> {
  adminRoleMembershipSchema.parse(
    await client.mutation(assignRoleReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      userId: documentId("users", userId),
      roleId: documentId("roles", roleId),
    })
  );
}

export async function removeConvexUserRole(
  client: ConvexReactClient,
  userId: string,
  membership: ConvexUserDetail["roles"][number]
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeRoleReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("userRoles", membership.id),
      expected: {
        userId: documentId("users", userId),
        roleId: documentId("roles", membership.role.id),
        assignedAt: membership.assignedAt,
        assignedBy: documentId("users", membership.assignedBy),
      },
    })
  );
}

export async function assignConvexUserSyllabusEpisode(
  client: ConvexReactClient,
  entry: ConvexUserSyllabusEntry,
  episodeNumber: number,
  assignmentType: string
): Promise<void> {
  adminSyllabusEntrySchema.parse(
    await client.mutation(assignEpisodeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      syllabusId: documentId("syllabusEntries", entry.id),
      expected: syllabusSnapshot(entry),
      episodeNumber,
      assignmentType,
    })
  );
}

export async function unlinkConvexUserSyllabusEpisode(
  client: ConvexReactClient,
  entry: ConvexUserSyllabusEntry
): Promise<void> {
  adminSyllabusEntrySchema.parse(
    await client.mutation(unlinkEpisodeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      syllabusId: documentId("syllabusEntries", entry.id),
      expected: syllabusSnapshot(entry),
    })
  );
}

export async function removeConvexUserSyllabusEntry(
  client: ConvexReactClient,
  entry: ConvexUserSyllabusEntry
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeSyllabusReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("syllabusEntries", entry.id),
      expected: syllabusSnapshot(entry),
    })
  );
}

export async function reorderConvexUserPendingSyllabus(
  client: ConvexReactClient,
  userId: string,
  entries: ConvexUserSyllabusEntry[]
): Promise<void> {
  z.array(adminSyllabusEntrySchema)
    .max(100)
    .parse(
      await client.mutation(reorderSyllabusReference, {
        clientApiVersion: BBPC_CLIENT_API_VERSION,
        userId: documentId("users", userId),
        items: entries.map((entry) => ({
          id: documentId("syllabusEntries", entry.id),
          expectedOrder: entry.order,
        })),
      })
    );
}

export async function createConvexUserPoint(
  client: ConvexReactClient,
  input: {
    userId: string;
    season: ConvexUserSeasonTarget;
    reason: string | null;
    adjustment: number | null;
    gamePointTypeId: string | null;
  }
): Promise<void> {
  adminPointSchema.parse(
    await client.mutation(createPointReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      userId: documentId("users", input.userId),
      season: seasonArgument(input.season),
      adjustment: input.adjustment,
      ...(input.reason === null ? {} : { reason: input.reason }),
      ...(input.gamePointTypeId === null
        ? {}
        : {
            gamePointTypeId: documentId(
              "gamePointTypes",
              input.gamePointTypeId
            ),
          }),
    })
  );
}

export async function createConvexUserWager(
  client: ConvexReactClient,
  input: {
    userId: string;
    season: ConvexUserSeasonTarget;
    points: number;
    gamblingTypeId: string;
  }
): Promise<void> {
  adminGamblingEntrySchema.parse(
    await client.mutation(createWagerReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
      season: seasonArgument(input.season),
      gamblingTypeId: documentId("gamblingTypes", input.gamblingTypeId),
      userId: documentId("users", input.userId),
    })
  );
}

export async function updateConvexUserWagerStatus(
  client: ConvexReactClient,
  entry: ConvexUserGamblingEntry,
  status: ConvexUserGamblingEntry["status"],
  season?: ConvexUserSeasonTarget
): Promise<void> {
  adminGamblingEntrySchema.parse(
    await client.mutation(updateWagerStatusReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("gamblingEntries", entry.id),
      status,
      expectedStatus: entry.status,
      ...(season === undefined ? {} : { season: seasonArgument(season) }),
    })
  );
}

export async function updateConvexUserWagerPoints(
  client: ConvexReactClient,
  entry: ConvexUserGamblingEntry,
  points: number
): Promise<void> {
  adminGamblingEntrySchema.parse(
    await client.mutation(updateWagerPointsReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("gamblingEntries", entry.id),
      expected: {
        points: entry.points,
        status: entry.status,
        awardPointId: documentId("points", entry.awardPoint?.id ?? null),
      },
      points,
    })
  );
}

export async function applyConvexUserVotePoints(
  client: ConvexReactClient,
  voteId: string,
  today: string
): Promise<void> {
  adminTagVoteSchema.parse(
    await client.mutation(applyVotePointsReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("tagVotes", voteId),
      today,
    })
  );
}

export async function deleteConvexUserVote(
  client: ConvexReactClient,
  voteId: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(deleteVoteReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: documentId("tagVotes", voteId),
    })
  );
}
