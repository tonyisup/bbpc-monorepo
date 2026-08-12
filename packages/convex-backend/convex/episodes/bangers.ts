import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel.js";
import type { QueryCtx } from "../_generated/server.js";
import { adminMutation, adminQuery } from "../functions.js";
import { writeAuditEvent } from "../lib/audit.js";
import { domainError } from "../lib/errors.js";
import {
  requireEpisode,
  validateHttpUrl,
} from "./adminWriteModel.js";
import { validateBangerPageSize } from "./limits.js";
import { bangerValidator } from "./validators.js";

const MAX_BANGER_TEXT_LENGTH = 500;

const optionalBangerRelationships = {
  episodeId: v.union(v.id("episodes"), v.null()),
  userId: v.union(v.id("users"), v.null()),
};

const bangerContentArgs = {
  title: v.string(),
  artist: v.string(),
  url: v.string(),
  ...optionalBangerRelationships,
};

const expectedBangerValidator = v.object({
  title: v.string(),
  artist: v.string(),
  url: v.string(),
  ...optionalBangerRelationships,
});

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

function validateBangerText(
  value: string,
  label: string,
): string {
  const normalized = value.trim().normalize("NFKC");
  if (
    normalized.length < 1 ||
    normalized.length > MAX_BANGER_TEXT_LENGTH
  ) {
    domainError(
      "VALIDATION_FAILED",
      `${label} must contain 1 through ${String(MAX_BANGER_TEXT_LENGTH)} characters.`,
    );
  }
  return normalized;
}

async function requireBanger(
  ctx: Pick<QueryCtx, "db">,
  id: Id<"bangers">,
): Promise<Doc<"bangers">> {
  const banger = await ctx.db.get("bangers", id);
  if (banger === null) {
    domainError("NOT_FOUND", "The banger is unavailable.");
  }
  return banger;
}

async function requireBangerUser(
  ctx: Pick<QueryCtx, "db">,
  id: Id<"users">,
): Promise<Doc<"users">> {
  const user = await ctx.db.get("users", id);
  if (user === null) {
    domainError("NOT_FOUND", "The banger user is unavailable.");
  }
  return user;
}

function toEpisode(episode: Doc<"episodes">) {
  return {
    id: episode._id,
    number: episode.number,
    title: episode.title,
    status: nullable(episode.status),
  };
}

function toUser(user: Doc<"users">) {
  return {
    id: user._id,
    name: nullable(user.name),
    email: nullable(user.email),
    image: nullable(user.image),
    status: user.status,
  };
}

async function hydrateBanger(
  ctx: QueryCtx,
  banger: Doc<"bangers">,
) {
  const [episode, user] = await Promise.all([
    banger.episodeId === undefined
      ? null
      : ctx.db.get("episodes", banger.episodeId),
    banger.userId === undefined
      ? null
      : ctx.db.get("users", banger.userId),
  ]);
  if (banger.episodeId !== undefined && episode === null) {
    domainError(
      "CONFLICT",
      "The banger references a missing episode.",
      { details: { bangerId: banger._id } },
    );
  }
  if (banger.userId !== undefined && user === null) {
    domainError(
      "CONFLICT",
      "The banger references a missing user.",
      { details: { bangerId: banger._id } },
    );
  }
  return {
    id: banger._id,
    title: banger.title,
    artist: banger.artist,
    url: banger.url,
    episodeId: nullable(banger.episodeId),
    userId: nullable(banger.userId),
    episode: episode === null ? null : toEpisode(episode),
    user: user === null ? null : toUser(user),
  };
}

async function resolveRelationships(
  ctx: Parameters<typeof requireEpisode>[0],
  input: {
    episodeId: Id<"episodes"> | null;
    userId: Id<"users"> | null;
  },
) {
  const [episode, user] = await Promise.all([
    input.episodeId === null
      ? null
      : requireEpisode(ctx, input.episodeId),
    input.userId === null
      ? null
      : requireBangerUser(ctx, input.userId),
  ]);
  return {
    episodeId: episode?._id ?? null,
    userId: user?._id ?? null,
  };
}

function bangerMatchesExpected(
  banger: Doc<"bangers">,
  expected: {
    title: string;
    artist: string;
    url: string;
    episodeId: Id<"episodes"> | null;
    userId: Id<"users"> | null;
  },
): boolean {
  return (
    banger.title === expected.title &&
    banger.artist === expected.artist &&
    banger.url === expected.url &&
    nullable(banger.episodeId) === expected.episodeId &&
    nullable(banger.userId) === expected.userId
  );
}

export const listAdminPage = adminQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(bangerValidator),
  handler: async (ctx, args) => {
    validateBangerPageSize(args.paginationOpts.numItems);
    const result = await ctx.db
      .query("bangers")
      .withIndex("by_title")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map((banger) => hydrateBanger(ctx, banger)),
      ),
    };
  },
});

export const getAdminById = adminQuery({
  args: { id: v.id("bangers") },
  returns: v.union(bangerValidator, v.null()),
  handler: async (ctx, args) => {
    const banger = await ctx.db.get("bangers", args.id);
    return banger === null ? null : await hydrateBanger(ctx, banger);
  },
});

export const create = adminMutation({
  args: bangerContentArgs,
  returns: bangerValidator,
  handler: async (ctx, args) => {
    const relationships = await resolveRelationships(ctx, args);
    const id = await ctx.db.insert("bangers", {
      title: validateBangerText(args.title, "Banger title"),
      artist: validateBangerText(args.artist, "Banger artist"),
      url: validateHttpUrl(args.url, "Banger URL"),
      ...(relationships.episodeId === null
        ? {}
        : { episodeId: relationships.episodeId }),
      ...(relationships.userId === null
        ? {}
        : { userId: relationships.userId }),
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.bangerCreated",
      targetType: "banger",
      targetId: id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateBanger(ctx, await requireBanger(ctx, id));
  },
});

export const update = adminMutation({
  args: {
    id: v.id("bangers"),
    ...bangerContentArgs,
  },
  returns: bangerValidator,
  handler: async (ctx, args) => {
    const banger = await requireBanger(ctx, args.id);
    const relationships = await resolveRelationships(ctx, args);
    await ctx.db.patch("bangers", banger._id, {
      title: validateBangerText(args.title, "Banger title"),
      artist: validateBangerText(args.artist, "Banger artist"),
      url: validateHttpUrl(args.url, "Banger URL"),
      episodeId: relationships.episodeId ?? undefined,
      userId: relationships.userId ?? undefined,
    });
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.bangerUpdated",
      targetType: "banger",
      targetId: banger._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return await hydrateBanger(
      ctx,
      await requireBanger(ctx, banger._id),
    );
  },
});

export const remove = adminMutation({
  args: {
    id: v.id("bangers"),
    expected: v.optional(expectedBangerValidator),
  },
  returns: v.object({ id: v.id("bangers") }),
  handler: async (ctx, args) => {
    const banger = await requireBanger(ctx, args.id);
    if (
      args.expected !== undefined &&
      !bangerMatchesExpected(banger, args.expected)
    ) {
      domainError(
        "CONFLICT",
        "The banger changed after it was inspected.",
      );
    }
    await ctx.db.delete("bangers", banger._id);
    await writeAuditEvent(ctx, {
      actor: ctx.actor,
      action: "episodes.admin.bangerDeleted",
      targetType: "banger",
      targetId: banger._id,
      cutoverRunId: ctx.systemState.cutoverRunId,
    });
    return { id: banger._id };
  },
});
