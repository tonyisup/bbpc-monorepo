"use client";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { Button } from "@/components/ui/button";

import { CallContent } from "./CallContent";

export function ConvexCallPage() {
  const { signIn, status } = useBbpcAuth();

  if (status === "loading") {
    return (
      <div
        className="container min-h-[50vh] animate-pulse p-4"
        aria-label="Loading call access"
      />
    );
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
