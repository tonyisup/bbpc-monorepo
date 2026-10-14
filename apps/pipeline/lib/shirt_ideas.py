"""Tony's T-shirt shortlist: the phrases he is considering, and what he has decided about each.

The list lives in the data directory at ``output/tshirt/ideas.json``, beside
his own notes in ``ideas.txt``, which this module reads and never changes.
Standard library only.

An idea is a phrase as it was spoken, the text to print (a transcript's
spelling is often not the intended one), its origin (the hosts' own words, a
quote, or not yet checked), the work a quote comes from, a status, notes, and
where the idea came from:

- ``scan``: a phrase or passage in the recurring-phrase report
  (``output/phrases/recurring-phrases.json``), with its episode count and span.
- ``episode``: one of Cowork's picks in ``output/cowork/<stem>.shirts.json``.
- ``notes``: a line of ``ideas.txt``.
- ``manual``: typed in.

Whether a phrase may be printed is Tony's call. ``flags`` lists what he
should know first: a quote is someone else's line, an unchecked origin may be
one, and two of the show's rating names are real people's names.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import fcntl
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from lib import cowork_handoff, phrase_scan

IDEAS_VERSION = 1
STATUSES = ("idea", "shortlisted", "designing", "done", "rejected")
ORIGINS = cowork_handoff.SHIRT_ORIGINS
EDITABLE = ("printText", "origin", "source", "status", "notes")
PHRASE_MAX_CHARS = 300
PRINT_MAX_CHARS = 300
SOURCE_MAX_CHARS = 200
NOTES_MAX_CHARS = 2000
PAGE_ROWS = 50
PAGE_ROWS_MAX = 200
# Rating names that are also a real person's surname, with the spellings transcripts use.
REAL_PEOPLE = (("Slater", ("slater",)), ("Goldblum", ("goldblum", "gold bloom")))
# Lines docs/show-format.md credits to a film: the words that give the line away, and the film.
KNOWN_QUOTES = (("buy that for a dollar", "RoboCop"),)
TITLE_FLAG = {"kind": "title", "text": "The scan lists it as a likely title or name"}
_STEM = re.compile(r"\d{8}")
_NOTE_STEM = re.compile(r"(\d{8})\s*-\s*(.*)")


# --------------------------------------------------------------------------- paths and storage

def _output_dir(config: Dict[str, Any]) -> Path:
    return Path(config.get("paths", {}).get("output_dir", "./output"))


def ideas_path(config: Dict[str, Any]) -> Path:
    return _output_dir(config) / "tshirt" / "ideas.json"


def notes_path(config: Dict[str, Any]) -> Path:
    return _output_dir(config) / "tshirt" / "ideas.txt"


@contextlib.contextmanager
def _locked(config: Dict[str, Any]) -> Iterator[None]:
    """Hold the list from load to save, so the dashboard and the script never overwrite each other."""
    lock = ideas_path(config).with_name(".ideas.json.lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open("a") as held:
        fcntl.flock(held, fcntl.LOCK_EX)  # released when the file closes
        yield


def load(config: Dict[str, Any]) -> Dict[str, Any]:
    path = ideas_path(config)
    if not path.is_file():
        return {"version": IDEAS_VERSION, "nextId": 1, "ideas": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise ValueError(f"{path.name} is not valid JSON: {exc}") from None
    ideas = data.get("ideas") if isinstance(data, dict) else None
    if not isinstance(ideas, list) or not all(
        isinstance(idea, dict) and _is_id(idea.get("id")) and isinstance(idea.get("phrase"), str) for idea in ideas
    ):
        raise ValueError(f"{path.name} must be an object with an 'ideas' list, each with an id and a phrase")
    if data.get("version") != IDEAS_VERSION:
        # A newer file may hold fields this code would drop on the next save.
        raise ValueError(f"{path.name} is version {data.get('version')}; this code reads version {IDEAS_VERSION}")
    next_id = data.get("nextId") if _is_id(data.get("nextId")) else 1
    data["nextId"] = max([next_id] + [idea["id"] + 1 for idea in ideas])
    return data


def _save(config: Dict[str, Any], data: Dict[str, Any]) -> None:
    path = ideas_path(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".ideas.", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def _is_id(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 1


# --------------------------------------------------------------------------- fields

def phrase_key(text: str) -> str:
    """What makes two phrases the same idea: their words, whatever the case and punctuation."""
    return phrase_scan.normalize_phrase(text)


def _text(name: str, value: Any, limit: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text")
    value = value.strip()
    if len(value) > limit:
        raise ValueError(f"{name} is {len(value)} characters (the limit is {limit})")
    return value


def _phrase(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("phrase must be text")
    phrase = _text("phrase", " ".join(value.split()), PHRASE_MAX_CHARS)
    if not phrase_key(phrase):
        raise ValueError("phrase needs at least one word")
    return phrase


def _print_text(value: Any) -> str:
    text = _text("printText", value, PRINT_MAX_CHARS)
    if not text:
        raise ValueError("printText needs some text")
    return text


def _status(value: Any) -> str:
    if value not in STATUSES:
        raise ValueError(f"status must be one of {', '.join(STATUSES)}, not {value!r}")
    return value


def _origin(origin: Any, source: Any) -> Dict[str, Optional[str]]:
    """The origin and source that go together: a quote names its work, nothing else has one."""
    if origin not in ORIGINS:
        raise ValueError(f"origin must be one of {', '.join(ORIGINS)}, not {origin!r}")
    source = None if source is None else " ".join(_text("source", source, SOURCE_MAX_CHARS).split()) or None
    if origin == "quote" and source is None:
        raise ValueError("a quote needs its source (the film, show or song it is from)")
    if origin != "quote" and source is not None:
        raise ValueError(f"only a quote has a source; this one is {origin}")
    return {"origin": origin, "source": source}


def _find(data: Dict[str, Any], idea_id: Any) -> Dict[str, Any]:
    for idea in data["ideas"]:
        if _is_id(idea_id) and idea["id"] == idea_id:
            return idea
    raise ValueError(f"no idea #{idea_id}")


def _listed(data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {phrase_key(idea["phrase"]): idea for idea in data["ideas"]}


# --------------------------------------------------------------------------- licensing flags

def _text_flags(*texts: Optional[str], quote: bool = True) -> List[Dict[str, str]]:
    """What the words alone give away: a line the show notes credit to a film, a real person's name."""
    spoken = " | ".join(phrase_key(text) for text in texts if text)
    found = [{"kind": "known_quote", "text": f"Known quote: {work} (docs/show-format.md)"}
             for words, work in KNOWN_QUOTES if quote and words in spoken]
    return found + [
        {"kind": "person", "text": f"Names a real person: {name}"}
        for name, spellings in REAL_PEOPLE
        if any(re.search(rf"(?<![a-z0-9']){re.escape(s)}(?:'s)?(?![a-z0-9'])", spoken) for s in spellings)
    ]


