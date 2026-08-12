"use client";

import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { Button } from "@/components/ui/button";

export function ConvexAccountRecoveryBanner() {
  const {
    accountIssue,
    accountStatus,
    refreshAccount,
    signOut,
    status,
  } = useBbpcAuth();

  if (
    status !== "authenticated" ||
    accountStatus === "ready" ||
    accountStatus === "resolving"
  ) {
    return null;
  }

  const message =
    accountIssue === "account-disabled"
      ? "This BBPC account is disabled."
      : accountIssue === "identity-conflict"
        ? "This sign-in conflicts with an existing BBPC account link."
        : accountIssue === "linking-disabled"
          ? "This sign-in is not linked to a BBPC account available in this environment."
          : accountIssue === "stale-client"
            ? "This page is out of date and cannot resolve your BBPC account."
            : "Your BBPC account could not be resolved.";

  return (
    <section
      aria-label="Account sign-in recovery"
      className="w-full border-b border-amber-400/30 bg-amber-400/10 px-4 py-3 text-amber-50"
      role="alert"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
          />
          <div>
            <p className="text-sm font-semibold">Account needs attention</p>
            <p className="text-sm text-amber-100/80">
              {message} Sign out to use a different email.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={refreshAccount} size="sm" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
          <Button onClick={signOut} size="sm" variant="secondary">
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </section>
  );
}
