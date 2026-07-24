import { v } from "convex/values";

const nullableStringValidator = v.union(v.string(), v.null());
const nullableNumberValidator = v.union(v.number(), v.null());

export const identityUserStatusValidator = v.union(
  v.literal("active"),
  v.literal("disabled"),
);

export const identityRoleValidator = v.object({
  id: v.id("roles"),
  legacyId: nullableNumberValidator,
  name: v.string(),
  description: v.string(),
  admin: v.boolean(),
  permissions: v.array(v.string()),
});

export const identityRoleMembershipValidator = v.object({
  id: v.id("userRoles"),
  assignedAt: nullableNumberValidator,
  assignedBy: v.union(v.id("users"), v.null()),
  role: identityRoleValidator,
});

export const identityRoleSummaryValidator =
  identityRoleValidator.extend({
    userCount: v.number(),
    userCountIsExact: v.boolean(),
  });

export const identityAdminUserValidator = v.object({
  id: v.id("users"),
  legacyId: nullableStringValidator,
  name: nullableStringValidator,
  email: nullableStringValidator,
  image: nullableStringValidator,
  status: identityUserStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  isAdmin: v.boolean(),
  roles: v.array(identityRoleMembershipValidator),
  nextSyllabus: v.union(
    v.object({
      id: v.id("syllabusEntries"),
      order: v.number(),
      notes: nullableStringValidator,
      movie: v.object({
        id: v.id("movies"),
        title: v.string(),
      }),
    }),
    v.null(),
  ),
});
