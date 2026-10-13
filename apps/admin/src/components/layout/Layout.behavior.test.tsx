import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("next/head", () => ({ default: () => null }));
vi.mock("./Sidebar", () => ({ Sidebar: () => <nav>Sidebar</nav> }));

import {
  BbpcAdminAuthStateProvider,
  type BbpcAdminAuthState,
} from "../auth/BbpcAdminAuthContext";
import Layout from "./Layout";

const signedOut: BbpcAdminAuthState = {
  status: "unauthenticated",
  accountStatus: "not-applicable",
  accountIssue: null,
  user: null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshAccount: vi.fn(),
};
const signedIn: BbpcAdminAuthState = {
  ...signedOut,
  status: "authenticated",
  accountStatus: "ready",
  user: {
    appUserId: "user-1",
    name: "Alice",
    email: "alice@example.com",
    image: null,
    isAdmin: true,
  },
};

let renderer: ReactTestRenderer | null = null;
function render(value: BbpcAdminAuthState) {
  act(() => {
    renderer = create(
      <BbpcAdminAuthStateProvider value={value}>
        <Layout>
          <p>Episodes page</p>
        </Layout>
      </BbpcAdminAuthStateProvider>
    );
  });
}
function text() {
  return JSON.stringify(renderer?.toJSON());
}
function button(label: string) {
  const match = renderer?.root
    .findAllByType("button")
    .find((candidate) => JSON.stringify(candidate.props.children).includes(label));
  if (!match) throw new Error(`No "${label}" button rendered.`);
  return match;
}

afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = null;
  vi.clearAllMocks();
});

test("offers sign-in on any page instead of rendering it signed out", () => {
  render(signedOut);

  expect(text()).not.toContain("Episodes page");
  act(() => button("Sign In").props.onClick());
  expect(signedOut.signIn).toHaveBeenCalledTimes(1);
});

test("offers retry and sign-out on any page when the account needs attention", () => {
  const value: BbpcAdminAuthState = {
    ...signedIn,
    accountStatus: "action-required",
    accountIssue: "account-disabled",
  };
  render(value);

  expect(text()).not.toContain("Episodes page");
  expect(text()).toContain("This account is disabled.");
  act(() => button("Try again").props.onClick());
  act(() => button("Sign out").props.onClick());
  expect(value.refreshAccount).toHaveBeenCalledTimes(1);
  expect(value.signOut).toHaveBeenCalledTimes(1);
});

test("renders the page for a signed-in, resolved account", () => {
  render(signedIn);

  expect(text()).toContain("Episodes page");
});
