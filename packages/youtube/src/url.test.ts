import { describe, expect, test } from "vitest";

import { MAX_CLIP_SECONDS, parseYouTubeUrl, youtubeWatchUrl } from "./url";

describe("YouTube links", () => {
  test("builds watch links that open at the whole second of the start", () => {
    expect(youtubeWatchUrl("abcdefghijk")).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk"
    );
    expect(youtubeWatchUrl("abcdefghijk", 0.9)).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk"
    );
    expect(youtubeWatchUrl("abcdefghijk", 42.9)).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk&t=42s"
    );
  });

  test("reads the video and start from share, watch, embed and Shorts links", () => {
    for (const url of [
      "https://youtu.be/abcdefghijk?t=1m2s",
      "https://www.youtube.com/watch?v=abcdefghijk&t=62",
      "https://m.youtube.com/watch?v=abcdefghijk#t=62s",
      "https://youtube.com/shorts/abcdefghijk?start=62",
      "https://www.youtube-nocookie.com/embed/abcdefghijk?start=62",
    ]) {
      expect(parseYouTubeUrl(url), url).toEqual({
        id: "abcdefghijk",
        start: 62,
      });
    }
    expect(parseYouTubeUrl(" https://youtu.be/abcdefghijk ")).toEqual({
      id: "abcdefghijk",
      start: 0,
    });
    expect(parseYouTubeUrl("https://youtu.be/abcdefghijk?t=1h")).toEqual({
      id: "abcdefghijk",
      start: 3600,
    });
  });

  test("caps the start at a day and reads an unreadable time as zero", () => {
    expect(
      parseYouTubeUrl("https://www.youtube.com/watch?v=abcdefghijk&t=999999")
    ).toEqual({ id: "abcdefghijk", start: MAX_CLIP_SECONDS });
    expect(
      parseYouTubeUrl("https://www.youtube.com/watch?v=abcdefghijk&t=soon")
    ).toEqual({ id: "abcdefghijk", start: 0 });
  });

  test("rejects other hosts, lookalikes, schemes and malformed IDs", () => {
    for (const url of [
      "https://vimeo.com/1",
      "https://youtube.com.evil.test/watch?v=abcdefghijk",
      "https://evil.test/youtube.com/abcdefghijk",
      "javascript:alert(1)",
      "ftp://youtu.be/abcdefghijk",
      "https://youtu.be/too-short",
      "https://www.youtube.com/watch?v=abc$efghijk",
      "https://www.youtube.com/channel/abcdefghijk",
      "not a url",
    ]) {
      expect(parseYouTubeUrl(url), url).toBeNull();
    }
  });
});
