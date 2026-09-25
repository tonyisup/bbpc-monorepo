"use client";

import SignOutButton from "@/components/SignOutButton";

import { ConvexProfileForm } from "./ConvexProfileForm";
import { ConvexProfileSeasons } from "./ConvexProfileSeasons";
import { ConvexProfileSummary } from "./ConvexProfileSummary";
import { MovieLinkPreferenceForm } from "./MovieLinkPreferenceForm";
import { ProfileAccessGate } from "./ProfileAccessGate";

export function ConvexProfilePage() {
  return (
    <ProfileAccessGate label="profile">
      {(user) => (
        <div className="bbpc-page flex max-w-4xl flex-col gap-12">
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">
            {user.email ?? user.name ?? "Profile"}
          </h1>

          <ConvexProfileForm
            initialName={user.name ?? ""}
            initialImage={user.image}
          />

          <MovieLinkPreferenceForm
            key={`${user.appUserId}:${user.movieLinkPreference ?? "imdb"}`}
            initialPreference={user.movieLinkPreference ?? "imdb"}
          />

          <ConvexProfileSummary appUserId={user.appUserId} />
          <ConvexProfileSeasons appUserId={user.appUserId} />

          <SignOutButton />
        </div>
      )}
    </ProfileAccessGate>
  );
}
