"""Azure reads and transcription only. Invoked by backfill.mjs using JSON on stdin.

Uses the pipeline's Python environment, without importing or running its publisher.
"""

import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor


class BackfillError(ValueError):
    """A fixed, operator-safe error message that contains no SDK credentials."""


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, allow_nan=False)
    os.replace(temporary, path)


def container_client(env_file):
    from azure.storage.blob import BlobServiceClient
    from dotenv import dotenv_values

    config = dotenv_values(env_file)
    connection = config.get("AZURE_STORAGE_CONNECTION_STRING")
    if not connection:
        raise BackfillError("Missing AZURE_STORAGE_CONNECTION_STRING in --env-file")
    return BlobServiceClient.from_connection_string(connection).get_container_client("episodes")


def read_tags(client, blob):
    """Read at most 2 MiB of ID3v2 tags, never the entire MP3 for matching."""
    from azure.core import MatchConditions
    from mutagen.id3 import ID3

    kwargs = {"etag": blob["etag"], "match_condition": MatchConditions.IfNotModified}
    header = client.download_blob(offset=0, length=min(10, blob["size"]), **kwargs).readall()
    if len(header) < 10 or header[:3] != b"ID3":
        return {"status": "no-id3v2"}
    if any(byte & 0x80 for byte in header[6:10]):
        return {"status": "invalid-id3v2"}
    size = 10 + sum(byte << (7 * (3 - index)) for index, byte in enumerate(header[6:10]))
    if size > min(2 * 1024 * 1024, blob["size"]):
        return {"status": "tag-too-large"}
    data = client.download_blob(offset=0, length=size, **kwargs).readall()
    tags = ID3(fileobj=io.BytesIO(data))
    title = str(tags.get("TIT2", "")).strip()
    number = None
    number_fields = [frame for frame in tags.getall("TXXX")
                     if frame.desc.lower() in ("episode", "episodenumber", "episode number", "epnum", "ep")]
    number_fields.append(tags.get("TRCK", ""))
    for field in number_fields:
        match = re.fullmatch(r"\s*(?:Episode\s+)?(\d+)(?:/\d+)?\s*", str(field), re.I)
        if match:
            number = int(match[1])
            break
    prefix = re.match(r"^\s*(\d+)\s*[-–—]\s*(.+)$", title)
    if prefix and (number is None or number == int(prefix[1])):
        number, title = int(prefix[1]), prefix[2].strip()
    return {"status": "read", "number": number, "title": title}


def inventory(request):
    if request.get("readTags"):
        import mutagen.id3  # Fail before listing if the optional dependency is absent.
    container = container_client(request["envFile"])
    blobs = [{"name": b.name, "size": b.size, "etag": b.etag}
             for b in container.list_blobs() if b.name.lower().endswith(".mp3")]
    if request.get("readTags"):
        def enrich(blob):
            try:
                blob["tags"] = read_tags(container.get_blob_client(blob["name"]), blob)
            except Exception as error:
                # A tag/network failure is review data, never evidence of a missing episode.
                blob["tags"] = {"status": "error", "errorType": type(error).__name__}
            return blob
        with ThreadPoolExecutor(max_workers=4) as pool:
            blobs = list(pool.map(enrich, blobs))
    return {"containerUrl": container.url.split("?")[0], "blobs": blobs}


def consume_segments(segments, checkpoint):
    """Completion requires exhausting the generator, not merely creating a JSON file."""
    rows = []
    try:
        for segment in segments:
            row = {"start": float(segment.start), "end": float(segment.end), "text": segment.text}
            if (not math.isfinite(row["start"]) or not math.isfinite(row["end"])
                    or row["start"] < 0 or row["end"] < row["start"]
                    or (rows and row["start"] < rows[-1]["start"]) or not isinstance(row["text"], str)):
                raise BackfillError("Invalid transcription segment")
            rows.append(row)
            if len(rows) % 100 == 0:
                save_json(checkpoint, rows)
                print(f"Transcribed through {row['end']:.0f}s", file=sys.stderr, flush=True)
    finally:
        # Failed/interrupted work remains explicitly partial, never a completed result.
        save_json(checkpoint, rows)
    if not rows or not any(row["text"].strip() for row in rows):
        raise BackfillError("Empty transcript")
    return rows


def transcribe(request):
    from azure.core import MatchConditions
    from faster_whisper import WhisperModel

    container = container_client(request["envFile"])
    if container.url.split("?")[0] != request["containerUrl"]:
        raise BackfillError("Azure container differs from reviewed plan")
    blob = request["blob"]
    client = container.get_blob_client(blob["name"])
    properties = client.get_blob_properties()
    if properties.etag != blob["etag"] or properties.size != blob["size"]:
        raise BackfillError("Audio changed since plan; create a new plan")
    work = Path(request["work"])
    work.mkdir(parents=True, exist_ok=True)
    audio = work / "audio.mp3"
    # A finished download is an atomic file; the work directory is keyed by URL + ETag.
    if not audio.is_file() or audio.stat().st_size != blob["size"]:
        partial = work / "audio.download"
        with partial.open("wb") as stream:
            client.download_blob(etag=blob["etag"], match_condition=MatchConditions.IfNotModified).readinto(stream)
        if partial.stat().st_size != blob["size"]:
            raise BackfillError("Incomplete audio download")
        os.replace(partial, audio)
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "default=noprint_wrappers=1:nokey=1", str(audio)],
                           check=True, capture_output=True, text=True)
    duration = float(probe.stdout.strip())
    if not math.isfinite(duration) or duration <= 0:
        raise BackfillError("Invalid source audio duration")
    model = WhisperModel(request["model"], device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(audio), language="en", beam_size=5)
    rows = consume_segments(segments, work / "partial.json")
    # Exhaustion proves the job finished; this additional heuristic flags suspicious coverage.
    if rows[-1]["end"] < duration * 0.95 or rows[-1]["end"] > duration + 2:
        raise BackfillError("Transcript end does not cover 95–100% of audio; inspect partial.json")
    save_json(work / "candidate.json", rows)
    return {"complete": True, "duration": duration, "lastEnd": rows[-1]["end"], "segments": len(rows)}


if __name__ == "__main__":
    os.umask(0o077)
    try:
        request = json.load(sys.stdin)
        operation = {"inventory": inventory, "transcribe": transcribe}[request["operation"]]
        result = operation(request)
        print(json.dumps(result, allow_nan=False))
    except KeyboardInterrupt:
        sys.exit(130)
    except BackfillError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # SDK exceptions can contain signed URLs or credentials. Never serialize their text.
        print(f"Backfill worker failed ({type(error).__name__}); check configuration, source ETag, dependencies and partial output.", file=sys.stderr)
        sys.exit(1)