def flags(idea: Dict[str, Any]) -> List[Dict[str, str]]:
    """What Tony should know before printing ``idea``. Nothing here blocks anything."""
    found: List[Dict[str, str]] = []
    if idea.get("origin") == "quote":
        found.append({"kind": "quote", "text": f"Quote from {idea.get('source')}: someone else's line"})
    elif idea.get("origin") == "unsure":
        found.append({"kind": "unsure", "text": "Origin not checked: it may be a quote"})
    # An idea already recorded as a quote does not need telling twice.
    found += _text_flags(idea.get("phrase"), idea.get("printText"), quote=idea.get("origin") != "quote")
    came_from = idea.get("from") or {}
    if came_from.get("kind") == "scan" and came_from.get("section") == "titles":
        found.append(dict(TITLE_FLAG))
    return found


def source_text(idea: Dict[str, Any]) -> str:
    """Where an idea came from, in a few words."""
    came_from = idea.get("from") or {}
    kind = came_from.get("kind")
    if kind == "scan":
        title = dict(phrase_scan.SECTIONS).get(came_from.get("section"), came_from.get("section"))
        return (f"phrase scan, {title}, {came_from.get('episodes')} episodes "
                f"{came_from.get('firstStem')}-{came_from.get('lastStem')}")
    if kind == "episode":
        return (f"episode {came_from.get('stem')} at {phrase_scan.clock(came_from.get('start') or 0.0)}, "
                f"{came_from.get('speaker')}")
    if kind == "notes":
        heading = f", {came_from['heading']}" if came_from.get("heading") else ""
        stem = f" ({came_from['stem']})" if came_from.get("stem") else ""
        return f"{notes_path({}).name}{heading}{stem}"
    return "typed in"


