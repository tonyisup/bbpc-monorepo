import test from "node:test";
import assert from "node:assert/strict";
import { blobDate, normalizedTitle, parseSourceTitle, planArchiveBackfill, azurePrefix } from "./archive-backfill.mjs";

const episode = (extra = {}) => ({ id: "episode-a", number: 42, title: "Cálmate!", date: "2020-01-02", recording: null,
  status: "published", slug: "episode-42-calmate", description: null, ...extra });
const blob = (extra = {}) => ({ name: "20200101.mp3", size: 12000, etag: "etag-a",
  tags: { status: "read", number: 42, title: "Calmate" }, ...extra });
const source = (extra = {}) => ({ title: "42 - Calmate", url: "https://soundcloud.com/show/42-calmate", audioHeaders: { bytes: 12000 }, ...extra });
const plan = (extra = {}) => planArchiveBackfill({ episodes: [episode()], blobs: [blob()], sources: [source()], asOf: "2026-09-17", ...extra });

test("normalization keeps words while accommodating accents and punctuation", () => {
  assert.equal(normalizedTitle("Cálmate!"), "calmate");
  assert.equal(blobDate("20200230.mp3"), null);
  assert.equal(blobDate("20200229-Extra.mp3"), "2020-02-29");
  assert.equal(blobDate("archive.mp3"), null);
  assert.deepEqual(parseSourceTitle("Episode 166 - Live"), { number: 166, title: "Live" });
  assert.deepEqual(parseSourceTitle("336.5 - Special"), { number: 336.5, title: "Special" });
});
test("exact identity proposes only the recording field and preserves the snapshot", () => {
  const result = plan();
  assert.equal(result.dryRun, true);
  assert.equal(result.updates[0].status, "ready_update");
  assert.equal(result.updates[0].action.recording, azurePrefix + "20200101.mp3");
  assert.equal(result.updates[0].action.oldRecording, null);
  assert.equal(result.updates[0].action.type, "update_recording_only");
  assert.deepEqual(result.updates[0].episode, episode());
});
test("number alone, date alone and byte length alone never qualify", () => {
  const result = plan({ episodes: [episode({ title: "Unrelated title", date: "2020-01-01", recording: source().url })] });
  assert.equal(result.updates[0].status, "review");
  assert.equal(result.updates[0].action, null);
  assert.equal(result.updates[0].candidates.length, 1);
});
test("duplicate website identity and duplicate Azure identity require review", () => {
  assert.ok(plan({ episodes: [episode(), episode({ id: "episode-b" })] }).updates.every(r => r.status === "review"));
  assert.equal(plan({ blobs: [blob(), blob({ name: "20200101-part2.mp3" })] }).updates[0].status, "review");
});
test("pre-existing recording claim blocks a second row from claiming the same blob", () => {
  const result = plan({ episodes: [episode(), episode({ id: "other", number: 43, title: "Other", recording: azurePrefix + "20200101.mp3" })] });
  assert.equal(result.updates[0].status, "review");
  assert.equal(result.updates[0].action, null);
});
test("unpublished, future, conflicting date and third-party recordings are not changed", () => {
  assert.equal(plan({ episodes: [episode({ status: "next" })] }).updates[0].status, "excluded_unpublished");
  assert.equal(plan({ episodes: [episode({ date: "2027-01-01" })] }).updates[0].status, "excluded_unpublished");
  assert.equal(plan({ episodes: [episode({ date: "2019-01-01" })] }).updates[0].status, "review");
  assert.equal(plan({ episodes: [episode({ recording: "https://example.org/special.mp3" })] }).updates[0].status, "review");
});
test("an existing Azure recording is retained, not replaced on metadata assumptions", () => {
  assert.equal(plan({ episodes: [episode({ recording: azurePrefix + "20200101.mp3" })] }).updates[0].status, "already_azure");
});
test("creates require no existing episode number and unique independent corroboration", () => {
  const result = plan({ episodes: [episode({ number: 40, title: "Other" })] });
  assert.equal(result.creates[0].status, "ready_create");
  assert.equal(result.creates[0].proposed.date, "2020-01-01");
  assert.equal(plan().creates.length, 0);
  assert.equal(plan({ episodes: [episode({ number: 40, title: "Other" })], sources: [source({ title: "42 - Different" })] }).creates[0].status, "review");
});
test("different byte lengths and source duplicates keep new listings in review", () => {
  assert.equal(plan({ episodes: [episode({ number: 40, title: "Other" })], sources: [source({ audioHeaders: { bytes: 11999 } })] }).creates[0].status, "review");
  assert.equal(plan({ episodes: [episode({ number: 40, title: "Other" })], sources: [source(), source()] }).creates[0].status, "review");
});
test("split recordings and title collisions cannot become ready creates", () => {
  assert.equal(plan({ episodes: [episode({ number: 40 })] }).creates[0].status, "review");
  assert.equal(plan({ episodes: [episode({ number: 40, title: "Other" })], blobs: [blob({ tags: { number: 42, title: "Show Part 1" } })], sources: [source({ title: "42 - Show Part 1" })] }).creates[0].status, "review");
});
test("invalid or duplicate inventories fail closed", () => {
  assert.throws(() => plan({ episodes: [episode(), episode()] }), /duplicate episode/);
  assert.throws(() => plan({ blobs: [blob(), blob()] }), /duplicate Azure/);
  assert.throws(() => plan({ blobs: [blob({ size: 0 })] }), /Invalid/);
});
