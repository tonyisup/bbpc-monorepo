import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ConvexAdminEpisodeDetail } from "@/convex/episodeDetails";
import { BBPC_CLIENT_API_VERSION } from "@/convex/identity";

const mocks = vi.hoisted(() => ({
  client: { query: vi.fn(), mutation: vi.fn() },
  close: vi.fn(),
  merged: vi.fn(),
}));
vi.mock("convex/react", () => ({ useConvex: () => mocks.client }));
vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/ui/dialog", () => {
  const Element = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Dialog: Element,
    DialogContent: Element,
    DialogDescription: Element,
    DialogFooter: Element,
    DialogHeader: Element,
    DialogTitle: Element,
  };
});
import { EpisodeMergeDialog } from "./EpisodeMergeDialog";

const episode = {
  id: "episode-keeper",
  number: 12,
  title: "Example",
  date: "2026-09-01",
} as ConvexAdminEpisodeDetail;
const relations = {
  archivePosts: [],
  assignments: [],
  extraReviews: [],
  episodeLinks: [],
};
const snapshot = {
  keeper: {
    _id: episode.id,
    number: 12,
    title: "Example",
    date: episode.date,
    slug: "example-2",
  },
  donor: {
    _id: "episode-donor",
    number: 12,
    title: "Example",
    date: "2026-09-02",
    slug: "example",
  },
  keeperRelations: relations,
  donorRelations: {
    ...relations,
    episodeLinks: [{ _id: "link-1", text: "Example" }],
  },
  transcript: { passageCount: 2 },
  passages: [{ text: "Original text" }],
  patch: { description: "Copied description" },
  slug: "episode-12-example",
};
const preview = {
  fingerprint: "original-fingerprint",
  snapshotJson: JSON.stringify(snapshot),
  slug: snapshot.slug,
};
const result = {
  keeperId: episode.id,
  removedId: snapshot.donor._id,
  slug: snapshot.slug,
};
let renderer: ReactTestRenderer;
function text(node: ReactTestInstance | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}
function button(label: string) {
  const node = renderer.root
    .findAllByType("button")
    .find((node) => text(node) === label);
  if (!node) throw new Error(`Missing button: ${label}`);
  return node;
}
function input(id: string) {
  const node = renderer.root
    .findAllByType("input")
    .find((node) => node.props.id === id);
  if (!node) throw new Error(`Missing input: ${id}`);
  return node;
}
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a mock call");
  return value;
}
async function open() {
  await act(async () => {
    renderer = create(
      <EpisodeMergeDialog
        episode={episode}
        onClose={mocks.close}
        onMerged={mocks.merged}
      />
    );
  });
  act(() =>
    input("merge-other-id").props.onChange({
      target: { value: "episode-donor" },
    })
  );
}
async function load() {
  await open();
  await act(async () => button("Preview merge").props.onClick());
}
function acknowledge() {
  act(() =>
    input("merge-backup").props.onChange({
      target: { value: " private-backup-123 " },
    })
  );
  act(() =>
    renderer.root
      .findByProps({ type: "checkbox" })
      .props.onChange({ target: { checked: true } })
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.query.mockResolvedValue(preview);
  mocks.client.mutation.mockResolvedValue(result);
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
});

test("preview is read-only and merge requires backup receipt and acknowledgment", async () => {
  await load();
  expect(getFunctionName(required(mocks.client.query.mock.calls[0])[0])).toBe(
    "episodes/admin:previewDuplicateMerge"
  );
  expect(required(mocks.client.query.mock.calls[0])[1]).toEqual({
    keeperId: episode.id,
    donorId: "episode-donor",
  });
  expect(mocks.client.mutation).not.toHaveBeenCalled();
  expect(text(renderer.root)).toContain("Copied description");
  expect(text(renderer.root)).toContain("Retain 2 transcript passages");
  expect(button("Merge and delete duplicate").props.disabled).toBe(true);
  act(() =>
    input("merge-backup").props.onChange({ target: { value: "receipt" } })
  );
  expect(button("Merge and delete duplicate").props.disabled).toBe(true);
  acknowledge();
  expect(button("Merge and delete duplicate").props.disabled).toBe(false);
  await act(async () => button("Merge and delete duplicate").props.onClick());
  expect(
    getFunctionName(required(mocks.client.mutation.mock.calls[0])[0])
  ).toBe("episodes/admin:mergeDuplicateEpisode");
  expect(required(mocks.client.mutation.mock.calls[0])[1]).toEqual({
    keeperId: episode.id,
    donorId: "episode-donor",
    expectedFingerprint: preview.fingerprint,
    backupReceipt: "private-backup-123",
    confirmation: "MERGE_WITHOUT_REDIRECTS_AND_REBUILD_SLUG",
    clientApiVersion: BBPC_CLIENT_API_VERSION,
  });
  expect(mocks.merged).not.toHaveBeenCalled();
  act(() => button("View retained episode").props.onClick());
  expect(mocks.merged).toHaveBeenCalledWith(result);
});

