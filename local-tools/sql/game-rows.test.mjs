import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeJsonLines,
  sha256,
  transformGamePointTypeRow,
  transformGameTypeRow,
  transformGamblingEntryRow,
  transformGamblingTypeRow,
  transformGuessRow,
  transformPointRow,
  transformQuoteSubmissionRow,
  transformSeasonRow,
  transformTagVoteRow,
} from "./game-rows.mjs";

const RUN_ID = "synthetic-game-run-001";
const UUIDS = Array.from(
  { length: 12 },
  (_, index) =>
    `AAAAAAAA-BBBB-CCCC-DDDD-${String(index + 1).padStart(12, "0")}`,
);
const [
  SEASON_ID,
  POINT_ID,
  RATING_ID,
  ASSIGNMENT_REVIEW_ID,
  GUESS_ID,
  GAMBLING_TYPE_ID,
  GAMBLING_ENTRY_ID,
  ASSIGNMENT_ID,
  TAG_VOTE_ID,
  QUOTE_ID,
  EPISODE_ID,
  DANGLING_POINT_ID,
] = UUIDS;
const INSTANT = new Date("2025-01-02T03:04:05.000Z");

test("transforms game foundation rows without collapsing null adjustment", () => {
  const gameType = transformGameTypeRow(RUN_ID, {
    id: 1,
    title: "Prediction",
    description: null,
    lookupID: "prediction",
  });
  const pointType = transformGamePointTypeRow(RUN_ID, {
    id: 2,
    lookupID: "correct",
    title: "Correct",
    description: "Correct prediction",
    points: 5,
    gameTypeId: 1,
  });
  const season = transformSeasonRow(RUN_ID, {
    id: SEASON_ID,
    title: "Season",
    description: null,
    gameTypeId: 1,
    endedOn: null,
    startedOn: new Date("2025-01-01T00:00:00.000Z"),
  });
  const point = transformPointRow(RUN_ID, {
    id: POINT_ID,
    userId: "legacy-user",
    seasonId: SEASON_ID,
    reason: null,
    earnedOn: INSTANT,
    adjustment: null,
    gamePointTypeId: null,
  });

  assert.equal(gameType.legacyId, 1);
  assert.equal("description" in gameType, false);
  assert.equal(pointType.gameTypeLegacyId, 1);
  assert.equal(season.startedOn, "2025-01-01");
  assert.equal("endedOn" in season, false);
  assert.equal(point.adjustment, null);
  assert.equal("gamePointTypeLegacyId" in point, false);
  assert.equal(point.earnedAt, INSTANT.getTime());
});

test("transforms pending and awarded guesses", () => {
  const pending = transformGuessRow(RUN_ID, {
    id: GUESS_ID,
    ratingId: RATING_ID,
    created: INSTANT,
    userId: "legacy-user",
    assignmntReviewId: ASSIGNMENT_REVIEW_ID,
    seasonId: SEASON_ID,
    pointsId: null,
  });
  const awarded = transformGuessRow(RUN_ID, {
    id: UUIDS[11],
    ratingId: RATING_ID,
    created: INSTANT,
    userId: "legacy-user",
    assignmntReviewId: ASSIGNMENT_REVIEW_ID,
    seasonId: SEASON_ID,
    pointsId: POINT_ID,
  });

  assert.equal("pointLegacyId" in pending, false);
  assert.equal(
    awarded.pointLegacyId,
    POINT_ID.toLowerCase(),
  );
});

test("preserves gambling relationships and nullable fields", () => {
  const gamblingType = transformGamblingTypeRow(RUN_ID, {
    id: GAMBLING_TYPE_ID,
    lookupId: "special",
    title: "Special",
    description: null,
    multiplier: 1.5,
    isActive: true,
    createdAt: INSTANT,
  });
  const entry = transformGamblingEntryRow(RUN_ID, {
    id: GAMBLING_ENTRY_ID,
    userId: "legacy-user",
    assignmentId: ASSIGNMENT_ID,
    points: -10,
    createdAt: INSTANT,
    pointsId: null,
    seasonId: SEASON_ID,
    notes: null,
    gamblingTypeId: GAMBLING_TYPE_ID,
    targetUserId: "target-user",
    status: "pending",
  });

  assert.equal(gamblingType.multiplier, 1.5);
  assert.equal(gamblingType.isActive, true);
  assert.equal(
    entry.assignmentLegacyId,
    ASSIGNMENT_ID.toLowerCase(),
  );
  assert.equal("pointLegacyId" in entry, false);
  assert.equal(entry.targetUserLegacyId, "target-user");
});

