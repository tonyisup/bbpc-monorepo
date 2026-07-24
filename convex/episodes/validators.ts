import { v } from "convex/values";

import {
  catalogMovieValidator,
  catalogShowValidator,
} from "../catalog/validators.js";

const nullableStringValidator = v.union(v.string(), v.null());

export const episodeUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  image: nullableStringValidator,
});

export const episodeAssignmentValidator = v.object({
  id: v.id("assignments"),
  type: v.string(),
  playable: v.boolean(),
  slug: nullableStringValidator,
  user: episodeUserValidator,
  movie: catalogMovieValidator,
});

export const episodeExtraValidator = v.object({
  id: v.id("extraReviews"),
  review: v.object({
    id: v.id("reviews"),
    movie: v.union(catalogMovieValidator, v.null()),
    show: v.union(catalogShowValidator, v.null()),
  }),
});

export const episodeLinkValidator = v.object({
  id: v.id("episodeLinks"),
  url: v.string(),
  text: v.string(),
});

export const episodeAudioMessageValidator = v.object({
  id: v.id("episodeAudioMessages"),
  url: v.string(),
  createdAt: v.number(),
  fileKey: nullableStringValidator,
  episodeId: v.union(v.id("episodes"), v.null()),
  notes: nullableStringValidator,
});

export const episodeAdminUserValidator = v.object({
  id: v.id("users"),
  name: nullableStringValidator,
  email: nullableStringValidator,
  image: nullableStringValidator,
  status: v.union(v.literal("active"), v.literal("disabled")),
});

export const episodeAdminAudioMessageValidator =
  episodeAudioMessageValidator.extend({
    user: episodeAdminUserValidator,
  });

export const episodeDetailValidator = v.object({
  id: v.id("episodes"),
  number: v.number(),
  title: v.string(),
  recording: nullableStringValidator,
  date: nullableStringValidator,
  description: nullableStringValidator,
  status: nullableStringValidator,
  slug: nullableStringValidator,
  assignments: v.array(episodeAssignmentValidator),
  extras: v.array(episodeExtraValidator),
  links: v.array(episodeLinkValidator),
});

export const episodeAdminDetailValidator =
  episodeDetailValidator.extend({
    notes: nullableStringValidator,
    seoDescription: nullableStringValidator,
    seoKeywords: nullableStringValidator,
    seoTitle: nullableStringValidator,
  });