test("changing direction or the other episode invalidates the preview and confirmations", async () => {
  await load();
  acknowledge();
  act(() =>
    renderer.root
      .findByType("select")
      .props.onChange({ target: { value: "other" } })
  );
  expect(button("Merge and delete duplicate").props.disabled).toBe(true);
  expect(renderer.root.findAllByProps({ type: "checkbox" })).toHaveLength(0);
  mocks.client.query.mockResolvedValue({
    ...preview,
    snapshotJson: JSON.stringify({
      ...snapshot,
      keeper: snapshot.donor,
      donor: snapshot.keeper,
    }),
  });
  await act(async () => button("Preview merge").props.onClick());
  expect(required(mocks.client.query.mock.calls[1])[1]).toEqual({
    keeperId: "episode-donor",
    donorId: episode.id,
  });
  expect(input("merge-backup").props.value).toBe("");
  expect(renderer.root.findByProps({ type: "checkbox" }).props.checked).toBe(
    false
  );
  acknowledge();
  act(() =>
    input("merge-other-id").props.onChange({
      target: { value: "another-episode" },
    })
  );
  expect(button("Merge and delete duplicate").props.disabled).toBe(true);
  expect(mocks.client.mutation).not.toHaveBeenCalled();
});

test("same-episode and unsafe pairs cannot merge; server rejection is visible", async () => {
  await open();
  act(() =>
    input("merge-other-id").props.onChange({ target: { value: episode.id } })
  );
  expect(button("Preview merge").props.disabled).toBe(true);
  act(() =>
    input("merge-other-id").props.onChange({
      target: { value: "episode-donor" },
    })
  );
  mocks.client.query.mockRejectedValue(
    new ConvexError({
      code: "CONFLICT",
      message:
        "Keeper must have the only transcript; donor must have no metadata or passages.",
    })
  );
  await act(async () => button("Preview merge").props.onClick());
  expect(text(renderer.root)).toContain("Keeper must have the only transcript");
  expect(button("Merge and delete duplicate").props.disabled).toBe(true);
  expect(mocks.client.mutation).not.toHaveBeenCalled();
});

test("a stale preview rejection requires explicit preview and never automatically retries", async () => {
  await load();
  acknowledge();
  mocks.client.mutation.mockRejectedValue(
    new ConvexError({
      code: "CONFLICT",
      message: "Merge data changed. Preview and back up again.",
    })
  );
  await act(async () => button("Merge and delete duplicate").props.onClick());
  expect(mocks.client.query).toHaveBeenCalledTimes(1);
  expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
  expect(text(renderer.root)).toContain("Merge data changed");
  expect(button("Merge and delete duplicate").props.disabled).toBe(true);
  expect(mocks.merged).not.toHaveBeenCalled();
  await act(async () => button("Preview merge").props.onClick());
  expect(input("merge-backup").props.value).toBe("");
  expect(renderer.root.findByProps({ type: "checkbox" }).props.checked).toBe(
    false
  );
});

test("duplicate clicks submit one merge and prevent dismissal while pending", async () => {
  await load();
  acknowledge();
  let resolve!: (value: typeof result) => void;
  mocks.client.mutation.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const submit = button("Merge and delete duplicate").props.onClick;
  act(() => {
    submit();
    submit();
  });
  expect(mocks.client.mutation).toHaveBeenCalledTimes(1);
  expect(button("Merging…").props.disabled).toBe(true);
  act(() => button("Cancel").props.onClick());
  expect(mocks.close).not.toHaveBeenCalled();
  await act(async () => resolve(result));
  expect(text(renderer.root)).toContain("Duplicate merged successfully");
});

test("preview for a different pair is rejected", async () => {
  mocks.client.query.mockResolvedValue({
    ...preview,
    snapshotJson: JSON.stringify({
      ...snapshot,
      donor: { ...snapshot.donor, _id: "wrong-id" },
    }),
  });
  await load();
  expect(button("Merge and delete duplicate").props.disabled).toBe(true);
  expect(mocks.client.mutation).not.toHaveBeenCalled();
});

test("private download preserves complete snapshot JSON and fingerprint", async () => {
  await load();
  const createObjectURL = vi.fn().mockReturnValue("blob:preview");
  const click = vi.fn();
  vi.stubGlobal("document", { createElement: () => ({ click }) });
  vi.stubGlobal("window", { setTimeout: vi.fn() });
  const original = URL.createObjectURL;
  URL.createObjectURL = createObjectURL;
  try {
    act(() => button("Download private preview").props.onClick());
    expect(click).toHaveBeenCalledTimes(1);
    const blob = required(createObjectURL.mock.calls[0])[0] as Blob;
    expect(JSON.parse(await blob.text())).toEqual({
      fingerprint: preview.fingerprint,
      snapshotJson: preview.snapshotJson,
    });
  } finally {
    URL.createObjectURL = original;
    vi.unstubAllGlobals();
  }
});
