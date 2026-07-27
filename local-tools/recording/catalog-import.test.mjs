import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeRecordingCatalogs,
  recordingCatalogDigest,
  recordingCatalogImportPayload,
} from "./catalog-import.mjs";

const rawSounders = [
  {
    id: " sounder-one ",
    blobName: " Soundboard/one.mp3 ",
    name: " One ",
    category: " Soundboard ",
    url: "/api/sounders/play?path=Soundboard%2Fone.mp3",
    duration: 100,
    size: 1_024,
    contentType: " audio/mpeg ",
  },
];
const rawTemplates = [
  {
    id: " segment_one ",
    label: " Segment One ",
    type: "segment",
    introSounder: " Soundboard/one.mp3 ",
  },
];

test("normalizes recording catalogs and builds a stable import payload", () => {
  const catalogs = canonicalizeRecordingCatalogs(
    rawSounders,
    rawTemplates,
  );
  assert.deepEqual(catalogs, {
    sounders: [
      {
        id: "sounder-one",
        blobName: "Soundboard/one.mp3",
        name: "One",
        category: "Soundboard",
        url: "/api/sounders/play?path=Soundboard%2Fone.mp3",
        duration: 100,
        size: 1_024,
        contentType: "audio/mpeg",
        sortOrder: 0,
      },
    ],
    templates: [
      {
        id: "segment_one",
        label: "Segment One",
        type: "segment",
        introSounder: "Soundboard/one.mp3",
        sortOrder: 0,
      },
    ],
  });
  const payload = recordingCatalogImportPayload(catalogs, 1_000);
  assert.equal(payload.sourceObservedAt, 1_000);
  assert.match(payload.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    payload.sourceDigest,
    recordingCatalogDigest(catalogs),
  );
  assert.equal(
    Object.hasOwn(payload.sounders[0], "sortOrder"),
    false,
  );
});

test("rejects duplicate keys and unsafe catalog values", () => {
  assert.throws(() =>
    canonicalizeRecordingCatalogs(
      [rawSounders[0], rawSounders[0]],
      rawTemplates,
    ),
  );
  assert.throws(() =>
    canonicalizeRecordingCatalogs(
      [
        {
          ...rawSounders[0],
          blobName: "Soundboard/\u0000one.mp3",
        },
      ],
      rawTemplates,
    ),
  );
  assert.throws(() =>
    canonicalizeRecordingCatalogs(
      rawSounders,
      [{ ...rawTemplates[0], type: "invalid" }],
    ),
  );
});
