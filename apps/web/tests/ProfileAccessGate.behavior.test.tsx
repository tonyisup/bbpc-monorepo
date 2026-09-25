import type { ButtonHTMLAttributes, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

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
vi.mock("@/components/SignOutButton", () => ({
  default: () => <button>Sign out</button>,
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

import { ProfileAccessGate } from "@/app/profile/ProfileAccessGate";

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

let renderer: ReactTestRenderer | null = null;

function render() {
  act(() => {
    renderer = create(
      <ProfileAccessGate label="profile">
        {(user) => <p>{`Welcome ${user.appUserId}`}</p>}
      </ProfileAccessGate>
    );
  });
  if (renderer === null) {
    throw new Error("Gate did not render.");
  }
  return JSON.stringify(renderer.toJSON());
}

describe("ProfileAccessGate", () => {
  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
  });

  test("shows a skeleton while auth or the account resolves", () => {
    mocks.auth.status = "loading";
    expect(render()).toContain("Loading profile");
    act(() => renderer?.unmount());
    mocks.auth.status = "authenticated";
    mocks.auth.accountStatus = "resolving";
    mocks.auth.user = readyUser;
    expect(render()).toContain("Loading profile");
  });

  test("asks a signed-out visitor to sign in", () => {
    mocks.auth.status = "unauthenticated";
    mocks.auth.accountStatus = "not-applicable";
    mocks.auth.user = null;
    const text = render();
    expect(text).toContain("Sign in to view your profile");
    act(() => {
      renderer?.root.findByType("button").props.onClick();
    });
    expect(mocks.auth.signIn).toHaveBeenCalled();
  });

  test("explains an account that needs attention", () => {
    mocks.auth.status = "authenticated";
    mocks.auth.accountStatus = "action-required";
    mocks.auth.accountIssue = "account-disabled";
    mocks.auth.user = { ...readyUser, appUserId: null };
    const text = render();
    expect(text).toContain("Account unavailable");
    expect(text).toContain("This BBPC account is disabled");
    expect(text).toContain("Try again");
  });

  test("renders the page for a resolved account", () => {
    mocks.auth.status = "authenticated";
    mocks.auth.accountStatus = "ready";
    mocks.auth.accountIssue = null;
    mocks.auth.user = readyUser;
    expect(render()).toContain("Welcome user-1");
  });
});