# --------------------------------------------------------------------------- the list

def add(
    config: Dict[str, Any],
    phrase: str,
    *,
    print_text: Optional[str] = None,
    origin: str = "unsure",
    source: Optional[str] = None,
    status: str = "idea",
    notes: Optional[str] = None,
    came_from: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Put ``phrase`` on the list. The text to print starts as the phrase itself."""
    phrase = _phrase(phrase)
    fields = {
        "phrase": phrase,
        "printText": phrase if print_text is None else _print_text(print_text),
        **_origin(origin, source),
        "status": _status(status),
        "notes": "" if notes is None else _text("notes", notes, NOTES_MAX_CHARS),
        "from": dict(came_from or {"kind": "manual"}),
    }
    with _locked(config):
        data = load(config)
        already = _listed(data).get(phrase_key(phrase))
        if already:
            raise ValueError(f"{phrase!r} is already on the list as #{already['id']} ({already.get('status')})")
        now = _now()
        idea = {"id": data["nextId"], **fields, "addedAt": now, "updatedAt": now}
        data["ideas"].append(idea)
        data["nextId"] += 1
        _save(config, data)
    return idea


def update(config: Dict[str, Any], idea_id: int, **changes: Any) -> Dict[str, Any]:
    """Change any of ``EDITABLE`` on one idea. The phrase as spoken is what the idea is, so it stays."""
    with _locked(config):
        data = load(config)
        idea = _find(data, idea_id)
        for name in changes:
            if name not in EDITABLE:
                raise ValueError(f"cannot change {name} (only {', '.join(EDITABLE)})")
        if not changes:
            raise ValueError("nothing to change")
        if "printText" in changes:
            idea["printText"] = _print_text(changes["printText"])
        if "status" in changes:
            idea["status"] = _status(changes["status"])
        if "notes" in changes:
            idea["notes"] = _text("notes", changes["notes"], NOTES_MAX_CHARS)
        if "origin" in changes or "source" in changes:
            origin = changes.get("origin", idea.get("origin"))
            # A line that stops being a quote loses its source with it.
            kept = idea.get("source") if origin == "quote" else None
            idea.update(_origin(origin, changes["source"] if "source" in changes else kept))
        idea["updatedAt"] = _now()
        _save(config, data)
    return idea


def remove(config: Dict[str, Any], idea_id: int) -> Dict[str, Any]:
    """Take an idea off the list for good. Its number is not given out again."""
    with _locked(config):
        data = load(config)
        idea = _find(data, idea_id)
        data["ideas"].remove(idea)
        _save(config, data)
    return idea


# --------------------------------------------------------------------------- the phrase scan

def _report(config: Dict[str, Any]) -> Dict[str, Any]:
    return phrase_scan.load_report(_output_dir(config) / "phrases")


def _row_text(row: Dict[str, Any]) -> str:
    return row["phrase"] if "phrase" in row else row["text"]


def _wanted(query: Any) -> str:
    if not isinstance(query, str):
        raise ValueError("query must be text")
    return " ".join(query.lower().split())


def _matching(rows: List[Dict[str, Any]], wanted: str) -> List[Dict[str, Any]]:
    return [row for row in rows if wanted in _row_text(row).lower()]


def scan_sections(config: Dict[str, Any], query: str = "") -> List[Dict[str, Any]]:
    """The report's lists and how many phrases each holds; with ``query``, how many contain it."""
    lists, wanted = phrase_scan.sections(_report(config)), _wanted(query)
    return [{"id": key, "title": title, "count": len(_matching(lists[key], wanted))}
            for key, title in phrase_scan.SECTIONS]


def scan_rows(
    config: Dict[str, Any], section: str, query: str = "", offset: int = 0, limit: int = PAGE_ROWS
) -> Dict[str, Any]:
    """One page of a section of the phrase report, each row marked if it is already an idea.

    ``sections`` counts the matches in every list, since a phrase is filed
    under whichever lists the scan put it in.
    """
    titles = dict(phrase_scan.SECTIONS)
    if section not in titles:
        raise ValueError(f"no section {section!r} (use {', '.join(titles)})")
    wanted = _wanted(query)
    for name, value, least in (("offset", offset, 0), ("limit", limit, 1)):
        if not isinstance(value, int) or isinstance(value, bool) or value < least:
            raise ValueError(f"{name} must be a whole number, {least} or more")
    limit = min(limit, PAGE_ROWS_MAX)
    rows = _matching(phrase_scan.sections(_report(config))[section], wanted)
    listed = _listed(load(config))

    def shown(row: Dict[str, Any]) -> Dict[str, Any]:
        text, burst = _row_text(row), row.get("burst")
        idea = listed.get(phrase_key(text))
        return {
            "text": text, "episodes": row["episodes"], "firstStem": row["firstStem"], "lastStem": row["lastStem"],
            "burst": {key: burst[key] for key in ("count", "window", "fromStem", "toStem")} if burst else None,
            "looksLikeTitle": bool(row.get("looksLikeTitle")),
            "examples": [{key: example[key] for key in ("stem", "start", "text")} for example in row.get("examples", [])],
            "ideaId": idea["id"] if idea else None,
            "flags": _text_flags(text) + ([dict(TITLE_FLAG)] if row.get("looksLikeTitle") else []),
        }

    return {"section": section, "title": titles[section], "query": wanted, "total": len(rows),
            "offset": offset, "limit": limit, "rows": [shown(row) for row in rows[offset:offset + limit]],
            "sections": scan_sections(config, wanted)}


def add_from_scan(config: Dict[str, Any], phrase: str, *, status: str = "shortlisted", **fields: Any) -> Dict[str, Any]:
    """Promote a phrase or passage of the report, recording how often the scan found it."""
    report = _report(config)
    key = phrase_key(phrase) if isinstance(phrase, str) else ""
    for section, rows in phrase_scan.sections(report).items():
        for row in rows:
            if key and phrase_key(_row_text(row)) == key:
                came_from = {"kind": "scan", "section": section, "episodes": row["episodes"],
                             "firstStem": row["firstStem"], "lastStem": row["lastStem"],
                             "scannedAt": report.get("scannedAt")}
                return add(config, _row_text(row), status=status, came_from=came_from, **fields)
    raise ValueError(f"{phrase!r} is not in the phrase report")


# --------------------------------------------------------------------------- Cowork's episode picks

def _shirts_file(config: Dict[str, Any], stem: Any) -> Path:
    path = cowork_handoff.shirts_path(config, stem) if isinstance(stem, str) and _STEM.fullmatch(stem) else None
    if path is None or not path.is_file():
        raise ValueError(f"no shirts file for {stem}")
    return path


def _read_shirts(path: Path) -> Tuple[List[Dict[str, Any]], List[str]]:
    """A shirts file's phrases, or the reasons it offers none.

    The file's shape is checked here; whether each phrase is really spoken in
    its window is the validator's job (the Episode tab shows that result).
    """
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return [], [f"could not be read: {exc}"]
    problems = cowork_handoff.validate_shirts(payload)
    return ([] if problems else payload["phrases"]), problems


def episode_phrases(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Every episode with a shirts file, newest first, with Cowork's phrases."""
    folder = cowork_handoff.cowork_dir(config)
    stems = sorted((p.name.split(".")[0] for p in folder.glob("*.shirts.json")), reverse=True) if folder.is_dir() else []
    listed = _listed(load(config))
    episodes = []
    for stem in stems:
        if not _STEM.fullmatch(stem):
            continue
        phrases, problems = _read_shirts(cowork_handoff.shirts_path(config, stem))
        rows = []
        for index, row in enumerate(phrases, start=1):
            idea = listed.get(phrase_key(row["phrase"]))
            rows.append({
                "index": index, "phrase": row["phrase"], "start": float(row["start"]), "end": float(row["end"]),
                "speaker": row["speaker"], "origin": row["origin"], "source": row["source"], "why": row["why"],
                "ideaId": idea["id"] if idea else None, "flags": flags(row),
            })
        episodes.append({"stem": stem, "problems": problems, "phrases": rows})
    return episodes


def add_from_episode(
    config: Dict[str, Any], stem: str, index: int, *, status: str = "shortlisted",
    origin: Optional[str] = None, source: Optional[str] = None, **fields: Any,
) -> Dict[str, Any]:
    """Promote phrase ``index`` (from 1) of an episode's shirts file.

    Cowork's origin and source are kept unless ``origin`` says otherwise.
    """
    path = _shirts_file(config, stem)
    phrases, problems = _read_shirts(path)
    if problems:
        raise ValueError(f"{path.name} is not valid: {problems[0]}")
    if not _is_id(index) or index > len(phrases):
        raise ValueError(f"phrase {index} does not exist (1-{len(phrases)})")
    row = phrases[index - 1]
    origin = row["origin"] if origin is None else origin
    if source is None and origin == "quote":
        source = row["source"]
    came_from = {"kind": "episode", "stem": stem, "start": float(row["start"]), "end": float(row["end"]),
                 "speaker": row["speaker"], "why": row["why"]}
    return add(config, row["phrase"], status=status, origin=origin, source=source, came_from=came_from, **fields)


# --------------------------------------------------------------------------- Tony's notes

def _note_lines(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The ideas in ``ideas.txt``.

    A line that is indented or starts with a dash is an idea. Any other line
    is the heading of the ideas under it, or an idea itself when nothing
    under it is one. ``<YYYYMMDD> - words`` names the episode the idea is from.
    """
    path = notes_path(config)
    if not path.is_file():
        return []
    lines = [(number, raw) for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1)
             if raw.strip()]

    def listed(raw: str) -> bool:
        return raw[:1].isspace() or raw.lstrip().startswith(("-", "*"))

    rows: List[Dict[str, Any]] = []
    heading: Optional[str] = None
    for position, (number, raw) in enumerate(lines):
        line = raw.strip()
        if not listed(raw):
            following = lines[position + 1][1] if position + 1 < len(lines) else ""
            heading = line if listed(following) else None
            if heading is not None:
                continue
        text = line.lstrip("-* \t")
        dated = _NOTE_STEM.fullmatch(text)
        rows.append({"number": number, "heading": heading, "line": line,
                     "stem": dated.group(1) if dated else None,
                     "text": (dated.group(2) if dated else text).strip()})
    return rows


def _note_idea(data: Dict[str, Any], row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    for idea in data["ideas"]:
        came_from = idea.get("from") or {}
        if (came_from.get("kind"), came_from.get("heading"), came_from.get("line")) == ("notes", row["heading"], row["line"]):
            return idea
    return _listed(data).get(phrase_key(row["text"])) if phrase_key(row["text"]) else None


def notes(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Each idea in Tony's ``ideas.txt``, marked if it is already on the list. The file is only read."""
    data = load(config)
    rows = []
    for row in _note_lines(config):
        idea = _note_idea(data, row)
        rows.append({**row, "ideaId": idea["id"] if idea else None, "flags": _text_flags(row["text"])})
    return rows


def add_from_notes(
    config: Dict[str, Any], number: int, *, phrase: Optional[str] = None, **fields: Any
) -> Dict[str, Any]:
    """Add line ``number`` of ``ideas.txt``; ``phrase`` rewords it, or supplies words the line lacks."""
    name = notes_path(config).name
    row = next((row for row in _note_lines(config) if row["number"] == number), None)
    if row is None:
        raise ValueError(f"line {number} of {name} is not an idea")
    already = _note_idea(load(config), row)
    if already:
        raise ValueError(f"line {number} of {name} is already on the list as #{already['id']} ({already.get('status')})")
    if phrase is None and not row["text"]:
        raise ValueError(f"line {number} of {name} has no phrase; give one")
    came_from = {"kind": "notes", "heading": row["heading"], "line": row["line"]}
    if row["stem"]:
        came_from["stem"] = row["stem"]
    return add(config, row["text"] if phrase is None else phrase, came_from=came_from, **fields)
