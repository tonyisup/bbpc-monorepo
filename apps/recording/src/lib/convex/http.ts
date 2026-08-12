import { fetchMutation, fetchQuery } from 'convex/nextjs';
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from 'convex/server';

function requireConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error('NEXT_PUBLIC_CONVEX_URL is not configured');
  }
  return url;
}

export async function querySharedConvex<
  Query extends FunctionReference<'query', 'public'>,
>(
  query: Query,
  args: FunctionArgs<Query>,
): Promise<FunctionReturnType<Query>> {
  return await fetchQuery(query, args, {
    url: requireConvexUrl(),
  });
}

export async function mutateSharedConvex<
  Mutation extends FunctionReference<'mutation', 'public'>,
>(
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
): Promise<FunctionReturnType<Mutation>> {
  return await fetchMutation(mutation, args, {
    url: requireConvexUrl(),
  });
}

export async function mutateSharedConvexAsUser<
  Mutation extends FunctionReference<'mutation', 'public'>,
>(
  mutation: Mutation,
  args: FunctionArgs<Mutation>,
  token: string,
): Promise<FunctionReturnType<Mutation>> {
  return await fetchMutation(mutation, args, {
    url: requireConvexUrl(),
    token,
  });
}
