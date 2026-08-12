import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { adminEpisodeSummarySchema } from "./episodes";
import { BBPC_CLIENT_API_VERSION } from "./identity";

const episodeDetailSchema = adminEpisodeSummarySchema.extend({
  notes: z.string().nullable(),
  seoDescription: z.string().nullable(),
  seoKeywords: z.string().nullable(),
  seoTitle: z.string().nullable(),
});

const audioUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
});

const audioMessageSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  createdAt: z.number(),
  fileKey: z.string().nullable(),
  episodeId: z.string().min(1).nullable(),
  notes: z.string().nullable(),
  user: audioUserSchema,
});

const audioPageSchema = z.object({
  page: z.array(audioMessageSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
  splitCursor: z.string().nullable().optional(),
  pageStatus: z
    .enum(["SplitRecommended", "SplitRequired"])
    .nullable()
    .optional(),
});

const idResultSchema = z.object({ id: z.string().min(1) });

const getBySlugReference = makeFunctionReference<
  "query",
  { slug: string },
  unknown
>("episodes/public:getBySlug");

const getByIdReference = makeFunctionReference<
  "query",
  { id: string },
  unknown
>("episodes/admin:getById");

const getByNumberReference = makeFunctionReference<
  "query",
  { number: number },
  unknown
>("episodes/admin:getByNumber");

const updateEpisodeReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    number: number;
    title: string;
    recording: string | null;
    date: string | null;
    description: string | null;
    status: string;
    notes: string | null;
    seoDescription: string | null;
    seoKeywords: string | null;
    seoTitle: string | null;
    slug: string | null;
    expected: ConvexAdminEpisodeEditableSnapshot;
  },
  unknown
>("episodes/admin:updateEpisode");

const addLinkReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    url: string;
    text: string;
  },
  unknown
>("episodes/admin:addLink");

const removeLinkReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expected: {
      episodeId: string | null;
      url: string;
      text: string;
    };
  },
  unknown
>("episodes/admin:removeLink");

const listAudioReference = makeFunctionReference<
  "query",
  {
    episodeId: string;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  unknown
>("episodes/admin:listAudioMessages");

const addAudioReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    episodeId: string;
    url: string;
    notes?: string;
  },
  unknown
>("episodes/admin:addAudioMessage");

const removeAudioReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expected: {
      episodeId: string | null;
      url: string;
      fileKey: string | null;
      createdAt: number;
    };
  },
  unknown
>("episodes/admin:removeAudioMessage");

const createAssignmentReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    userId: string;
    movieId: string;
    episodeId: string;
    type: ConvexAdminEpisodeAssignmentType;
    playable?: boolean;
  },
  unknown
>("assignments/admin:create");

const removeAssignmentReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    expected: {
      type: ConvexAdminEpisodeAssignmentType;
      slug: string | null;
      userId: string;
      movieId: string;
      episodeId: string;
    };
  },
  unknown
>("assignments/admin:removeIfUnreferenced");

const createExtraReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    userId: string;
    movieId?: string;
    showId?: string;
    episodeId: string;
  },
  unknown
>("reviews/admin:createExtra");

export const ADMIN_EPISODE_AUDIO_PAGE_SIZE = 30;

export type ConvexAdminEpisodeDetail = z.infer<typeof episodeDetailSchema>;
export type ConvexAdminEpisodeAudioMessage = z.infer<typeof audioMessageSchema>;
export type ConvexAdminEpisodeLink = ConvexAdminEpisodeDetail["links"][number];
export type ConvexAdminEpisodeAssignment =
  ConvexAdminEpisodeDetail["assignments"][number];
export type ConvexAdminEpisodeAssignmentType =
  ConvexAdminEpisodeAssignment["type"];
export type ConvexAdminEpisodeExtra =
  ConvexAdminEpisodeDetail["extras"][number];
export type ConvexAdminEpisodeExtraInput = {
  userId: string;
} & ({ kind: "movie"; mediaId: string } | { kind: "show"; mediaId: string });

export type ConvexAdminEpisodeEditableSnapshot = Pick<
  ConvexAdminEpisodeDetail,
  | "number"
  | "title"
  | "recording"
  | "date"
  | "description"
  | "status"
  | "notes"
  | "seoDescription"
  | "seoKeywords"
  | "seoTitle"
  | "slug"
>;

export interface ConvexAdminEpisodeInput {
  number: number;
  title: string;
  recording: string | null;
  date: string | null;
  description: string | null;
  status: string;
  notes: string | null;
  seoDescription: string | null;
  seoKeywords: string | null;
  seoTitle: string | null;
  slug: string | null;
}

export interface ConvexAdminEpisodeAudioPage {
  messages: ConvexAdminEpisodeAudioMessage[];
  isDone: boolean;
  continueCursor: string;
}

