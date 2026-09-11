import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getMovieLink } from "../src/utils/movieLinks";

const mocks = vi.hoisted(() => ({
  user: null as { movieLinkPreference?: "imdb" | "tmdb" } | null,
  mutation: vi.fn(),
  refreshAccount: vi.fn(),
  success: vi.fn(),
}));
vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => ({
    user: mocks.user,
    refreshAccount: mocks.refreshAccount,
  }),
}));
vi.mock("convex/react", () => ({
  useConvex: () => ({ mutation: mocks.mutation }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} />
  ),
}));

import MovieInlinePreview from "../src/components/MovieInlinePreview";
import SyllabusPreview from "../src/components/SyllabusPreview";
import { MovieLinkPreferenceForm } from "../src/app/profile/MovieLinkPreferenceForm";
import { loadConvexProfileSummary } from "../src/convex/profile";
import { resolveConvexIdentity } from "../src/convex/identity";
import type { ConvexReactClient } from "convex/react";

const movie = {
  id: "movie-1",
  title: "A Movie",
  year: 2020,
  poster: null,
  url: "https://www.imdb.com/title/tt1234567/",
  tmdbId: 42,
};
let renderer: ReactTestRenderer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
});
afterEach(() => {
  act(() => renderer?.unmount());
});

describe("movie links", () => {
  test("uses IMDb by default and TMDB when selected", () => {
    expect(getMovieLink(movie)).toBe(movie.url);
    expect(getMovieLink(movie, "imdb")).toBe(movie.url);
    expect(getMovieLink(movie, "tmdb")).toBe(
      "https://www.themoviedb.org/movie/42"
    );
  });
  test("falls back to the catalog link when the requested ID is unavailable", () => {
    for (const tmdbId of [undefined, null, 0, -1, 1.5, NaN, Infinity]) {
      expect(getMovieLink({ ...movie, tmdbId }, "tmdb")).toBe(movie.url);
    }
    const tmdbOnly = { url: "https://www.themoviedb.org/movie/42", tmdbId: 42 };
    expect(getMovieLink(tmdbOnly, "imdb")).toBe(tmdbOnly.url);
  });
  test("updates episode and syllabus links when the account preference changes", () => {
    const content = () => (
      <>
        <MovieInlinePreview movie={movie} />
        <SyllabusPreview count={1} syllabus={[{ movie }]} />
      </>
    );
    act(() => {
      renderer = create(content());
    });
    expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual([
      movie.url,
      movie.url,
    ]);
    mocks.user = { movieLinkPreference: "tmdb" };
    act(() => {
      renderer.update(content());
    });
    expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual([
      "https://www.themoviedb.org/movie/42",
      "https://www.themoviedb.org/movie/42",
    ]);
    mocks.user = null;
    act(() => {
      renderer.update(content());
    });
    expect(renderer.root.findAllByType("a").map((a) => a.props.href)).toEqual([
      movie.url,
      movie.url,
    ]);
  });
  test("keeps TMDB IDs in profile syllabus previews", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        { id: "entry-1", order: 0, movie, assignment: null },
      ])
      .mockResolvedValueOnce(0);
    const summary = await loadConvexProfileSummary(
      { query } as unknown as ConvexReactClient,
      "2026-09-11"
    );
    expect(summary.syllabusPreview[0]?.movie.tmdbId).toBe(42);
  });
  test("loads the saved account preference and defaults older profiles to IMDb", async () => {
    const profile = {
      id: "user-1",
      name: "User",
      email: null,
      image: null,
      isAdmin: false,
      isHost: false,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ ...profile, movieLinkPreference: "tmdb" })
      .mockResolvedValueOnce(profile);
    const client = { query } as unknown as ConvexReactClient;
    expect((await resolveConvexIdentity(client)).movieLinkPreference).toBe(
      "tmdb"
    );
    expect((await resolveConvexIdentity(client)).movieLinkPreference).toBe(
      "imdb"
    );
  });
});

describe("movie link preference form", () => {
  test("saves the selection through the guarded API and refreshes the account", async () => {
    mocks.mutation.mockResolvedValue({
      movieLinkPreference: "tmdb",
      updatedAt: 1,
    });
    act(() => {
      renderer = create(<MovieLinkPreferenceForm initialPreference="imdb" />);
    });
    expect(renderer.root.findByType("button").props.disabled).toBe(true);
    act(() => {
      renderer.root.findByProps({ value: "tmdb" }).props.onChange();
    });
    await act(async () => {
      renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
    expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), {
      clientApiVersion: expect.any(String),
      movieLinkPreference: "tmdb",
    });
    expect(mocks.refreshAccount).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith("Movie link preference saved.");
  });
  test("disables controls during save and preserves the selection on failure for retry", async () => {
    let rejectSave!: (error: Error) => void;
    mocks.mutation.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        })
    );
    act(() => {
      renderer = create(<MovieLinkPreferenceForm initialPreference="imdb" />);
    });
    act(() => {
      renderer.root.findByProps({ value: "tmdb" }).props.onChange();
    });
    act(() => {
      renderer.root.findByType("form").props.onSubmit({ preventDefault() {} });
    });
    expect(renderer.root.findByType("fieldset").props.disabled).toBe(true);
    expect(renderer.root.findByType("button").props.disabled).toBe(true);
    await act(async () => {
      rejectSave(new Error("offline"));
    });
    expect(
      renderer.root.findByProps({ role: "alert" }).children.join("")
    ).toContain("could not be saved");
    expect(renderer.root.findByProps({ value: "tmdb" }).props.checked).toBe(
      true
    );
    expect(mocks.refreshAccount).not.toHaveBeenCalled();
    expect(renderer.root.findByType("button").props.disabled).toBe(false);
  });
});
