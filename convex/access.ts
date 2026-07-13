import type { MutationCtx, QueryCtx } from './_generated/server';

type DatabaseCtx = QueryCtx | MutationCtx;

export async function participantForAccess(
  ctx: DatabaseCtx,
  publicSessionId: string,
  clientId: string,
  accessToken: string,
) {
  return await ctx.db
    .query('participants')
    .withIndex('by_access', q => (
      q
        .eq('publicSessionId', publicSessionId)
        .eq('clientId', clientId)
        .eq('accessToken', accessToken)
    ))
    .unique();
}

export async function requireParticipant(
  ctx: DatabaseCtx,
  publicSessionId: string,
  clientId: string,
  accessToken: string,
) {
  const participant = await participantForAccess(ctx, publicSessionId, clientId, accessToken);
  if (!participant) throw new Error('Session access denied');
  return participant;
}

export async function requireOwner(
  ctx: DatabaseCtx,
  publicSessionId: string,
  clientId: string,
  accessToken: string,
) {
  const participant = await requireParticipant(ctx, publicSessionId, clientId, accessToken);
  if (participant.role !== 'owner') throw new Error('Session owner access required');
  return participant;
}

export function requireAdminSecret(adminSecret: string): void {
  const expected = process.env.SESSION_ADMIN_SECRET;
  if (!expected || adminSecret !== expected) {
    throw new Error('Administrative access required');
  }
}
