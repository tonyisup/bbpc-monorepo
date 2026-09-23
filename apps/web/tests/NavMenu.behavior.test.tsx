import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn<(reference: unknown, args: { today: string }) => unknown>(),
  pathname: "/",
  accountStatus: "ready" as string,
  user: { appUserId: "user-1", name: "Ada", image: null } as {
    appUserId: string;
    name: string;
    image: string | null;
  } | null,
}));

vi.mock("convex/react", () => ({ useQuery: mocks.useQuery }));
vi.mock("@tonyisup/bbpc-convex-api", () => ({
  api: { games: { member: { myLatestPointChange: "myLatestPointChange" } } },
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/utils", () => ({
  cn: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
}));
vi.mock("@/components/auth/BbpcAuthContext", () => ({
  useBbpcAuth: () => ({
    accountStatus: mocks.accountStatus,
    user: mocks.user,
    signIn: () => undefined,
    signOut: () => undefined,
  }),
}));
vi.mock("@/components/ConvexImpersonationControl", () => ({
  ConvexImpersonationControl: () => null,
}));
vi.mock("@/components/ui/avatar", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  );
  return { Avatar: Pass, AvatarFallback: Pass, AvatarImage: () => null };
});
vi.mock("@/components/ui/navigation-menu", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    NavigationMenu: Pass,
    NavigationMenuList: Pass,
    NavigationMenuItem: Pass,
    NavigationMenuContent: Pass,
    NavigationMenuLink: Pass,
    NavigationMenuTrigger: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
    }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  };
});

import NavMenu from "@/components/NavMenu";

const LATEST = Date.parse("2026-09-11T04:00:00Z");

let renderer: ReactTestRenderer | null = null;
let storage: Map<string, string>;

async function render(): Promise<ReactTestRenderer> {
  await act(async () => {
    renderer = create(<NavMenu />);
  });
  await act(() => Promise.resolve());
  if (renderer === null) {
    throw new Error("NavMenu did not render.");
  }
  return renderer;
}

function text(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : text(child)))
    .join("");
}

function gameLinks(rendered: ReactTestRenderer): string[] {
  return rendered.root
    .findAll((node) => node.type === "a" && node.props.href === "/game")
    .map(text);
}

describe("NavMenu game point badge", () => {
  beforeEach(() => {
    storage = new Map();
    mocks.pathname = "/";
    mocks.accountStatus = "ready";
    mocks.user = { appUserId: "user-1", name: "Ada", image: null };
    vi.stubGlobal("window", {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    vi.stubGlobal("document", {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    mocks.useQuery.mockReturnValue({
      seasonId: "season-1",
      lastScoredAt: LATEST,
      points: [{ earnedAt: LATEST, pointValue: 5 }],
    });
  });

  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    mocks.useQuery.mockReset();
    vi.unstubAllGlobals();
  });

  test("badges both Game links and describes the mobile menu dot", async () => {
    const rendered = await render();

    const links = gameLinks(rendered);
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toContain("+5");
    }
    const trigger = rendered.root.findByProps({
      "aria-label": "Open navigation menu",
    });
    expect(trigger.props["aria-describedby"]).toBe("nav-game-point-change");
    expect(
      rendered.root.findByProps({ id: "nav-game-point-change" }).children
    ).toEqual(["New game points from the last episode"]);
  });

  test("clears the badge on the game page and remembers it per member", async () => {
    mocks.pathname = "/game";
    const rendered = await render();

    for (const link of gameLinks(rendered)) {
      expect(link).not.toContain("+5");
    }
    expect(storage.get("bbpc.seenPointChange:user-1")).toMatch(/:5$/u);
    expect(
      rendered.root.findByProps({ "aria-label": "Open navigation menu" }).props[
        "aria-describedby"
      ]
    ).toBeUndefined();
  });

  test("does not query points for signed-out visitors", async () => {
    mocks.accountStatus = "not-applicable";
    mocks.user = null;
    const rendered = await render();

    expect(mocks.useQuery).not.toHaveBeenCalled();
    for (const link of gameLinks(rendered)) {
      expect(link).toBe("Game");
    }
  });
});
