import { documentId } from "@tonyisup/bbpc-convex-api/contracts";
import { api } from "@tonyisup/bbpc-convex-api";
import type { ConvexReactClient } from "convex/react";

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

const listRolesReference = api.identity.admin.listRoles;

const createRoleReference = api.identity.admin.createRole;

const updateRoleReference = api.identity.admin.updateRole;

const deleteRoleReference = api.identity.admin.deleteRole;

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
      id: documentId("roles", id),
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
      id: documentId("roles", id),
    })
  );
}
