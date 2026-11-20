import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, test } from "vitest";

import Loading from "@/app/loading";
import { LoadingIndicator } from "@/components/LoadingIndicator";

let renderer: ReactTestRenderer | null = null;

function renderElement(element: JSX.Element) {
  act(() => {
    renderer = create(element);
  });
  if (renderer === null) {
    throw new Error("Component did not render.");
  }
  return renderer;
}

describe("LoadingIndicator and root route loading", () => {
  afterEach(() => {
    if (renderer !== null) {
      act(() => renderer?.unmount());
      renderer = null;
    }
  });

  test("root loading page renders an accessible page-level indicator with shimmer rail and waveform", () => {
    const rendered = renderElement(<Loading />);
    const status = rendered.root.findByProps({ role: "status" });

    expect(status.props["aria-live"]).toBe("polite");
    expect(status.props["aria-label"]).toBe("Loading");

    const sweep = rendered.root.findAll(
      (node) =>
        typeof node.props.className === "string" &&
        node.props.className.includes("bbpc-loading-sweep")
    );
    expect(sweep).toHaveLength(1);

    const bars = rendered.root.findAll(
      (node) =>
        typeof node.props.className === "string" &&
        node.props.className.includes("bbpc-wave-bar")
    );
    expect(bars).toHaveLength(5);
    expect(JSON.stringify(rendered.toJSON())).not.toContain("Loading...");
  });

  test("section variant renders a custom label without the page top rail", () => {
    const rendered = renderElement(
      <LoadingIndicator variant="section" label="Loading archive" />
    );
    const status = rendered.root.findByProps({ role: "status" });

    expect(status.props["aria-label"]).toBe("Loading archive");
    expect(
      rendered.root.findAll(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("bbpc-loading-sweep")
      )
    ).toHaveLength(0);
    expect(
      rendered.root.findAll(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("bbpc-wave-bar")
      )
    ).toHaveLength(5);
    expect(JSON.stringify(rendered.toJSON())).toContain("Loading archive");
  });

  test("compact variant renders an inline waveform with accessible status", () => {
    const rendered = renderElement(
      <LoadingIndicator variant="compact" label="Searching episodes" />
    );
    const status = rendered.root.findByProps({ role: "status" });

    expect(status.props["aria-label"]).toBe("Searching episodes");
    expect(status.props.className).toContain("inline-flex");
    expect(
      rendered.root.findAll(
        (node) =>
          typeof node.props.className === "string" &&
          node.props.className.includes("bbpc-wave-bar")
      )
    ).toHaveLength(5);
  });
});
