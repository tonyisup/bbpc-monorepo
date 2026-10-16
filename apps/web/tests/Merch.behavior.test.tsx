import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheCalls: [] as unknown[][],
  listVisible: vi.fn<() => Promise<unknown>>(),
  fetchPublicQuery:
    vi.fn<(reference: unknown, args: unknown) => Promise<unknown>>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/convex/client", () => ({
  fetchPublicQuery: mocks.fetchPublicQuery,
}));
vi.mock("@/server/convex/merch", () => ({
  listVisibleMerchItems: mocks.listVisible,
}));
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

// Outside a Next request there is no cache store, so call the loader directly.
vi.mock("next/cache", () => ({
  unstable_cache: (load: () => Promise<unknown>, ...options: unknown[]) => {
    mocks.cacheCalls.push([load, ...options]);
    return load;
  },
}));
vi.mock("next/image", () => ({
  default: ({ onError, src }: { onError?: () => void; src: string }) => (
    <img src={src} onError={onError} />
  ),
}));

import { DynamicServerError } from "next/dist/client/components/hooks-server-context";

import MerchPage from "@/app/merch/page";
import { MerchItemCard } from "@/components/MerchItemCard";
import {
  getMerchLinkLabel,
  MERCH_STORE_URL,
  splitMerchItems,
  type MerchItem,
} from "@/lib/merch";

function item(overrides: Partial<MerchItem> = {}): MerchItem {
  return {
    id: "merch-1",
    title: "Bad Boys Logo Tee",
    description: null,
    url: "https://www.teepublic.com/t-shirt/1-bad-boys-logo",
    imageUrl: "https://images.example.test/tee.jpg",
    priceLabel: null,
    badge: null,
    featured: false,
    ...overrides,
  };
}

function render(element: React.ReactElement): ReactTestRenderer {
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(element);
  });
  if (renderer === undefined) {
    throw new Error("Expected a renderer");
  }
  return renderer;
}

function textOf(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) =>
      node.children.filter((child) => typeof child === "string")
    )
    .join(" ");
}

describe("merch item card", () => {
  test("links out in a new tab with the item's details", () => {
    const renderer = render(
      <MerchItemCard
        item={item({
          description: "The classic.",
          priceLabel: "From $22",
          badge: "New",
          featured: true,
        })}
      />
    );
    const link = renderer.root.findByType("a");
    expect(link.props).toMatchObject({
      href: "https://www.teepublic.com/t-shirt/1-bad-boys-logo",
      target: "_blank",
      rel: "noopener noreferrer",
    });
    const text = textOf(renderer);
    for (const expected of [
      "Bad Boys Logo Tee",
      "From $22",
      "The classic.",
      "Featured",
      "New",
      "View on TeePublic",
      "(opens in a new tab)",
    ]) {
      expect(text).toContain(expected);
    }
  });

  test("falls back to a placeholder when the photo fails to load", () => {
    const renderer = render(<MerchItemCard item={item()} />);
    const image = renderer.root.findByType("img");
    act(() => {
      (image.props as { onError: () => void }).onError();
    });
    expect(renderer.root.findAllByType("img")).toHaveLength(0);
  });

  test("shows a placeholder without a photo", () => {
    const renderer = render(<MerchItemCard item={item({ imageUrl: null })} />);
    expect(renderer.root.findAllByType("img")).toHaveLength(0);
    expect(textOf(renderer)).not.toContain("Featured");
  });
});

