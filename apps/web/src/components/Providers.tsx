"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import dynamic from "next/dynamic";
import { ClerkBbpcAuthProvider } from "@/components/auth/BbpcAuthContext";

const PostHogProviderDynamic = dynamic(
  () => import("./PostHogProvider").then((m) => m.PostHogProvider),
  { ssr: false }
);

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient =
  convexUrl === undefined ? null : new ConvexReactClient(convexUrl);

function SharedProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      {process.env.NEXT_PUBLIC_POSTHOG_KEY ? (
        <PostHogProviderDynamic>
          {children}
          <Toaster />
        </PostHogProviderDynamic>
      ) : (
        <>
          {children}
          <Toaster />
        </>
      )}
    </ThemeProvider>
  );
}

export function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  const shared = <SharedProviders>{children}</SharedProviders>;

  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (publishableKey === undefined || convexClient === null) {
    throw new Error(
      "BBPC requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and NEXT_PUBLIC_CONVEX_URL."
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        <ClerkBbpcAuthProvider>{shared}</ClerkBbpcAuthProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
