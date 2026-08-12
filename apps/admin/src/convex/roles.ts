import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";

import { BBPC_CLIENT_API_VERSION } from "./identity";

const roleSchema = z.object({
  id: z.string().min(1),
  legacyId: z.number().nullable(),
  name: z.string(),
  description: z.string(),
  admin: z.boolean(),
  permissions: z.array(z.string()),
});

const roleSummarySchema = roleSchema.extend({
  userCount: z.number(),
  userCountIsExact: z.boolean(),
});

const deleteRoleResultSchema = z.object({
  id: z.string().min(1),
});

const listRolesReference = makeFunctionReference<
  "query",
  Record<string, never>,
  unknown
>("identity/admin:listRoles");

const createRoleReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    name: string;
    description: string;
    admin: boolean;
  },
  unknown
>("identity/admin:createRole");

const updateRoleReference = makeFunctionReference<
  "mutation",
  {
    clientApiVersion: string;
    id: string;
    name: string;
    description: string;
    admin: boolean;
  },
  unknown
>("identity/admin:updateRole");

const deleteRoleReference = makeFunctionReference<
  "mutation",
  { clientApiVersion: string; id: string },
  unknown
>("identity/admin:deleteRole");

export type ConvexAdminRole = z.infer<typeof roleSummarySchema>;
export interface ConvexAdminRoleInput {
  name: string;
  description: string;
  admin: boolean;
}

export async function loadConvexAdminRoles(
  client: ConvexReactClient
): Promise<ConvexAdminRole[]> {
  return z
    .array(roleSummarySchema)
    .parse(await client.query(listRolesReference, {}));
}

export async function createConvexAdminRole(
  client: ConvexReactClient,
  input: ConvexAdminRoleInput
): Promise<void> {
  roleSchema.parse(
    await client.mutation(createRoleReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      ...input,
    })
  );
}

export async function updateConvexAdminRole(
  client: ConvexReactClient,
  id: string,
  input: ConvexAdminRoleInput
): Promise<void> {
  roleSchema.parse(
    await client.mutation(updateRoleReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
      ...input,
    })
  );
}

export async function deleteConvexAdminRole(
  client: ConvexReactClient,
  id: string
): Promise<void> {
  deleteRoleResultSchema.parse(
    await client.mutation(deleteRoleReference, {
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      id,
    })
  );
}
