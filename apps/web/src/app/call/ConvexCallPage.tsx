"use client";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { Button } from "@/components/ui/button";

import { CallContent } from "./CallContent";

export function ConvexCallPage() {
  const { signIn, status } = useBbpcAuth();

  if (status === "loading") {
    return <LoadingIndicator variant="page" label="Loading call access" />;
  }

  if (status === "unauthenticated") {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold">Sign in to join the call</h1>
        <Button className="mt-6" onClick={signIn}>
          Sign in
        </Button>
      </div>
    );
  }

  return <CallContent />;
}
