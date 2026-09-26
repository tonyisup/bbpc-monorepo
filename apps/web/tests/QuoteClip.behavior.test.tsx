import { describe, expect, test } from "vitest";
import {
  formatClipTime,
  parseYouTubeUrl,
  parseCaptions,
  selectCueRange,
  validClipRange,
} from "@/lib/quoteClip";

function timestamp(seconds: number) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(
    Math.floor(seconds / 60) % 60
  )}:${pad(seconds % 60)}.000`;
}

describe("quote clip sources and timing", () => {
  test("accepts YouTube share, watch and Shorts URLs without trusting lookalike hosts", () => {
    for (const url of [
      "https://youtu.be/abcdefghijk?t=1m2s",
      "https://www.youtube.com/watch?v=abcdefghijk&t=62",
      "https://youtube.com/shorts/abcdefghijk?start=62",
    ]) {
      expect(parseYouTubeUrl(url)).toEqual({ id: "abcdefghijk", start: 62 });
    }
    for (const url of [
      "https://youtube.com.evil.test/watch?v=abcdefghijk",
      "https://evil.test/youtube.com/abcdefghijk",
      "javascript:alert(1)",
      "https://youtu.be/too-short",
    ])
      expect(parseYouTubeUrl(url)).toBeNull();
  });

  test("preserves subtitle phrases and actual inline word timings", () => {
    expect(
      parseCaptions(
        "1\r\n00:00:10,125 --> 00:00:12,500\r\nHello &amp; goodbye."
      )
    ).toEqual([{ start: 10.125, end: 12.5, text: "Hello & goodbye." }]);
    const cues = parseCaptions(
      "WEBVTT\n\n00:00:12.000 --> 00:00:15.000 align:start\n<v Speaker>You <00:00:12.500>can <00:00:13.000>do <00:00:14.000>this.</v>"
    );
    expect(cues).toEqual([
      { start: 12, end: 12.5, text: "You" },
      { start: 12.5, end: 13, text: "can" },
      { start: 13, end: 14, text: "do" },
      { start: 14, end: 15, text: "this." },
    ]);
    expect(selectCueRange(cues, 3, 1)).toEqual({
      start: 12.5,
      end: 15,
      text: "can do this.",
    });
  });

  test("rejects untimed, reversed and out-of-cue timestamps rather than guessing", () => {
    for (const text of [
      "A quote without timestamps",
      "00:00:05.000 --> 00:00:02.000\nNo",
      "00:00:01.000 --> 00:00:02.000\nA <00:00:03.000>B",
      "00:65:00.000 --> 00:66:00.000\nNo",
    ])
      expect(() => parseCaptions(text)).toThrow();
    expect(validClipRange(42.125, 45.9)).toBe(true);
    for (const [start, end] of [
      [null, 3],
      [5, 5],
      [6, 5],
      [NaN, 7],
      [3, Infinity],
      [-1, 3],
      [0, 86401],
    ])
      expect(validClipRange(start!, end!)).toBe(false);
  });

  test("reads embed, live, mobile and privacy hosts with every supported time form, clamped to 24 hours", () => {
    const cases: Array<[string, { id: string; start: number } | null]> = [
      [
        "https://m.youtube.com/watch?v=abcdefghijk#t=1h2m3.5s",
        { id: "abcdefghijk", start: 3723.5 },
      ],
      [
        "https://www.youtube-nocookie.com/embed/abcdefghijk?start=12.5",
        { id: "abcdefghijk", start: 12.5 },
      ],
      ["https://youtube.com/live/abcdefghijk", { id: "abcdefghijk", start: 0 }],
      ["http://youtu.be/abcdefghijk?t=30h", { id: "abcdefghijk", start: 86_400 }],
      ["https://youtu.be/abcdefghijk?t=soon", { id: "abcdefghijk", start: 0 }],
      ["https://youtube.com/watch?list=abc", null],
      ["https://youtube.com/embed/", null],
      ["https://youtube.com/channel/abcdefghijk", null],
      ["ftp://youtu.be/abcdefghijk", null],
      ["not a link", null],
    ];
    for (const [url, expected] of cases)
      expect(parseYouTubeUrl(url), url).toEqual(expected);
  });

  test("formats clip times to tenths without negative or overflowing seconds", () => {
    expect(formatClipTime(0)).toBe("0:00.0");
    expect(formatClipTime(62.25)).toBe("1:02.3");
    expect(formatClipTime(59.96)).toBe("1:00.0");
    expect(formatClipTime(-3)).toBe("0:00.0");
    expect(formatClipTime(3723.5)).toBe("62:03.5");
  });

  test("skips headers, notes and empty cues, reads minute-only stamps and sorts, but refuses oversized or unreadable input", () => {
    expect(
      parseCaptions(
        [
          "﻿WEBVTT",
          "NOTE a comment --> that looks timed",
          "STYLE\n::cue { color: red }",
          "00:20.000 --> 00:22.000\nLater&nbsp;line",
          "00:01.000 --> 00:02.000\n<b></b>",
          "00:12.000 --> 00:14.500\n<i>Earlier</i> line",
        ].join("\n\n")
      )
    ).toEqual([
      { start: 12, end: 14.5, text: "Earlier line" },
      { start: 20, end: 22, text: "Later line" },
    ]);
    expect(() => parseCaptions("x".repeat(500_001))).toThrow("500 KB");
    expect(() =>
      parseCaptions("00:00:01.000-->00:00:02.000\nNo spaces")
    ).toThrow("could not be read");
    const tooMany = Array.from(
      { length: 10_001 },
      (_, index) => `${timestamp(index)} --> ${timestamp(index + 1)}\na`
    ).join("\n\n");
    expect(tooMany.length).toBeLessThan(500_000);
    expect(() => parseCaptions(tooMany)).toThrow("10,000");
  });
});
