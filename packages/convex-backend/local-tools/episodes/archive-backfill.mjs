import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, URL } from "node:url";
import { parseArgs } from "node:util";
import process from "node:process";
import console from "node:console";

// Offline planning only: this module has no network client, mutations or apply mode.
export const azurePrefix = "https://bbpc.blob.core.windows.net/episodes/";
export function normalizedTitle(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function group(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = key(row);
    if (value == null || value === "") continue;
    result.set(value, [...(result.get(value) ?? []), row]);
  }
  return result;
}
export function blobDate(name) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:[.-])/.exec(name);
  if (!match) return null;
  const value = `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function parseSourceTitle(title) {
  const match = /^(?:Episode\s+)?(\d+(?:\.\d+)?)\s*(?:[-–—:]\s*|\s+)(.+)$/i.exec(title);
  return match ? { number: Number(match[1]), title: match[2] } : { number: null, title };
}
function canonicalUrl(value) {
  try { const u = new URL(value); return u.origin + u.pathname.replace(/\/$/, ""); }
  catch { return null; }
}
function snapshot(episode) {
  return Object.fromEntries(["id", "number", "title", "recording", "date", "description", "status", "slug"].map(key => [key, episode[key] ?? null]));
}
function publicBlob(blob) {
  return { name: blob.name, url: azurePrefix + encodeURIComponent(blob.name).replace(/%2F/g, "/"),
    size: blob.size, etag: blob.etag, number: blob.number, title: blob.title, date: blob.date };
}
function validate(episodes, blobs) {
  if (!Array.isArray(episodes) || !episodes.length || episodes.length > 1200 ||
      episodes.some(e => typeof e.id !== "string" || !e.id || !Number.isFinite(e.number) || typeof e.title !== "string" ||
        (e.date != null && !validDate(e.date))) ||
      new Set(episodes.map(e => e.id)).size !== episodes.length)
    throw new Error("Invalid or duplicate episode inventory; refusing a partial plan.");
  if (!Array.isArray(blobs) || !blobs.length || blobs.length > 2000 ||
      blobs.some(b => typeof b.name !== "string" || !b.name.endsWith(".mp3") || b.name.includes("..") ||
        !Number.isSafeInteger(b.size) || b.size <= 0 || typeof b.etag !== "string" || !b.etag) ||
      new Set(blobs.map(b => b.name)).size !== blobs.length)
    throw new Error("Invalid or duplicate Azure inventory.");
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Corroborate recordings conservatively; number-only/date-only matches never become ready. */
export function planArchiveBackfill({ episodes, blobs, sources, asOf }) {
  validate(episodes, blobs);
  if (!validDate(asOf) || !Array.isArray(sources) || !sources.length || sources.some(s => typeof s.title !== "string"))
    throw new Error("A dated source inventory is required.");
  const media = blobs.map(b => ({ ...b,
    number: Number.isFinite(Number(b.tags?.number)) && b.tags?.number != null && b.tags?.number !== "" ? Number(b.tags.number) : null,
    title: b.tags?.title ?? "", date: blobDate(b.name) }));
  const byNumber = group(media, b => b.number);
  const byDate = group(media, b => b.date);
  const byTitle = group(media, b => normalizedTitle(b.title));
  const bySize = group(media, b => b.size);
  const byUrl = group(media, b => publicBlob(b).url);
  const sourceRows = sources.map(s => ({ ...s, parsed: parseSourceTitle(s.title),
    bytes: Number(s.audioHeaders?.bytes ?? s.audio?.length ?? 0) }));
  const sourcesByUrl = group(sourceRows, s => canonicalUrl(s.url));
  const sourcesByNumber = group(sourceRows, s => s.parsed.number);
  const episodesByNumber = group(episodes, e => e.number);
  const episodesByTitle = group(episodes, e => normalizedTitle(e.title));
  const rows = [];

  for (const episode of episodes) {
    const expected = snapshot(episode);
    const row = { episode: expected, expectedFingerprint: fingerprint(expected),
      status: "review", action: null, reasons: [], candidates: [] };
    if (episode.status?.toLowerCase() !== "published" || (episode.date && episode.date > asOf)) {
      row.status = "excluded_unpublished";
      row.reasons.push("No scheduled, pending or future episode will be altered");
      rows.push(row); continue;
    }
    const current = byUrl.get(episode.recording);
    if (current?.length === 1) {
      row.status = "already_azure";
      row.candidates = [publicBlob(current[0])];
      rows.push(row); continue;
    }
    const exact = (byNumber.get(episode.number) ?? []).filter(b =>
      normalizedTitle(episode.title) && normalizedTitle(b.title) === normalizedTitle(episode.title));
    const candidates = new Map();
    const add = (items, reason) => { for (const b of items) {
      const item = candidates.get(b.name) ?? { ...publicBlob(b), evidence: [] };
      item.evidence.push(reason); candidates.set(b.name, item);
    }};
    add(exact, "exact_episode_number_and_normalized_title");
    add(byNumber.get(episode.number) ?? [], "same_episode_number_only");
    add(byDate.get(episode.date) ?? [], "same_calendar_date");
    add(byTitle.get(normalizedTitle(episode.title)) ?? [], "same_normalized_title");
    const linkedSources = sourcesByUrl.get(canonicalUrl(episode.recording)) ?? [];
    for (const source of linkedSources) add(bySize.get(source.bytes) ?? [], "same_byte_length_as_linked_soundcloud_audio");
    row.candidates = [...candidates.values()];
    if (exact.length !== 1) {
      row.reasons.push(exact.length > 1 ? "Multiple exact Azure matches" : "No exact number-and-title Azure match");
    } else {
      const chosen = exact[0];
      const sameIdentity = (episodesByNumber.get(episode.number) ?? []).filter(e => normalizedTitle(e.title) === normalizedTitle(episode.title));
      if (sameIdentity.length !== 1) row.reasons.push("Multiple website records share this number and title; choose a canonical record first");
      if (episode.date && chosen.date && Math.abs(Date.parse(episode.date) - Date.parse(chosen.date)) > 7 * 86400000)
        row.reasons.push("Website date and Azure filename differ by more than seven days");
      const linked = linkedSources[0];
      if (linkedSources.length > 1) row.reasons.push("SoundCloud link resolves to multiple source inventory rows");
      if (linked && linked.parsed.number != null && linked.parsed.number !== episode.number)
        row.reasons.push("Current SoundCloud recording has a different episode number");
      if (episode.recording && !canonicalUrl(episode.recording)?.startsWith("https://soundcloud.com/") && !episode.recording.startsWith(azurePrefix))
        row.reasons.push("Existing non-SoundCloud recording must be preserved pending review");
      if (!row.reasons.length) {
        row.status = "ready_update";
        row.action = { type: "update_recording_only", id: episode.id,
          oldRecording: episode.recording ?? null, recording: publicBlob(chosen).url,
          blob: publicBlob(chosen) };
      }
    }
    rows.push(row);
  }

  // Two proposed records (or an existing record plus a proposal) must not silently share an asset.
  const claims = group(rows.filter(r => r.action || r.status === "already_azure"), r => r.action?.recording ?? r.candidates[0]?.url);
  for (const items of claims.values()) if (items.length > 1) {
    for (const row of items) {
      row.reasons.push("Azure recording is claimed by more than one website record");
      if (row.action) { row.status = "review"; row.action = null; }
    }
  }

  const creates = [];
  for (const blob of media) {
    if (!Number.isInteger(blob.number) || blob.number < 1 || !blob.title || !blob.date || blob.date > asOf) continue;
    if (episodesByNumber.has(blob.number)) continue;
    const sourceMatches = (sourcesByNumber.get(blob.number) ?? []).filter(s => normalizedTitle(s.parsed.title) === normalizedTitle(blob.title));
    const reasons = [];
    if ((byNumber.get(blob.number) ?? []).length !== 1) reasons.push("Multiple Azure files use this episode number");
    if (sourceMatches.length !== 1) reasons.push("Missing or ambiguous independent SoundCloud number/title corroboration");
    if (episodesByTitle.has(normalizedTitle(blob.title))) reasons.push("Website has this title under another episode number");
    if (rows.some(r => r.episode.recording === publicBlob(blob).url)) reasons.push("This Azure file is already linked by another website record");
    const source = sourceMatches.length === 1 ? sourceMatches[0] : null;
    if (source?.bytes && source.bytes !== blob.size) reasons.push("Azure and SoundCloud byte lengths differ; verify audio versions before adding");
    if (/\b(pre.?show|spoiler|incomplete|part\s*\d|\d\s*of\s*\d)\b/i.test(blob.title)) reasons.push("Split, partial or special recording needs review");
    const proposed = { number: blob.number, title: blob.title, date: blob.date,
      recording: publicBlob(blob).url, description: source?.description ?? null, status: "published" };
    creates.push({ status: reasons.length ? "review" : "ready_create", reasons, proposed,
      blob: publicBlob(blob), source: source ? { title: source.title, url: source.url ?? null, guid: source.guid ?? null,
        publishedAt: source.publishedAt ?? source.pubDate ?? null, bytes: source.bytes } : null,
      datePolicy: "Azure filename recording date; not SoundCloud upload/publication date",
      missingEpisodeNumberAtSnapshot: true });
  }

  const sourceCoverage = sourceRows.map(s => {
    const exact = (byNumber.get(s.parsed.number) ?? []).filter(b => normalizedTitle(s.parsed.title) && normalizedTitle(b.title) === normalizedTitle(s.parsed.title));
    const sizeMatches = bySize.get(s.bytes) ?? [];
    return { title: s.title, url: s.url ?? null, guid: s.guid ?? null, number: s.parsed.number,
      status: exact.length === 1 ? "exact_tag_match" : "review",
      exact: exact.map(publicBlob), byteLengthCandidates: sizeMatches.map(publicBlob),
      numberCandidates: (byNumber.get(s.parsed.number) ?? []).map(publicBlob) };
  });
  const claimed = new Set([...rows.flatMap(r => r.action ? [r.action.blob.name] : r.status === "already_azure" ? [r.candidates[0].name] : []),
    ...creates.filter(r => r.status === "ready_create").map(r => r.blob.name)]);
  const totals = counts => Object.fromEntries([...group(counts, r => r.status)].map(([k,v]) => [k,v.length]));
  return { version: 1, dryRun: true, asOf, inputFingerprints: { episodes: fingerprint(episodes), blobs: fingerprint(blobs), sources: fingerprint(sources) },
    summary: { websiteRows: episodes.length, azureFiles: media.length, sourceTracks: sourceRows.length,
      existing: totals(rows), missingListings: totals(creates), sourceCoverage: totals(sourceCoverage) },
    updates: rows, creates, sourceCoverage,
    unassignedAzure: media.filter(b => !claimed.has(b.name)).map(publicBlob),
    restrictions: ["NOT APPROVED FOR EXECUTION", "No delete, merge, renumber, retitle, status change to existing rows, Azure upload or RSS cutover",
      "Re-read current rows and Azure ETags before any approved writes", "Use the approved production write route and admin optimistic-concurrency snapshot",
      "New listings require duplicate rechecks and collision-safe slug allocation", "Preserve prior recording URLs in rollback evidence"] };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { website: { type: "string" }, azure: { type: "string" },
    sources: { type: "string" }, output: { type: "string" }, "as-of": { type: "string" } } });
  if (!["website", "azure", "sources", "output", "as-of"].every(k => values[k]))
    throw new Error("Required: --website --azure --sources --output --as-of. Offline dry-run only.");
  const read = async file => JSON.parse(await readFile(file, "utf8"));
  const [website, azure, sources] = await Promise.all([read(values.website), read(values.azure), read(values.sources)]);
  const report = planArchiveBackfill({ episodes: website.episodes, blobs: azure.blobs, sources: sources.tracks, asOf: values["as-of"] });
  const output = path.resolve(values.output);
  if (!output.split(path.sep).includes(".local-migration")) throw new Error("Reports must stay in an ignored .local-migration directory.");
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ ...report.summary, output }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
