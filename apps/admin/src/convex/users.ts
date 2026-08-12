import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

export const adminRoleSchema = z.object({
  id: z.string().min(1),
  legacyId: z.number().nullable(),
  name: z.string(),
  description: z.string(),
  admin: z.boolean(),
  permissions: z.array(z.string()),
});

export const adminRoleMembershipSchema = z.object({
  id: z.string().min(1),
  assignedAt: z.number().nullable(),
  assignedBy: z.string().min(1).nullable(),
  role: adminRoleSchema,
});

export const adminUserSchema = z.object({
  id: z.string().min(1),
  legacyId: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
  createdAt: z.number(),
  updatedAt: z.number(),
  isAdmin: z.boolean(),
  roles: z.array(adminRoleMembershipSchema),
  nextSyllabus: z
    .object({
      id: z.string().min(1),
      order: z.number(),
      notes: z.string().nullable(),
      movie: z.object({
        id: z.string().min(1),
        title: z.string(),
      }),
    })
    .nullable(),
});

const usersPageSchema = z.object({
  page: z.array(adminUserSchema),
  isDone: z.boolean(),
  continueCursor: z.string(),
  splitCursor: z.string().nullable().optional(),
  pageStatus: z
    .enum(["SplitRecommended", "SplitRequired"])
    .nullable()
    .optional(),
});

const idResultSchema = z.object({
  id: z.string().min(1),
});

const listUsersPageReference = makeFunctionReference<
  "query",
  {
    paginationOpts: {
      cursor: string | null;
      numItems: number;
    };
  },
  unknown
>("identity/admin:listUsersPage");

const createUserReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    name: string;
    email: string;
  },
  unknown
>("identity/admin:createUser");

const updateUserReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    name: string;
    email: string;
  },
  unknown
>("identity/admin:updateUser");

const setUserStatusReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    status: "active" | "disabled";
  },
  unknown
>("identity/admin:setUserStatus");

const assignRoleReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    userId: string;
    roleId: string;
  },
  unknown
>("identity/admin:assignRole");

const removeRoleMembershipReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
  },
  unknown
>("identity/admin:removeRoleMembership");

export const ADMIN_USERS_PAGE_SIZE = 50;

export type ConvexAdminUser = z.infer<typeof adminUserSchema>;
export type ConvexAdminUserStatus = ConvexAdminUser["status"];
export interface ConvexAdminUserInput {
  name: string;
  email: string;
}
export interface ConvexAdminUsersPage {
  users: ConvexAdminUser[];
  isDone: boolean;
  continueCursor: string;
}

export async function loadConvexAdminUsersPage(
  client: ConvexReactClient,
  cursor: string | null
): Promise<ConvexAdminUsersPage> {
  const result = usersPageSchema.parse(
    await client.query(listUsersPageReference, {
      paginationOpts: {
        cursor,
        numItems: ADMIN_USERS_PAGE_SIZE,
      },
    })
  );
  return {
    users: result.page,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function createConvexAdminUser(
  client: ConvexReactClient,
  input: ConvexAdminUserInput
): Promise<void> {
  adminUserSchema.parse(
    await client.mutation(createUserReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function updateConvexAdminUser(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminUserInput
): Promise<void> {
  adminUserSchema.parse(
    await client.mutation(updateUserReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      ...input,
    })
  );
}

export async function setConvexAdminUserStatus(
  client: ConvexReactClient,
  id: string,
  status: ConvexAdminUserStatus
): Promise<void> {
  adminUserSchema.parse(
    await client.mutation(setUserStatusReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      status,
    })
  );
}

export async function assignConvexAdminUserRole(
  client: ConvexReactClient,
  userId: string,
  roleId: string
): Promise<void> {
  adminRoleMembershipSchema.parse(
    await client.mutation(assignRoleReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      userId,
      roleId,
    })
  );
}

export async function removeConvexAdminUserRole(
  client: ConvexReactClient,
  membershipId: string
): Promise<void> {
  idResultSchema.parse(
    await client.mutation(removeRoleMembershipReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id: membershipId,
    })
  );
}
