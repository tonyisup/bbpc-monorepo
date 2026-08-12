import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeJsonLines,
  sha256,
  transformAssignmentReviewRow,
  transformExtraReviewRow,
  transformRatingRow,
  transformReviewRow,
} from "./review-rows.mjs";

const RUN_ID = "synthetic-review-run-001";
const MOVIE_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE1";
const SHOW_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE2";
const RATING_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE3";
const REVIEW_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE4";
const ASSIGNMENT_ID =
  "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE5";
const EPISODE_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE6";

test("preserves rating metadata and SQL tinyint values", () => {
  const row = transformRatingRow(RUN_ID, {
    id: RATING_ID,
    name: "Excellent",
    value: 5,
    sound: "https://example.test/rating.mp3",
    icon: "star",
    category: "positive",
  });

  assert.equal(
    row.legacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee3",
  );
  assert.equal(row.value, 5);
  assert.equal(row.icon, "star");
});

test("preserves both source review timestamps separately", () => {
  const instant = new Date("2024-01-02T03:04:05.000Z");
  const row = transformReviewRow(RUN_ID, {
    id: REVIEW_ID,
    userId: "legacy-user",
    movieId: MOVIE_ID,
    ratingId: RATING_ID,
    reviewdOn: instant,
    showId: null,
    reviewedOn: instant,
  });

  assert.equal(row.reviewdOn, 1_704_164_645_000);
  assert.equal(row.reviewedOn, 1_704_164_645_000);
  assert.equal(
    row.movieLegacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  );
  assert.equal("showLegacyId" in row, false);
});

test("preserves assignment and extra review relationships", () => {
  const assignmentReview = transformAssignmentReviewRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE7",
    assignmentId: ASSIGNMENT_ID,
    reviewId: REVIEW_ID,
  });
  const extraReview = transformExtraReviewRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE8",
    reviewId: REVIEW_ID,
    episodeId: EPISODE_ID,
  });

  assert.equal(
    assignmentReview.assignmentLegacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee5",
  );
  assert.equal(
    extraReview.episodeLegacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee6",
  );
});

test("serializes deterministic review JSON lines", () => {
  const row = transformReviewRow(RUN_ID, {
    id: REVIEW_ID,
    userId: null,
    movieId: null,
    ratingId: null,
    reviewdOn: null,
    showId: SHOW_ID,
    reviewedOn: null,
  });
  const jsonl = serializeJsonLines([row]);

  assert.equal("userLegacyId" in row, false);
  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(sha256(jsonl).length, 64);
});

test("rejects malformed review rows", () => {
  assert.throws(
    () =>
      transformRatingRow(RUN_ID, {
        id: RATING_ID,
        name: "Invalid",
        value: 256,
        sound: null,
        icon: null,
        category: null,
      }),
    /tinyint/u,
  );
  assert.throws(
    () =>
      transformReviewRow(RUN_ID, {
        id: REVIEW_ID,
        userId: null,
        movieId: MOVIE_ID,
        ratingId: null,
        reviewdOn: new Date(Number.NaN),
        showId: null,
        reviewedOn: null,
      }),
    /valid Date/u,
  );
  assert.throws(
    () =>
      transformReviewRow(RUN_ID, {
        id: REVIEW_ID,
        userId: null,
        movieId: MOVIE_ID,
        ratingId: null,
        reviewdOn: null,
        showId: SHOW_ID,
        reviewedOn: null,
      }),
    /exactly one/u,
  );
});