export function episodeEditableSnapshot(
  episode: ConvexAdminEpisodeDetail
): ConvexAdminEpisodeEditableSnapshot {
  return {
    number: episode.number,
    title: episode.title,
    recording: episode.recording,
    date: episode.date,
    description: episode.description,
    status: episode.status,
    notes: episode.notes,
    seoDescription: episode.seoDescription,
    seoKeywords: episode.seoKeywords,
    seoTitle: episode.seoTitle,
    slug: episode.slug,
  };
}

export async function loadConvexAdminEpisodeBySlug(
  client: ConvexReactClient,
  slug: string
): Promise<ConvexAdminEpisodeDetail | null> {
  const summary = adminEpisodeSummarySchema
    .nullable()
    .parse(await client.query(getBySlugReference, { slug }));
  if (summary === null) {
    return null;
  }
  const detail = episodeDetailSchema
    .nullable()
    .parse(await client.query(getByIdReference, { id: summary.id }));
  if (detail !== null && detail.slug !== summary.slug) {
    throw new Error("Episode slug changed while loading its detail.");
  }
  return detail;
}

export async function loadConvexAdminEpisodeByNumber(
  client: ConvexReactClient,
  number: number
): Promise<ConvexAdminEpisodeDetail | null> {
  return episodeDetailSchema
    .nullable()
    .parse(await client.query(getByNumberReference, { number }));
}

export async function updateConvexAdminEpisode(
  client: ConvexReactClient,
  episode: ConvexAdminEpisodeDetail,
  input: ConvexAdminEpisodeInput
): Promise<ConvexAdminEpisodeDetail> {
  return episodeDetailSchema.parse(
    await client.mutation(updateEpisodeReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: episode.id,
      ...input,
      expected: episodeEditableSnapshot(episode),
    })
  );
}

export async function addConvexAdminEpisodeLink(
  client: ConvexReactClient,
  episodeId: string,
  input: { url: string; text: string }
): Promise<ConvexAdminEpisodeLink> {
  return episodeDetailSchema.shape.links.element.parse(
    await client.mutation(addLinkReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId,
      ...input,
    })
  );
}

export async function removeConvexAdminEpisodeLink(
  client: ConvexReactClient,
  episodeId: string,
  link: ConvexAdminEpisodeLink
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeLinkReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: link.id,
      expected: {
        episodeId,
        url: link.url,
        text: link.text,
      },
    })
  );
}

export async function loadConvexAdminEpisodeAudioPage(
  client: ConvexReactClient,
  episodeId: string,
  cursor: string | null
): Promise<ConvexAdminEpisodeAudioPage> {
  const result = audioPageSchema.parse(
    await client.query(listAudioReference, {
      episodeId,
      paginationOpts: {
        cursor,
        numItems: ADMIN_EPISODE_AUDIO_PAGE_SIZE,
      },
    })
  );
  result.page.forEach((message) => {
    if (message.episodeId !== episodeId) {
      throw new Error(
        "An audio message does not belong to the requested episode."
      );
    }
  });
  return {
    messages: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function addConvexAdminEpisodeAudio(
  client: ConvexReactClient,
  episodeId: string,
  input: { url: string; notes: string | null }
): Promise<ConvexAdminEpisodeAudioMessage> {
  return audioMessageSchema.parse(
    await client.mutation(addAudioReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId,
      url: input.url,
      ...(input.notes === null ? {} : { notes: input.notes }),
    })
  );
}

export async function removeConvexAdminEpisodeAudio(
  client: ConvexReactClient,
  message: ConvexAdminEpisodeAudioMessage
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeAudioReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: message.id,
      expected: {
        episodeId: message.episodeId,
        url: message.url,
        fileKey: message.fileKey,
        createdAt: message.createdAt,
      },
    })
  );
}

export async function addConvexAdminEpisodeAssignment(
  client: ConvexReactClient,
  episodeId: string,
  input: {
    userId: string;
    movieId: string;
    type: ConvexAdminEpisodeAssignmentType;
    playable?: boolean;
  }
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(createAssignmentReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId,
      ...input,
      playable: input.playable ?? true,
    })
  );
}

export async function removeConvexAdminEpisodeAssignment(
  client: ConvexReactClient,
  episodeId: string,
  assignment: ConvexAdminEpisodeAssignment
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeAssignmentReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: assignment.id,
      expected: {
        type: assignment.type,
        slug: assignment.slug,
        userId: assignment.user.id,
        movieId: assignment.movie.id,
        episodeId,
      },
    })
  );
}

export async function addConvexAdminEpisodeExtra(
  client: ConvexReactClient,
  episodeId: string,
  input: ConvexAdminEpisodeExtraInput
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(createExtraReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      episodeId,
      userId: input.userId,
      ...(input.kind === "movie"
        ? { movieId: input.mediaId }
        : { showId: input.mediaId }),
    })
  );
}
