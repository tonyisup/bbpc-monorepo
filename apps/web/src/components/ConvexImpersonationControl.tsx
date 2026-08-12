"use client";

import { Loader2, UserMinus } from "lucide-react";
import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  type ConvexImpersonationSession,
  loadCurrentConvexImpersonation,
  revokeConvexImpersonation,
} from "@/convex/impersonation";
import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";

export function ConvexImpersonationControl() {
  const client = useConvex();
  const { refreshAccount, status } = useBbpcAuth();
  const [session, setSession] =
    useState<ConvexImpersonationSession | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (status !== "authenticated") {
      setSession(null);
      return;
    }
    void loadCurrentConvexImpersonation(client)
      .then((current) => {
        if (!cancelled) {
          setSession(current);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSession(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, status]);

  if (session === null) {
    return null;
  }

  return (
    <button
      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-amber-300 transition-colors hover:bg-amber-500/10 hover:text-amber-200 disabled:opacity-60"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void revokeConvexImpersonation(client, session.id)
          .then(() => {
            setSession(null);
            refreshAccount();
          })
          .catch(() => {
            toast.error("Could not end impersonation. Try again.");
          })
          .finally(() => setBusy(false));
      }}
      type="button"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <UserMinus className="h-4 w-4" />
      )}
      <span>
        End impersonation
        {session.targetName === null ? "" : ` · ${session.targetName}`}
      </span>
    </button>
  );
}
