import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    accountIssue: null as string | null,
    accountStatus: "not-applicable",
    refreshAccount: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    status: "loading",
    user: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => mocks.auth,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ConvexPredictionGame", () => ({
  ConvexPredictionGame: ({
    assignments,
    children,
  }: {
    assignments: unknown[];
    children?: ReactNode;
  }) => (
    <section aria-label="Listener game">
      <p>{`Picks for ${String(assignments.length)} movie`}</p>
      {children}
    </section>
  ),
}));
vi.mock("@/components/ConvexQuotabungaSubmission", () => ({
  ConvexQuotabungaSubmission: ({
    episodeId,
    isAdmin,
  }: {
    episodeId: string;
    isAdmin: boolean;
  }) => (
    <section id="quotabunga-submit">{`Quotabunga ${episodeId} ${
      isAdmin ? "admin" : "listener"
    }`}</section>
  ),
}));

import { GameParticipation } from "@/components/GameParticipation";

const readyUser = {
  appUserId: "user-1",
  name: "Tony",
  email: null,
  image: null,
  isAdmin: false,
  isHost: false,
  isImpersonating: false,
  movieLinkPreference: "imdb",
};
const movie = {
  id: "assignment",
  playable: true,
  movie: { title: "Test movie", poster: null },
};

let renderer: ReactTestRenderer | null = null;

function render(assignments: (typeof movie)[] = [movie]) {
  act(() => {
    renderer = create(
      <GameParticipation
        episodeId="episode-test"
        assignments={assignments}
        episodeStatus="next"
      />
    );
  });
  if (renderer === null) {
    throw new Error("Game did not render.");
  }
  return renderer as ReactTestRenderer;
}

function instanceText(instance: ReactTestInstance): string {
  return instance.children
    .map((child) => (typeof child === "string" ? child : instanceText(child)))
    .join("");
}

/** The host elements labelled as the listener game, outermost first. */
function sheets(rendered: ReactTestRenderer) {
  return rendered.root.findAll(
    (node) =>
      node.type === "section" && node.props["aria-label"] === "Listener game"
  );
}

function clickButton(rendered: ReactTestRenderer, label: string) {
  const found = rendered.root
    .findAllByType("button")
    .find((candidate) => instanceText(candidate) === label);
  if (found === undefined) {
    throw new Error(`Missing button: ${label}`);
  }
  act(() => {
    found.props.onClick();
  });
}

describe("GameParticipation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.accountIssue = null;
    mocks.auth.accountStatus = "not-applicable";
    mocks.auth.status = "loading";
    mocks.auth.user = null;
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
  });

  test("a visitor waits, signs in, or sorts out their account on the game sheet before any game loads", () => {
    let rendered = render();
    expect(
      rendered.root.findAllByProps({ "aria-label": "Loading game" })
    ).toHaveLength(1);
    expect(sheets(rendered)).toHaveLength(0);
    act(() => rendered.unmount());

    mocks.auth.status = "unauthenticated";
    rendered = render();
    expect(sheets(rendered)).toHaveLength(1);
    expect(instanceText(rendered.root)).toContain(
      "One account covers your picks, wagers and Quotabunga quote."
    );
    expect(instanceText(rendered.root)).not.toContain("Quotabunga episode");
    clickButton(rendered, "Sign in to play");
    expect(mocks.auth.signIn).toHaveBeenCalledTimes(1);
    act(() => rendered.unmount());

    mocks.auth.status = "authenticated";
    mocks.auth.accountStatus = "resolving";
    mocks.auth.user = { ...readyUser, appUserId: null };
    rendered = render();
    expect(
      rendered.root.findAllByProps({ "aria-label": "Resolving game account" })
    ).toHaveLength(1);
    expect(sheets(rendered)).toHaveLength(0);
    act(() => rendered.unmount());

    mocks.auth.accountStatus = "action-required";
    for (const [issue, message] of [
      ["account-disabled", "This account is disabled."],
      [
        "identity-conflict",
        "This sign-in is already linked to another account.",
      ],
      [
        "linking-disabled",
        "New account linking is paused in this environment.",
      ],
      ["stale-client", "This page is out of date."],
      [null, "Your game account could not be resolved."],
    ] as const) {
      mocks.auth.accountIssue = issue;
      rendered = render();
      expect(sheets(rendered)).toHaveLength(1);
      expect(instanceText(rendered.root)).toContain(
        "Game account needs attention"
      );
      expect(instanceText(rendered.root)).toContain(message);
      expect(instanceText(rendered.root)).not.toContain("Picks for");
      act(() => rendered.unmount());
    }

    rendered = render();
    clickButton(rendered, "Try again");
    expect(mocks.auth.refreshAccount).toHaveBeenCalledTimes(1);
    clickButton(rendered, "Sign out");
    expect(mocks.auth.signOut).toHaveBeenCalledTimes(1);
  });

  test("Quotabunga is a row of the picks sheet, and a sheet of its own when the episode has no movies", () => {
    mocks.auth.status = "authenticated";
    mocks.auth.accountStatus = "ready";
    mocks.auth.user = { ...readyUser, isAdmin: true };

    let rendered = render();
    expect(sheets(rendered)).toHaveLength(1);
    expect(instanceText(sheets(rendered)[0]!)).toBe(
      "Picks for 1 movieQuotabunga episode-test admin"
    );
    expect(
      sheets(rendered)[0]!.findAllByProps({ id: "quotabunga-submit" })
    ).toHaveLength(1);
    act(() => rendered.unmount());

    mocks.auth.user = readyUser;
    rendered = render([]);
    expect(sheets(rendered)).toHaveLength(1);
    expect(instanceText(sheets(rendered)[0]!)).toBe(
      "Quotabunga episode-test listener"
    );
    expect(instanceText(rendered.root)).not.toContain("Picks for");
  });
});
