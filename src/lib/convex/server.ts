import 'server-only';

import { isClerkAPIResponseError } from '@clerk/nextjs/errors';
import { auth } from '@clerk/nextjs/server';

async function retryClerkNotFound<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isClerkAPIResponseError(error) || error.status !== 404) {
      throw error;
    }
  }

  await new Promise(resolve => setTimeout(resolve, 250));

  try {
    return await operation();
  } catch (error) {
    if (!isClerkAPIResponseError(error) || error.status !== 404) {
      throw error;
    }
  }

  await new Promise(resolve => setTimeout(resolve, 500));
  return operation();
}

export async function getRequiredConvexToken(): Promise<string | null> {
  const clerkAuth = await auth();
  if (clerkAuth.userId === null) {
    return null;
  }
  const token = await retryClerkNotFound(() =>
    clerkAuth.sessionClaims?.aud === 'convex'
      ? clerkAuth.getToken()
      : clerkAuth.getToken({ template: 'convex' }),
  );
  if (token === null) {
    throw new Error('Clerk did not provide a Convex token');
  }
  return token;
}
