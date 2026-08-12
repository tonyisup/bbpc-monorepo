"use client";

import { useConvex } from "convex/react";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import SyllabusPreview from "@/components/SyllabusPreview";
import UserPoints from "@/components/UserPoints";
import { getPacificTodayPlainDate } from "@/lib/dates";
import {
  type ConvexProfileSummary as ProfileSummary,
  loadConvexProfileSummary,
} from "@/convex/profile";

export function ConvexProfileSummary({ appUserId }: { appUserId: string }) {
  const convex = useConvex();
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setSummary(null);
    setFailed(false);

    void loadConvexProfileSummary(convex, getPacificTodayPlainDate())
      .then((result) => {
        if (loadGenerationRef.current === generation) {
          setSummary(result);
        }
      })
      .catch(() => {
        if (loadGenerationRef.current === generation) {
          setFailed(true);
        }
      });
  }, [appUserId, convex]);

  if (failed) {
    return (
      <p className="text-sm text-red-300" role="alert">
        Your syllabus and game balance could not be loaded.
      </p>
    );
  }

  if (summary === null) {
    return (
      <div
        className="h-48 w-full animate-pulse rounded-lg bg-white/[0.04]"
        aria-label="Loading syllabus and game balance"
      />
    );
  }

  return (
    <>
      <section className="flex w-full flex-col items-center justify-center gap-4">
        <h2 className="self-start text-xl font-bold tracking-tight">
          My Syllabus
        </h2>
        <div className="flex w-full items-center gap-4">
          <Link href="/syllabus" aria-label="Edit syllabus">
            <Pencil className="h-4 w-4" />
          </Link>
          <SyllabusPreview
            count={summary.syllabusCount}
            syllabus={summary.syllabusPreview}
          />
        </div>
      </section>

      <section className="flex w-full flex-col items-center justify-center gap-4">
        <h2 className="self-start text-xl font-bold tracking-tight">
          Game Stuff
        </h2>
        <UserPoints points={summary.availablePoints} />
      </section>
    </>
  );
}
