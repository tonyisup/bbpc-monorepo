import { describe, expect, test } from "vitest";

import { formatClipTime, parseClipTime } from "./clipTimes";

describe("clip times", () => {
  test("format as M:SS.s", () => {
    expect(formatClipTime(0)).toBe("0:00.0");
    expect(formatClipTime(65.24)).toBe("1:05.2");
    expect(formatClipTime(59.96)).toBe("1:00.0");
    expect(formatClipTime(3725)).toBe("62:05.0");
    expect(formatClipTime(-1)).toBe("0:00.0");
  });

  test("read seconds, M:SS.s and H:MM:SS.s to the tenth", () => {
    expect(parseClipTime("")).toBeNull();
    expect(parseClipTime(" 65.25 ")).toBe(65.3);
    expect(parseClipTime("1:05.2")).toBe(65.2);
    expect(parseClipTime("1:02:05")).toBe(3725);
    expect(parseClipTime(formatClipTime(65.2))).toBe(65.2);
  });

  test("reject anything else as NaN", () => {
    for (const bad of ["1:5x", "1:60", "1.5:05", "::", "-3", "1:2:3:4"]) {
      expect(parseClipTime(bad), bad).toBeNaN();
    }
  });
});
