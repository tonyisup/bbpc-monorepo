import React, { StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { movieYearConformanceFixtures } from "./conformance-fixtures";
import {
  MOVIE_YEAR_HINT_DELAY_MS,
  analyzeMovieYearQuery,
  applyMovieYearHint,
  deriveMovieYearHint,
  type MovieYearHint,
  type MovieYearHintInput,
  useMovieYearHint,
} from "./index";

describe("analyzeMovieYearQuery", () => {
  it.each(movieYearConformanceFixtures)("matches $name", (fixture) => {
    expect(analyzeMovieYearQuery(fixture.input)).toEqual({
      normalizedQuery: fixture.frontend.normalizedQuery,
      syntax: fixture.frontend.syntax,
      hasValidModifier: fixture.frontend.hasValidModifier,
      releaseYearCandidate: fixture.frontend.releaseYearCandidate,
      canAppendModifier: fixture.frontend.canAppendModifier,
    });
  });

  it("chooses only the final bare year", () => {
    expect(analyzeMovieYearQuery("The Thing 1982 2011").releaseYearCandidate).toBe(
      2011,
    );
  });
});

describe("deriveMovieYearHint", () => {
  const settledMovie: MovieYearHintInput = {
    mediaKind: "movie",
    currentInput: "Imposter",
    requestQuery: "Imposter",
    phase: "settled",
    tmdbStatus: "fulfilled",
    visibleResultCount: 0,
  };

  it("offers an immediate append after zero visible results", () => {
    expect(deriveMovieYearHint(settledMovie)).toEqual({
      kind: "immediate-add",
      actionable: true,
    });
  });

  it("offers an immediate bare-year rewrite after zero visible results", () => {
    expect(
      deriveMovieYearHint({
        ...settledMovie,
        currentInput: "Imposter (2001)",
        requestQuery: "Imposter (2001)",
      }),
    ).toEqual({ kind: "immediate-rewrite", year: 2001 });
  });

  it("does not offer an unusable rewrite for an out-of-range bare year", () => {
    expect(
      deriveMovieYearHint({
        ...settledMovie,
        currentInput: "Imposter (0001)",
        requestQuery: "Imposter (0001)",
      }),
    ).toEqual({ kind: "immediate-add", actionable: true });
  });

  it("uses a delayed generic hint when visible results exist", () => {
    expect(
      deriveMovieYearHint({ ...settledMovie, visibleResultCount: 3 }),
    ).toEqual({
      kind: "delayed-add",
      delayMs: MOVIE_YEAR_HINT_DELAY_MS,
      actionable: true,
    });
  });

  it.each([
    ["show search", { mediaKind: "show" }],
    ["idle phase", { phase: "idle" }],
    ["searching phase", { phase: "searching" }],
    ["TMDB rejection", { tmdbStatus: "rejected" }],
    ["stale query", { currentInput: "Different" }],
    ["complete modifier", { currentInput: "Imposter y:2001", requestQuery: "Imposter y:2001" }],
    ["malformed modifier", { currentInput: "Imposter y:nope", requestQuery: "Imposter y:nope" }],
  ] as const)("stays hidden for %s", (_name, override) => {
    expect(deriveMovieYearHint({ ...settledMovie, ...override })).toEqual({
      kind: "hidden",
    });
  });

  it("keeps the teaching copy but disables an overflowing append", () => {
    const query = "a".repeat(198);
    expect(
      deriveMovieYearHint({
        ...settledMovie,
        currentInput: query,
        requestQuery: query,
      }),
    ).toEqual({ kind: "immediate-add", actionable: false });
  });
});

describe("applyMovieYearHint", () => {
  it("appends an incomplete modifier and places the caret after its colon", () => {
    expect(applyMovieYearHint(" Imposter ", { kind: "append" })).toEqual({
      query: "Imposter y:",
      caret: 11,
      rerun: false,
    });
  });

  it("rewrites a parenthesized release year and requests a rerun", () => {
    expect(
      applyMovieYearHint("Imposter (2001)", { kind: "rewrite", year: 2001 }),
    ).toEqual({ query: "Imposter y:2001", caret: 15, rerun: true });
  });

  it("preserves earlier bare years while rewriting only the final one", () => {
    expect(
      applyMovieYearHint("The Thing 1982 2011", {
        kind: "rewrite",
        year: 2011,
      }),
    ).toEqual({ query: "The Thing 1982 y:2011", caret: 21, rerun: true });
  });

  it.each([
    ["overflowing append", "a".repeat(198), { kind: "append" }],
    ["numeric-only rewrite", "1917", { kind: "rewrite", year: 1917 }],
    ["mismatched rewrite", "Imposter 2001", { kind: "rewrite", year: 2002 }],
    ["existing modifier", "Imposter y:2001", { kind: "append" }],
    ["invalid syntax", "Imposter y:nope", { kind: "append" }],
  ] as const)("rejects %s", (_name, query, action) => {
    expect(applyMovieYearHint(query, action)).toBeNull();
  });
});

describe("useMovieYearHint", () => {
  type HarnessProps = MovieYearHintInput & {
    requestGeneration: number;
    onHint: (hint: MovieYearHint) => void;
  };

  function Harness({ onHint, ...input }: HarnessProps) {
    onHint(useMovieYearHint(input));
    return null;
  }

  const baseProps: HarnessProps = {
    mediaKind: "movie",
    currentInput: "Imposter",
    requestQuery: "Imposter",
    phase: "settled",
    tmdbStatus: "fulfilled",
    visibleResultCount: 1,
    requestGeneration: 1,
    onHint: () => undefined,
  };
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    vi.useRealTimers();
  });

  it("reveals delayed help at exactly three seconds", () => {
    let latest: MovieYearHint = { kind: "hidden" };
    act(() => {
      renderer = create(
        <Harness {...baseProps} onHint={(hint) => (latest = hint)} />,
      );
    });
    expect(latest).toEqual({ kind: "hidden" });

    act(() => {
      vi.advanceTimersByTime(MOVIE_YEAR_HINT_DELAY_MS - 1);
    });
    expect(latest).toEqual({ kind: "hidden" });

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(latest).toEqual({
      kind: "delayed-add",
      delayMs: MOVIE_YEAR_HINT_DELAY_MS,
      actionable: true,
    });
  });

  it("does not restart for a new caller object with identical primitives", () => {
    let latest: MovieYearHint = { kind: "hidden" };
    act(() => {
      renderer = create(
        <Harness {...baseProps} onHint={(hint) => (latest = hint)} />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      renderer?.update(
        <Harness {...{ ...baseProps }} onHint={(hint) => (latest = hint)} />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(latest.kind).toBe("delayed-add");
  });

  it("cancels on query and generation changes", () => {
    let latest: MovieYearHint = { kind: "hidden" };
    act(() => {
      renderer = create(
        <Harness {...baseProps} onHint={(hint) => (latest = hint)} />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    act(() => {
      renderer?.update(
        <Harness
          {...baseProps}
          currentInput="Other"
          requestGeneration={2}
          onHint={(hint) => (latest = hint)}
        />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(latest).toEqual({ kind: "hidden" });
  });

  it("cleans up Strict Mode timers on unmount", () => {
    const onHint = vi.fn();
    act(() => {
      renderer = create(
        <StrictMode>
          <Harness {...baseProps} onHint={onHint} />
        </StrictMode>,
      );
    });
    act(() => renderer?.unmount());
    renderer = null;
    act(() => {
      vi.advanceTimersByTime(MOVIE_YEAR_HINT_DELAY_MS);
    });
    expect(onHint).toHaveBeenCalledTimes(1);
  });

  it("passes immediate hints through without a timer", () => {
    let latest: MovieYearHint = { kind: "hidden" };
    act(() => {
      renderer = create(
        <Harness
          {...baseProps}
          visibleResultCount={0}
          onHint={(hint) => (latest = hint)}
        />,
      );
    });
    expect(latest).toEqual({ kind: "immediate-add", actionable: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
