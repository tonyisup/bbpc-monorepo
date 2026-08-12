import { v } from "convex/values";

import { internalReadAction } from "../functions.js";
import { searchTmdb } from "./tmdbClient.js";

export const tmdbMovieSearchSmoke = internalReadAction({
  args: {
    query: v.string(),
    page: v.optional(v.number()),
  },
  returns: v.object({
    page: v.number(),
    resultCount: v.number(),
    firstResultIdPresent: v.boolean(),
  }),
  handler: async (_ctx, args) => {
    const result = await searchTmdb(
      "movie",
      args.query,
      args.page ?? 1,
    );
    return {
      page: result.page,
      resultCount: result.results.length,
      firstResultIdPresent: result.results.length > 0,
    };
  },
});
