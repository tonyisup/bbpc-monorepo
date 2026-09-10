import "server-only";

import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { auth } from "@clerk/nextjs/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import {
  type ArgsAndOptions,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from "convex/server";
import type { NextjsOptions } from "convex/nextjs";

import { env } from "@/env.mjs";

function requireConvexUrl(): string {
  return env.NEXT_PUBLIC_CONVEX_URL;
}

function queryArgs<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
  options: NextjsOptions
) {
  return [args, options] as unknown as ArgsAndOptions<
    typeof query,
    NextjsOptions
  >;
}

function actionArgs<Action extends FunctionReference<"action">>(
  action: Action,
  args: FunctionArgs<Action>,
  options: NextjsOptions
) {
  return [args, options] as unknown as ArgsAndOptions<
    typeof action,
    NextjsOptions
  >;
}

export async function fetchPublicQuery<
  Query extends FunctionReference<"query">
>(query: Query, args: FunctionArgs<Query>): Promise<FunctionReturnType<Query>> {
  return fetchQuery(
    query,
    ...queryArgs(query, args, {
      url: requireConvexUrl(),
    })
  );
}

async function retryClerkNotFound<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isClerkAPIResponseError(error) || error.status !== 404) {
      throw error;
    }
  }

  // A newly completed Clerk sign-up can briefly precede session-token
  // propagation to the Backend API.
  await new Promise((resolve) => setTimeout(resolve, 250));

  try {
    return await operation();
  } catch (error) {
    if (!isClerkAPIResponseError(error) || error.status !== 404) {
      throw error;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  return operation();
}

async function getOptionalConvexToken(): Promise<string | null> {
  const clerkAuth = await auth();
  if (clerkAuth.userId === null) {
    return null;
  }
  const token = await retryClerkNotFound(() =>
    clerkAuth.sessionClaims?.aud === "convex"
      ? clerkAuth.getToken()
      : clerkAuth.getToken({ template: "convex" })
  );
  if (token === null) {
    throw new Error(
      "Clerk is authenticated but did not provide a Convex token."
    );
  }
  return token;
}

export async function fetchQueryForSignedInUser<
  Query extends FunctionReference<"query">
>(
  query: Query,
  args: FunctionArgs<Query>
): Promise<FunctionReturnType<Query> | null> {
  const url = requireConvexUrl();
  const token = await getOptionalConvexToken();
  if (token === null) {
    return null;
  }
  return fetchQuery(query, ...queryArgs(query, args, { url, token }));
}

export async function fetchActionForSignedInUser<
  Action extends FunctionReference<"action">
>(
  action: Action,
  args: FunctionArgs<Action>
): Promise<FunctionReturnType<Action> | null> {
  const url = requireConvexUrl();
  const token = await getOptionalConvexToken();
  if (token === null) {
    return null;
  }
  return fetchAction(action, ...actionArgs(action, args, { url, token }));
}
