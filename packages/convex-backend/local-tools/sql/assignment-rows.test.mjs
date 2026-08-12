import assert from "node:assert/strict";
import test from "node:test";

import {
  serializeJsonLines,
  sha256,
  transformAssignmentAudioMessageRow,
  transformAssignmentPointLinkRow,
  transformAssignmentRow,
  transformSyllabusEntryRow,
} from "./assignment-rows.mjs";

const RUN_ID = "synthetic-assignment-run-001";
const ASSIGNMENT_ID =
  "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE1";
const EPISODE_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE2";
const MOVIE_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE3";
const POINT_ID = "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE4";

test("preserves assignment fields and normalizes UUID text", () => {
  const row = transformAssignmentRow(RUN_ID, {
    id: ASSIGNMENT_ID,
    slug: "assignment-one",
    userId: "legacy-user",
    episodeId: EPISODE_ID,
    movieId: MOVIE_ID,
    type: "HOMEWORK",
    playable: true,
  });

  assert.equal(
    row.legacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  );
  assert.equal(
    row.episodeLegacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2",
  );
  assert.equal(row.userLegacyId, "legacy-user");
  assert.equal(row.playable, true);
});

test("converts audio and syllabus timestamps while preserving nulls", () => {
  const audio = transformAssignmentAudioMessageRow(RUN_ID, {
    id: 7,
    url: "https://example.test/audio",
    createdAt: new Date("2024-01-02T03:04:05.000Z"),
    userId: "legacy-user",
    assignmentId: null,
    fileKey: null,
  });
  const syllabus = transformSyllabusEntryRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE5",
    userId: "legacy-user",
    movieId: MOVIE_ID,
    order: 3,
    createdAt: new Date("2024-02-03T04:05:06.000Z"),
    assignmentId: ASSIGNMENT_ID,
    notes: null,
  });

  assert.equal(audio.createdAt, 1_704_164_645_000);
  assert.equal("assignmentLegacyId" in audio, false);
  assert.equal("fileKey" in audio, false);
  assert.equal(
    syllabus.assignmentLegacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
  );
  assert.equal("notes" in syllabus, false);
});

test("preserves every assignment-point relationship", () => {
  const row = transformAssignmentPointLinkRow(RUN_ID, {
    id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEE6",
    assignmentId: ASSIGNMENT_ID,
    userId: "legacy-user",
    pointsId: POINT_ID,
  });

  assert.equal(
    row.pointLegacyId,
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee4",
  );
  assert.equal(row.userLegacyId, "legacy-user");
});

test("serializes deterministic assignment JSON lines", () => {
  const row = transformAssignmentRow(RUN_ID, {
    id: ASSIGNMENT_ID,
    slug: null,
    userId: "legacy-user",
    episodeId: EPISODE_ID,
    movieId: MOVIE_ID,
    type: "HOMEWORK",
    playable: false,
  });
  const jsonl = serializeJsonLines([row]);

  assert.equal(jsonl.endsWith("\n"), true);
  assert.equal(sha256(jsonl).length, 64);
});

test("rejects malformed assignment rows", () => {
  assert.throws(
    () =>
      transformAssignmentRow(RUN_ID, {
        id: "not-a-uuid",
        slug: null,
        userId: "legacy-user",
        episodeId: EPISODE_ID,
        movieId: MOVIE_ID,
        type: "HOMEWORK",
        playable: true,
      }),
    /UUID/u,
  );
  assert.throws(
    () =>
      transformAssignmentRow(RUN_ID, {
        id: ASSIGNMENT_ID,
        slug: null,
        userId: "legacy-user",
        episodeId: EPISODE_ID,
        movieId: MOVIE_ID,
        type: "HOMEWORK",
        playable: 1,
      }),
    /boolean/u,
  );
  assert.throws(
    () =>
      transformAssignmentAudioMessageRow(RUN_ID, {
        id: 2_147_483_648,
        url: "https://example.test/audio",
        createdAt: new Date(),
        userId: "legacy-user",
        assignmentId: null,
        fileKey: null,
      }),
    /SQL int/u,
  );
  assert.throws(
    () =>
      transformSyllabusEntryRow(RUN_ID, {
        id: ASSIGNMENT_ID,
        userId: "legacy-user",
        movieId: MOVIE_ID,
        order: 1,
        createdAt: new Date(Number.NaN),
        assignmentId: null,
        notes: null,
      }),
    /valid Date/u,
  );
});
