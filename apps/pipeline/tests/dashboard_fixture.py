"""A small synthetic data directory for the dashboard tests.

Four episodes:

- 20100101: a transcript and nothing else (never processed).
- 20260105: finished, ep 801 "Alpha"; three clips rendered, one published and two skipped.
- 20260112: finished, ep 802 "Beta", from the retired heuristic (no host ratings);
  three clips rendered, none decided. Cowork's T-shirt phrases file is there.
- 20260119: handed to Cowork; Cowork's SEO file is there but invalid, movies is missing.

The phrase report lists five phrases and two passages, one of each kind the
scan sorts them into, and ``output/tshirt/ideas.txt`` holds notes in the shape
of Tony's own.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

SEGMENTS = [{"start": float(t), "end": float(t + 10), "text": f"segment {t}"} for t in range(0, 600, 10)]
MP3_BYTES = bytes(range(256)) * 40  # 10,240 bytes with a known pattern, for Range tests


def snapshot(root: Path):
    """Every path under ``root`` with its size and modification time."""
    return sorted((str(p.relative_to(root)), p.stat().st_size, p.stat().st_mtime_ns) for p in root.rglob("*"))


def clip(i):
    return {"start": 10.0 * i, "end": 10.0 * i + 30.0, "headline": f"Bit {i}",
            "imagePrompt": "A cracked film reel in fog", "why": "Funny"}


def seo(title="Alpha, Beta & Gamma | BBPC Ep 801", candidates=20):
    clips = [clip(i) for i in range(1, candidates + 1)]
    return {
        "title": title, "metaDescription": "D" * 155, "keywords": ["movie podcast"],
        "highlights": [{"start": f"00:00:{s}0", "end": f"00:00:{s}5", "headline": "H", "summary": "S"} for s in (1, 2, 3)],
        "candidateClips": clips, "clipAnalysis": [dict(clips[i]) for i in (0, 4, 9)],
        "notableWorks": ["Sketch"], "callToAction": "Follow us",
    }


def movies(stem, number, title, rows, mode="cowork"):
    return {
        "episode": {"stem": stem, "date": f"{stem[:4]}-{stem[4:6]}-{stem[6:]}",
                    "dbEpisodeId": "id", "dbEpisodeNumber": number, "dbEpisodeTitle": title},
        "extractor": {"version": "cowork_v1" if mode == "cowork" else "hybrid_v3_llm", "mode": mode},
        "movies": rows, "unmatchedTitles": [], "candidates": [],
    }


def movie(title, year, **extra):
    row = {"matchedMovieId": "m1", "title": title, "year": year, "confidence": 0.95, "status": "accepted",
           "evidence": [{"start": 10.0, "end": 80.0, "text": "review", "windowType": "review"}]}
    row.update(extra)
    return row


def scan_phrase(text, episodes, reasons, burst=None, title=False, first="20100101", last="20260105", examples=()):
    return {"phrase": text, "words": len(text.split()), "episodes": episodes, "uses": episodes * 2,
            "firstStem": first, "lastStem": last, "fixedShare": 0.5, "burst": burst, "looksLikeTitle": title,
            "reasons": reasons, "stems": [first, last], "examples": list(examples)}


def burst(count, lift, first="20250106", last="20260105"):
    return {"count": count, "window": 20, "lift": lift, "fromStem": first, "toStem": last}


SCAN_PHRASES = [
    scan_phrase("first time", 300, ["staple"]),
    scan_phrase("pain train", 40, ["fixed"], examples=[
        {"stem": "20100101", "start": 20.0, "text": "All aboard the pain train."},
        {"stem": "20260105", "start": 30.0, "text": "That is the pain train, baby."}]),
    scan_phrase("give it a slater", 30, ["fixed", "burst"], burst(5, 3.5), first="20110416"),
    scan_phrase("big booty", 12, ["burst"], burst(9, 6.0), first="20250106",
                examples=[{"stem": "20260112", "start": 40.0, "text": "Big booty, big booty."}]),
    scan_phrase("thomas crown", 9, ["fixed"], title=True),
]
SCAN_PASSAGES = [
    {"text": "a dollar. I'd buy that for a dollar", "episodes": 135, "firstStem": "20110416",
     "lastStem": "20260105", "stems": ["20110416", "20260105"]},
    {"text": "one two three in the place to be", "episodes": 50, "firstStem": "20100101",
     "lastStem": "20130707", "stems": ["20100101", "20130707"]},
]
SHIRT_LINES = {20: "Like the man said: nobody outruns the gravy!", 30: "I'd buy that for a dollar.",
               40: "That right there is a certified Slater."}
NOTES = "mt rushmores\n- 20260112 - Horror Icons\n- 20260105 - \n\nRatings as words\n Goldblum\n Dollar\n"


def shirt(phrase, start, origin="original", source=None, speaker="Harley", why="Funny with no context"):
    return {"phrase": phrase, "start": float(start), "end": float(start + 10), "speaker": speaker,
            "origin": origin, "source": source, "why": why}


def shirts(stem, *phrases):
    return {"episode": {"stem": stem}, "generatedAt": "2026-01-13T12:00:00Z", "phrases": list(phrases)}


def write(path: Path, payload=None, data: bytes = b""):
    path.parent.mkdir(parents=True, exist_ok=True)
    if payload is None:
        path.write_bytes(data)
    else:
        path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def _finished(root: Path, stem: str, movie_payload, seo_payload):
    write(root / f"transcripts/{stem}.json", SEGMENTS)
    write(root / f"output/movies/{stem}.movies.json", movie_payload)
    write(root / f"output/review-clips/{stem}/_manifest.json", {"episode": stem, "clips": []})
    write(root / f"output/seo/{stem}.seo.json", seo_payload)
    for i, n in enumerate((1, 5, 10), start=1):
        write(root / f"output/clips/{stem}/{i:02d}-bit-{n}.mp4", data=b"video" * i)
        write(root / f"output/visuals/{stem}/{i:02d}-bit-{n}.png", data=b"\x89PNG still %d" % n)
        write(root / f"output/visuals/{stem}/{i:02d}-bit-{n}_vertical_logo.png", data=b"\x89PNG branded")
    write(root / f"output/thumbnails/{stem}.png", data=b"\x89PNG fake")


def build(root: Path) -> dict:
    """Fill ``root`` and return the resolved config that points at it."""
    out = root / "output"
    config = {
        "paths": {
            "episodes_dir": str(root / "episodes"), "output_dir": str(out),
            "transcripts_dir": str(root / "transcripts"),
            "movie_extractions_dir": str(out / "movies"), "seo_dir": str(out / "seo"),
        },
        "settings": {"cowork_outputs_dir": str(out / "cowork")},
    }
    write(root / "transcripts/20100101.json", SEGMENTS)
    write(root / "transcripts/test_large-v3.json", SEGMENTS)

    _finished(root, "20260105", movies("20260105", 801, "Alpha", [
        movie("Sketch", 2025, reviewType="homework", pickedBy="Harley",
              hostRatings={"Fonso": "Dollar", "Harley": "Waste", "Tony": "Slater"}),
        movie("Solo Watch", 2024, reviewType="extra_review", pickedBy="Tony", matchedMovieId=None,
              hostRatings={"Tony": "Goldblum"}),
    ]), seo())
    write(root / "episodes/20260105.mp3", data=MP3_BYTES)
    write(out / "cowork/20260105.movies.json", movies("20260105", 801, None, [movie("Sketch", 2025)]))
    write(out / "cowork/20260105.seo.json", seo(title="T" * 61))

    _finished(root, "20260112", movies("20260112", 802, "Beta", [movie("Old Way", 1999)], mode="heuristic"),
              seo(title="Beta | BBPC Ep 802"))

    write(root / "transcripts/20260112.json",
          [dict(seg, text=SHIRT_LINES.get(int(seg["start"]), seg["text"])) for seg in SEGMENTS])
    write(out / "cowork/20260112.shirts.json", shirts(
        "20260112",
        shirt("Nobody outruns the gravy", 20),
        shirt("I'd buy that for a dollar", 30, origin="quote", source="RoboCop", speaker="Drop"),
        shirt("Certified Slater", 40, origin="unsure", speaker="Fonso"),
    ))
    write(out / "tshirt/ideas.txt", data=NOTES.encode())

    write(root / "transcripts/20260119.json", SEGMENTS)
    write(root / "episodes/20260119.mp3", data=b"audio")
    write(out / "cowork/20260119.seo.json", seo(candidates=19))

    write(out / "cowork/state.json", {"version": 1, "episodes": {
        "20260105": {"status": "done", "updatedAt": "2026-01-06T00:00:00+00:00"},
        "20260112": {"status": "done", "updatedAt": "2026-01-13T00:00:00+00:00",
                     "note": "seeded from existing output",
                     "episodePath": "/gone/bbpc-pipeline/episodes/20260112.mp3"},
        "20260119": {"status": "awaiting_cowork", "updatedAt": "2026-01-20T00:00:00+00:00", "waitingOn": "movies",
                     "lastError": "Cowork output 20260119.seo.json is invalid:\n  - 'candidateClips' must have exactly 20 clips (found 19)"},
    }})
    picks = seo()["clipAnalysis"]
    write(out / "publish-decisions.json", {"version": 1, "decisions": [
        {"stem": "20260105", "source": "pick", "start": picks[0]["start"], "end": picks[0]["end"],
         "headline": "Bit 1", "file": "01-bit-1.mp4", "decision": "published", "youtubeId": "abcdefghijk"},
        {"stem": "20260105", "source": "pick", "start": picks[1]["start"], "end": picks[1]["end"],
         "headline": "Bit 5", "file": "02-bit-5.mp4", "decision": "skipped"},
        {"stem": "20260105", "source": "pick", "start": picks[2]["start"], "end": picks[2]["end"],
         "headline": "Bit 10", "file": "03-bit-10.mp4", "decision": "skipped"},
        {"stem": "20251201", "source": "untracked", "start": None, "end": None,
         "headline": "Bingo Card", "decision": "published", "youtubeId": "bcdefghijkl"},
    ]})
    report = write(out / "phrases/recurring-phrases.json", {
        "version": 1, "scannedAt": "2026-01-20T08:22:00+00:00", "transcripts": 4,
        "firstStem": "20100101", "lastStem": "20260119",
        "phrases": SCAN_PHRASES, "passages": SCAN_PASSAGES,
    })
    ignore = write(out / "phrases/ignore.txt", data=b"pain train\n")
    os.utime(report, (1_800_000_000, 1_800_000_000))
    os.utime(ignore, (1_800_018_000, 1_800_018_000))
    write(root / ".env", data=b"SECRET_TOKEN=do-not-read\n")
    write(out / ".hidden.png", data=b"hidden")
    write(out / "cowork/notes.json", {"private": True})
    return config
