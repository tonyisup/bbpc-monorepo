"use client";

import { Info } from "lucide-react";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import SignOutButton from "@/components/SignOutButton";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { ConvexSyllabusManager } from "./ConvexSyllabusManager";

export function ConvexSyllabusPage() {
  const { accountStatus, refreshAccount, signIn, status, user } = useBbpcAuth();

  if (status === "loading" || accountStatus === "resolving") {
    return (
      <div
        className="container min-h-[50vh] animate-pulse p-4"
        aria-label="Loading syllabus"
      />
    );
  }

  if (status === "unauthenticated" || user === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold">Sign in to view your syllabus</h1>
        <Button className="mt-6" onClick={signIn}>
          Sign in
        </Button>
      </div>
    );
  }

  if (accountStatus !== "ready" || user.appUserId === null) {
    return (
      <div className="container flex min-h-[50vh] flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold">Syllabus unavailable</h1>
        <p className="mt-4 max-w-lg text-muted-foreground">
          Your BBPC account could not be resolved for this protected page.
        </p>
        <div className="mt-8 flex gap-3">
          <Button variant="outline" onClick={refreshAccount}>
            Try again
          </Button>
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="bbpc-page max-w-4xl space-y-6">
      <header>
        <p className="bbpc-kicker">Your movie queue</p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-black tracking-tight sm:text-4xl">
          My Syllabus
          <Popover>
            <PopoverTrigger
              className="inline-flex h-11 w-11 items-center justify-center rounded-md"
              aria-label="About the syllabus"
            >
              <Info className="h-4 w-4" />
            </PopoverTrigger>
            <PopoverContent>
              <p>
                When you win the weekly bonus spin, we will assign the next
                movie from this list.
              </p>
            </PopoverContent>
          </Popover>
        </h1>
        <p className="mt-2 text-muted-foreground">
          Keep your next pick at the top. Add notes and reorder movies until
          they’re assigned.
        </p>
      </header>
      <ConvexSyllabusManager appUserId={user.appUserId} />
    </div>
  );
}