test("preserves tag-vote award UUIDs without requiring a point match", () => {
  const row = transformTagVoteRow(RUN_ID, {
    id: TAG_VOTE_ID,
    tag: "Sci-Fi",
    tmdbId: 101,
    isTag: null,
    createdAt: INSTANT,
    sessionId: null,
    userId: null,
    pointId: DANGLING_POINT_ID,
  });

  assert.equal(
    row.pointLegacyId,
    DANGLING_POINT_ID.toLowerCase(),
  );
  assert.equal("isTag" in row, false);
  assert.equal("userLegacyId" in row, false);
});

test("transforms all quote fields and deterministic JSON lines", () => {
  const row = transformQuoteSubmissionRow(RUN_ID, {
    id: QUOTE_ID,
    userId: "legacy-user",
    episodeId: EPISODE_ID,
    seasonId: SEASON_ID,
    quoteText: "A synthetic quote",
    sourceTitle: "Movie",
    sourceType: "MOVIE",
    clipUrl: "https://example.test/clip",
    clipStartSeconds: 12,
    listenerNotes: "Listener",
    status: "INCLUDED",
    bracketOrder: 2,
    placement: 1,
    adminNotes: "Admin",
    pointId: POINT_ID,
    createdAt: INSTANT,
    updatedAt: INSTANT,
  });
  const jsonl = serializeJsonLines([row]);

  assert.equal(row.placement, 1);
  assert.equal(row.pointLegacyId, POINT_ID.toLowerCase());
  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(sha256(jsonl).length, 64);
});

test("rejects malformed game values at the extractor boundary", () => {
  assert.throws(
    () =>
      transformGameTypeRow(RUN_ID, {
        id: 256,
        title: "Game",
        description: null,
        lookupID: "game",
      }),
    /tinyint/u,
  );
  assert.throws(
    () =>
      transformGamePointTypeRow(RUN_ID, {
        id: 1,
        lookupID: "point",
        title: "Point",
        description: null,
        points: 32_768,
        gameTypeId: 1,
      }),
    /smallint/u,
  );
  assert.throws(
    () =>
      transformGamblingTypeRow(RUN_ID, {
        id: GAMBLING_TYPE_ID,
        lookupId: "type",
        title: "Type",
        description: null,
        multiplier: Number.NaN,
        isActive: true,
        createdAt: INSTANT,
      }),
    /finite/u,
  );
  assert.throws(
    () =>
      transformTagVoteRow(RUN_ID, {
        id: TAG_VOTE_ID,
        tag: "Tag",
        tmdbId: 2_147_483_648,
        isTag: null,
        createdAt: INSTANT,
        sessionId: null,
        userId: null,
        pointId: null,
      }),
    /SQL int/u,
  );
  assert.throws(
    () =>
      transformQuoteSubmissionRow(RUN_ID, {
        id: QUOTE_ID,
        userId: "legacy-user",
        episodeId: EPISODE_ID,
        seasonId: SEASON_ID,
        quoteText: "Quote",
        sourceTitle: "Movie",
        sourceType: "INVALID",
        clipUrl: null,
        clipStartSeconds: null,
        listenerNotes: null,
        status: "SUBMITTED",
        bracketOrder: null,
        placement: null,
        adminNotes: null,
        pointId: null,
        createdAt: INSTANT,
        updatedAt: INSTANT,
      }),
    /sourceType/u,
  );
});

test("rejects every quote check-constraint violation", () => {
  const base = {
    id: QUOTE_ID,
    userId: "legacy-user",
    episodeId: EPISODE_ID,
    seasonId: SEASON_ID,
    quoteText: "Quote",
    sourceTitle: "Movie",
    sourceType: "OTHER",
    clipUrl: null,
    clipStartSeconds: null,
    listenerNotes: null,
    status: "REJECTED",
    bracketOrder: null,
    placement: null,
    adminNotes: null,
    pointId: null,
    createdAt: INSTANT,
    updatedAt: INSTANT,
  };

  assert.throws(
    () =>
      transformQuoteSubmissionRow(RUN_ID, {
        ...base,
        status: "INVALID",
      }),
    /status/u,
  );
  assert.throws(
    () =>
      transformQuoteSubmissionRow(RUN_ID, {
        ...base,
        clipStartSeconds: -1,
      }),
    /clipStartSeconds/u,
  );
  assert.throws(
    () =>
      transformQuoteSubmissionRow(RUN_ID, {
        ...base,
        placement: 4,
      }),
    /placement/u,
  );
});
