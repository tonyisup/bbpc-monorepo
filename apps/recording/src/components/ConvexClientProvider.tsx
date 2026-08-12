'use client';

import { ClerkProvider, useAuth } from '@clerk/nextjs';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import type { ReactNode } from 'react';

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;
type ConvexProviderChildren = Parameters<
  typeof ConvexProviderWithClerk
>[0]['children'];

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!publishableKey || convexClient === null) {
    throw new Error(
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and NEXT_PUBLIC_CONVEX_URL are required',
    );
  }

  // Convex's declaration can resolve the React 18 type package used elsewhere
  // in the workspace. pnpm still supplies this app's React 19 runtime variant.
  const convexChildren = children as unknown as ConvexProviderChildren;

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        {convexChildren}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
