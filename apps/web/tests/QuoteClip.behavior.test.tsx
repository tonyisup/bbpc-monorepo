import { describe, expect, test } from "vitest";
import {
  parseYouTubeUrl,
  parseCaptions,
  selectCueRange,
  validClipRange,
} from "@/lib/quoteClip";

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
});
