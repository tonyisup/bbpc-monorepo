import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";

import {
  requireFileSize,
  requireOptionalSounderId,
  requireRecordingSounder,
  requireRecordingUrl,
  requireSortOrder,
} from "./recording/catalogModel.js";
import {
  requireBoundedPayload,
  requireCapabilityToken,
  requireDisplayName,
  requireEpisodeLabel,
  requirePortableId,
  requireRecordingTimestamp,
} from "./recording/validators.js";

function expectValidationError(operation: () => unknown): void {
  try {
    operation();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ConvexError);
    if (!(error instanceof ConvexError)) {
      throw error;
    }
    expect(error.data).toMatchObject({
      code: "VALIDATION_FAILED",
    });
    return;
  }
  throw new Error("Expected validation failure.");
}

describe("recording boundary validation", () => {
  test("accepts normalized identifiers and rejects malformed identifiers", () => {
    expect(requirePortableId(" session_01 ", "Session")).toBe(
      "session_01",
    );
    expect(
      requireCapabilityToken(
        " token_abcdefghijklmnopqrstuvwxyz ",
        "Token",
      ),
    ).toBe("token_abcdefghijklmnopqrstuvwxyz");
    expect(requireDisplayName("  Recording   Host  ")).toBe(
      "Recording Host",
    );
    expect(requireEpisodeLabel(" EP-42 ")).toBe("EP-42");

    expectValidationError(() =>
      requirePortableId("bad identifier", "Session"),
    );
    expectValidationError(() =>
      requireCapabilityToken("too_short", "Token"),
    );
    expectValidationError(() => requireDisplayName("Host\u0000Name"));
    expectValidationError(() => requireEpisodeLabel("   "));
  });

  test("rejects invalid timestamps and payloads", () => {
    expect(requireRecordingTimestamp(1_000, "Timestamp")).toBe(
      1_000,
    );
    expectValidationError(() =>
      requireRecordingTimestamp(-1, "Timestamp"),
    );
    expectValidationError(() =>
      requireRecordingTimestamp(1.5, "Timestamp"),
    );
    expectValidationError(() => {
      requireBoundedPayload(
        { value: "x".repeat(20) },
        "Payload",
        10,
      );
    });

    const circular: { self?: unknown } = {};
    circular.self = circular;
    expectValidationError(() => {
      requireBoundedPayload(circular, "Payload", 100);
    });
  });

  test("accepts safe recording URLs and rejects unsafe schemes", () => {
    expect(requireRecordingUrl("/sounders/one.mp3", "URL")).toBe(
      "/sounders/one.mp3",
    );
    expect(
      requireRecordingUrl("https://audio.example.test/one.mp3", "URL"),
    ).toBe("https://audio.example.test/one.mp3");

    expectValidationError(() => requireRecordingUrl("//host/path", "URL"));
    expectValidationError(() =>
      requireRecordingUrl("/bad\u0000path", "URL"),
    );
    expectValidationError(() =>
      requireRecordingUrl("not a URL", "URL"),
    );
    expectValidationError(() =>
      requireRecordingUrl("http://audio.example.test/one.mp3", "URL"),
    );
  });

  test("validates recording catalog limits", () => {
    expect(
      requireRecordingSounder({
        id: "sounder_01",
        name: " Intro ",
        category: " Drops ",
        duration: 0,
        url: "/intro.mp3",
      }),
    ).toMatchObject({
      sounderId: "sounder_01",
      name: "Intro",
      category: "Drops",
      duration: 0,
    });
    expect(requireFileSize(0)).toBe(0);
    expect(requireSortOrder(10_000)).toBe(10_000);
    expect(requireOptionalSounderId(undefined)).toBeUndefined();
    expect(requireOptionalSounderId("sounder_01")).toBe("sounder_01");

    expectValidationError(() =>
      requireRecordingSounder({
        id: "sounder_01",
        name: "Intro",
        category: "Drops",
        duration: -1,
        url: "/intro.mp3",
      }),
    );
    expectValidationError(() => requireFileSize(-1));
    expectValidationError(() => requireSortOrder(10_001));
  });
});