describe("merch helpers", () => {
  test("names the destination shop", () => {
    expect(getMerchLinkLabel("https://www.teepublic.com/mug/1")).toBe(
      "View on TeePublic"
    );
    expect(getMerchLinkLabel("https://shop.example.test/item")).toBe(
      "View on shop.example.test"
    );
    expect(getMerchLinkLabel("not a url")).toBe("View product");
  });

  test("leads with the first featured item and keeps the rest in order", () => {
    const first = item({ id: "a" });
    const featured = item({ id: "b", featured: true });
    const alsoFeatured = item({ id: "c", featured: true });
    expect(splitMerchItems([first, featured, alsoFeatured])).toEqual({
      spotlight: featured,
      rest: [first, alsoFeatured],
    });
    expect(splitMerchItems([first])).toEqual({
      spotlight: null,
      rest: [first],
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  mocks.listVisible.mockReset();
  mocks.fetchPublicQuery.mockReset();
});

describe("merch page", () => {
  const hrefs = (renderer: ReactTestRenderer) =>
    renderer.root
      .findAllByType("a")
      .map((link) => (link.props as { href: string }).href);

  test("caches the Convex loader for five minutes", () => {
    // Captured when the page module loaded.
    expect(mocks.cacheCalls).toEqual([
      [mocks.listVisible, ["merch-visible-items"], { revalidate: 300 }],
    ]);
  });

  test("shows the logo and a grid without a featured item, and only the spotlight with one", async () => {
    const tee = item({ id: "tee", url: "https://www.teepublic.com/t/tee" });
    mocks.listVisible.mockResolvedValueOnce([tee]);
    const plain = render(await MerchPage());
    expect(plain.root.findAllByType("li")).toHaveLength(1);
    expect(hrefs(plain)).toEqual([MERCH_STORE_URL, tee.url, MERCH_STORE_URL]);

    const mug = item({
      id: "mug",
      url: "https://www.teepublic.com/m/mug",
      featured: true,
    });
    mocks.listVisible.mockResolvedValueOnce([mug]);
    const spotlightOnly = render(await MerchPage());
    expect(textOf(spotlightOnly)).not.toContain("In the shop");
    expect(hrefs(spotlightOnly)).toEqual([
      MERCH_STORE_URL,
      mug.url,
      MERCH_STORE_URL,
    ]);
  });

  test("falls back to one store link on a failed load, else spotlights the first featured item", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mocks.listVisible.mockRejectedValueOnce(new Error("offline"));

    const renderer = render(await MerchPage());

    expect(consoleError).toHaveBeenCalledWith(
      "Merch items could not be loaded.",
      expect.any(Error)
    );
    expect(hrefs(renderer)).toEqual([MERCH_STORE_URL]);
    expect(textOf(renderer)).not.toContain("In the shop");

    const tee = item({ id: "tee", url: "https://www.teepublic.com/t/tee" });
    const mug = item({
      id: "mug",
      title: "Reese's Mug",
      url: "https://www.teepublic.com/m/mug",
      featured: true,
      description: "For the MCP.",
    });
    mocks.listVisible.mockResolvedValueOnce([tee, mug]);

    const loaded = render(await MerchPage());

    expect(hrefs(loaded)).toEqual([
      MERCH_STORE_URL,
      mug.url,
      tee.url,
      MERCH_STORE_URL,
    ]);
    expect(loaded.root.findAllByType("li")).toHaveLength(1);
    expect(textOf(loaded)).toContain("In the shop");
    expect(textOf(loaded)).toContain("For the MCP.");
    // The spotlight's placement says "featured"; it does not repeat the pill.
    expect(textOf(loaded)).not.toContain("Featured");
  });

  test("lets Next's dynamic-rendering signal through instead of rendering empty", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const signal = new DynamicServerError("no-store fetch");
    mocks.listVisible.mockRejectedValueOnce(signal);

    await expect(MerchPage()).rejects.toBe(signal);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("merch server loader", () => {
  test("parses visible items and rejects a malformed payload", async () => {
    const { listVisibleMerchItems } = await vi.importActual<
      typeof import("@/server/convex/merch")
    >("@/server/convex/merch");
    const row = { ...item(), updatedAt: 1 };
    mocks.fetchPublicQuery.mockResolvedValueOnce([row]);

    await expect(listVisibleMerchItems()).resolves.toEqual([item()]);
    expect(mocks.fetchPublicQuery).toHaveBeenCalledWith(expect.anything(), {});

    for (const malformed of [
      [{ ...row, featured: "yes" }],
      [{ ...row, id: "" }],
      [{ ...row, imageUrl: undefined }],
      { items: [row] },
    ]) {
      mocks.fetchPublicQuery.mockResolvedValueOnce(malformed);
      await expect(listVisibleMerchItems()).rejects.toThrow();
    }
  });
});
