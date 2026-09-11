"use client";

import { useConvex } from "convex/react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useBbpcAuth } from "@/components/auth/BbpcAuthContext";
import { Button } from "@/components/ui/button";
import {
  getConvexIdentityIssue,
  updateConvexMovieLinkPreference,
} from "@/convex/identity";
import type { MovieLinkPreference } from "@/utils/movieLinks";

export function MovieLinkPreferenceForm({
  initialPreference,
}: {
  initialPreference: MovieLinkPreference;
}) {
  const convex = useConvex();
  const { refreshAccount } = useBbpcAuth();
  const [preference, setPreference] = useState(initialPreference);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  async function save() {
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      await updateConvexMovieLinkPreference(convex, preference);
      toast.success("Movie link preference saved.");
      refreshAccount();
    } catch (error) {
      const issue = getConvexIdentityIssue(error);
      setError(
        issue === "linking-disabled"
          ? "Profile updates are paused while this environment is read-only."
          : issue === "stale-client"
          ? "This page is out of date. Refresh it before saving again."
          : "Your movie link preference could not be saved. Please try again."
      );
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <form
      className="flex w-full max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={isSaving} aria-describedby="movie-links-description">
        <legend className="text-lg font-semibold">Movie links</legend>
        <p
          id="movie-links-description"
          className="mt-2 text-sm text-muted-foreground"
        >
          Choose where movie links open. If your preferred site is unavailable
          for a movie, we’ll use its existing link.
        </p>
        <div className="mt-4 flex gap-6">
          {(["imdb", "tmdb"] as const).map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2"
            >
              <input
                type="radio"
                name="movieLinkPreference"
                value={option}
                checked={preference === option}
                onChange={() => {
                  setPreference(option);
                  setError(null);
                }}
                className="h-4 w-4 accent-purple-500"
              />
              {option === "imdb" ? "IMDb" : "TMDB"}
            </label>
          ))}
        </div>
      </fieldset>
      <Button
        type="submit"
        variant="outline"
        className="self-start"
        disabled={isSaving || preference === initialPreference}
      >
        {isSaving ? "Saving..." : "Save movie links"}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </form>
  );
}
