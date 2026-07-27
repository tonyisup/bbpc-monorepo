import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeRecordingCatalogs,
  publicRecordingCatalogRowsFromArchive,
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

test("reconstructs retired public catalog query ordering from archive rows", () => {
  const publicRows =
    publicRecordingCatalogRowsFromArchive({
      sounders: [
        {
          sounderId: "later",
          blobName: "later.mp3",
          name: "Later",
          category: "B",
          url: "https://example.com/later.mp3",
          duration: 2,
          size: 2,
          contentType: "audio/mpeg",
          sortOrder: 2,
        },
        {
          sounderId: "first",
          blobName: "first.mp3",
          name: "First",
          category: "A",
          url: "https://example.com/first.mp3",
          duration: 1,
          size: 1,
          contentType: "audio/mpeg",
          sortOrder: 1,
        },
      ],
      templates: [
        {
          _creationTime: 20,
          templateId: "second",
          label: "Second",
          type: "outro",
          sortOrder: 1,
        },
        {
          _creationTime: 10,
          templateId: "first",
          label: "First",
          type: "intro",
          sortOrder: 1,
        },
      ],
    });

  assert.deepEqual(
    publicRows.sounders.map((sounder) => sounder.id),
    ["first", "later"],
  );
  assert.deepEqual(
    publicRows.templates.map((template) => template.id),
    ["first", "second"],
  );
});
