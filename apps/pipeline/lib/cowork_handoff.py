"""Hand-off between the pipeline and Claude Cowork for the judgment stages.

Cowork reads a finished transcript and writes the two files the judgment
stages consume; there is no model or heuristic fallback:

    <cowork_dir>/<stem>.movies.json   -> used by the ``movies`` stage
    <cowork_dir>/<stem>.seo.json      -> used by the ``parse`` stage

When a file is missing the stage raises ``AwaitingCowork`` so the run can
resume later with ``--from movies``.

Cowork may also write ``<cowork_dir>/<stem>.shirts.json`` (T-shirt phrases).
That file is information for Tony: only the validator reads it, and it never
affects readiness, the stages or ``state.json``.

Progress is tracked in ``<cowork_dir>/state.json`` so unattended runs neither
reprocess finished episodes nor start the expensive stages early. The
pipeline owns that file; Cowork only reads it and writes the two outputs.

This module deliberately uses only the standard library so the validator
(``scripts/validate_cowork_outputs.py``) can run without the pipeline venv.
"""
from __future__ import annotations

import bisect
import datetime as _dt
import json
import math
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

EXIT_AWAITING_COWORK = 75  # EX_TEMPFAIL: not a failure, try again later

STATUS_AWAITING = "awaiting_cowork"
STATUS_DONE = "done"

CLIP_MIN_SECONDS = 20.0
CLIP_MAX_SECONDS = 90.0
CANDIDATE_CLIP_COUNT = 20
PICKED_CLIP_COUNT = 3
EVIDENCE_MIN_SECONDS = 60.0
EVIDENCE_MAX_SECONDS = 180.0
TITLE_MAX_CHARS = 60
META_DESCRIPTION_CHARS = (120, 170)  # "about 160"; search results cut off near 160
HIGHLIGHT_COUNT = (3, 5)
SHIRT_PHRASE_MAX_COUNT = 10
SHIRT_PHRASE_MAX_CHARS = 60
SHIRT_WINDOW_MAX_SECONDS = 30.0
BOUNDARY_TOLERANCE_SECONDS = 0.01  # transcript times have two decimals
SEO_STRING_KEYS = ("title", "metaDescription", "callToAction")
SEO_LIST_KEYS = ("keywords", "highlights", "clipAnalysis", "candidateClips", "notableWorks")
MOVIE_STATUSES = {"accepted", "maybe", "rejected", "db_assigned"}
# Names as the site spells them (apps/web About and Game pages); see docs/show-format.md.
HOSTS = ("Fonso", "Harley", "Tony")
RATINGS = ("Slater", "Dollar", "Waste", "Goldblum")  # best to worst, site values 4..1
SHIRT_SPEAKERS = HOSTS + ("Drop", "Unknown")  # Drop: a pre-recorded drop
SHIRT_ORIGINS = ("original", "quote", "unsure")


class AwaitingCowork(Exception):
    """Raised by a stage in ``require`` mode when Cowork has not written its file yet."""

    def __init__(self, stem: str, stage: str, path: Path):
        self.stem = stem
        self.stage = stage
        self.path = path
        super().__init__(f"Waiting for Cowork to write {path} ({stage} stage, episode {stem}).")


class CoworkOutputInvalid(ValueError):
    """Raised when a Cowork file exists but does not pass validation."""

    def __init__(self, path: Path, problems: List[str]):
        self.path = path
        self.problems = problems
        joined = "\n  - ".join(problems)
        super().__init__(f"Cowork output {path} is invalid:\n  - {joined}")


# --------------------------------------------------------------------------- paths/mode

def cowork_dir(config: Dict[str, Any]) -> Path:
    settings = config.get("settings", {}) if isinstance(config, dict) else {}
    configured = settings.get("cowork_outputs_dir") if isinstance(settings, dict) else None
    if configured:
        return Path(str(configured)).expanduser().resolve()
    output_dir = config.get("paths", {}).get("output_dir", "./output") if isinstance(config, dict) else "./output"
    return (Path(output_dir).expanduser() / "cowork").resolve()


def movies_path(config: Dict[str, Any], stem: str) -> Path:
    return cowork_dir(config) / f"{stem}.movies.json"


def seo_path(config: Dict[str, Any], stem: str) -> Path:
    return cowork_dir(config) / f"{stem}.seo.json"


def shirts_path(config: Dict[str, Any], stem: str) -> Path:
    return cowork_dir(config) / f"{stem}.shirts.json"


def outputs_ready(config: Dict[str, Any], stem: str) -> bool:
    # The shirts file is optional and never part of readiness.
    return movies_path(config, stem).is_file() and seo_path(config, stem).is_file()


# --------------------------------------------------------------------------- loading

def _read_json(path: Path) -> Any:
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as exc:
        raise CoworkOutputInvalid(path, [f"not valid JSON: {exc}"]) from None


def load_movies(
    config: Dict[str, Any],
    stem: str,
    segments: Optional[Sequence[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Return the validated Cowork movie payload, or None when it does not exist.

    Pass the transcript ``segments`` to enforce segment-boundary snapping.
    """
    path = movies_path(config, stem)
    if not path.is_file():
        return None
    payload = _read_json(path)
    problems = validate_movies(payload, segments)
    if problems:
        raise CoworkOutputInvalid(path, problems)
    return payload


def load_seo(
    config: Dict[str, Any],
    stem: str,
    transcript_duration: Optional[float] = None,
    segments: Optional[Sequence[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Return the validated Cowork SEO payload, or None when it does not exist.

    Pass the transcript ``segments`` to enforce segment-boundary snapping.
    """
    path = seo_path(config, stem)
    if not path.is_file():
        return None
    payload = _read_json(path)
    problems = validate_seo(payload, transcript_duration, segments)
    if problems:
        raise CoworkOutputInvalid(path, problems)
    return payload


def load_shirts(
    config: Dict[str, Any],
    stem: str,
    segments: Optional[Sequence[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Return the validated Cowork T-shirt phrase payload, or None when it does not exist.

    Pass the transcript ``segments`` to enforce segment-boundary snapping and to
    check each phrase against the words spoken in its window.
    """
    path = shirts_path(config, stem)
    if not path.is_file():
        return None
    payload = _read_json(path)
    problems = validate_shirts(payload, segments)
    if problems:
        raise CoworkOutputInvalid(path, problems)
    return payload


# --------------------------------------------------------------------------- validation

def _finite(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


class _Boundaries:
    """Sorted segment start/end times, for checking that windows are snapped."""

    def __init__(self, segments: Sequence[Dict[str, Any]]):
        self.starts = sorted(t for t in (_finite(seg.get("start")) for seg in segments) if t is not None)
        self.ends = sorted(t for t in (_finite(seg.get("end")) for seg in segments) if t is not None)
        self.duration = self.ends[-1] if self.ends else None

    @staticmethod
    def _on(value: float, times: List[float]) -> bool:
        i = bisect.bisect_left(times, value - BOUNDARY_TOLERANCE_SECONDS)
        return i < len(times) and times[i] <= value + BOUNDARY_TOLERANCE_SECONDS

    def problems(self, label: str, start: float, end: float) -> List[str]:
        found = []
        if not self._on(start, self.starts):
            found.append(f"{label} starts at {start:.2f}s, not on a transcript segment start")
        if not self._on(end, self.ends):
            found.append(f"{label} ends at {end:.2f}s, not on a transcript segment end")
        return found


def _check_window(
    label: str,
    row: Any,
    duration: Optional[float],
    problems: List[str],
    boundaries: Optional[_Boundaries] = None,
) -> None:
    if not isinstance(row, dict):
        problems.append(f"{label} is not an object")
        return
    start, end = _finite(row.get("start")), _finite(row.get("end"))
    if start is None or end is None:
        problems.append(f"{label} needs numeric start/end seconds")
        return
    if end <= start or start < 0:
        problems.append(f"{label} has an invalid window {start}-{end}")
    if duration is not None and end > duration + 1.0:
        problems.append(f"{label} ends at {end:.1f}s, past the transcript end ({duration:.1f}s)")
    if boundaries is not None:
        problems.extend(boundaries.problems(label, start, end))


def _window_length(row: Any) -> Optional[float]:
    if not isinstance(row, dict):
        return None
    start, end = _finite(row.get("start")), _finite(row.get("end"))
    return None if start is None or end is None else end - start


def validate_movies(payload: Any, segments: Optional[Sequence[Dict[str, Any]]] = None) -> List[str]:
    """Return blocking problems with a Cowork movie file (empty list when valid)."""
    boundaries = _Boundaries(segments) if segments else None
    problems: List[str] = []
    if not isinstance(payload, dict):
        return ["top level must be an object"]
    movies = payload.get("movies")
    if not isinstance(movies, list):
        return ["'movies' must be a list"]
    if not isinstance(payload.get("candidates", []), list):
        problems.append("'candidates' must be a list")
    for i, movie in enumerate(movies):
        label = f"movies[{i}]"
        if not isinstance(movie, dict):
            problems.append(f"{label} is not an object")
            continue
        if not str(movie.get("title") or "").strip():
            problems.append(f"{label} needs a title")
        year = movie.get("year")
        if year is not None and not (isinstance(year, int) and 1880 <= year <= 2100):
            problems.append(f"{label} has an implausible year {year!r}")
        if movie.get("status", "accepted") not in MOVIE_STATUSES:
            problems.append(f"{label} has unknown status {movie.get('status')!r}")
        for j, ev in enumerate(movie.get("evidence") or []):
            _check_window(f"{label}.evidence[{j}]", ev, None, problems, boundaries)
        _check_host_ratings(label, movie, problems)
    return problems


def _check_host_ratings(label: str, movie: Dict[str, Any], problems: List[str]) -> None:
    ratings = movie.get("hostRatings")
    if ratings is None:
        return
    if not isinstance(ratings, dict):
        problems.append(f"{label}.hostRatings must be an object")
        return
    for host, rating in ratings.items():
        if host not in HOSTS:
            problems.append(f"{label}.hostRatings has unknown host {host!r} (use {', '.join(HOSTS)})")
        elif rating not in RATINGS:
            problems.append(f"{label}.hostRatings[{host!r}] is {rating!r} (use {', '.join(RATINGS)})")


def validate_seo(
    payload: Any,
    transcript_duration: Optional[float] = None,
    segments: Optional[Sequence[Dict[str, Any]]] = None,
) -> List[str]:
    """Return blocking problems with a Cowork SEO file (empty list when valid).

    Hard rules from docs/cowork-handoff.md: exactly 20 candidate clips, exactly
    3 picks each copied from a candidate, and (when ``segments`` is given) every
    clip starting and ending on transcript segment boundaries.
    """
    boundaries = _Boundaries(segments) if segments else None
    if transcript_duration is None and boundaries is not None:
        transcript_duration = boundaries.duration
    problems: List[str] = []
    if not isinstance(payload, dict):
        return ["top level must be an object"]
    for key in SEO_STRING_KEYS:
        if not (isinstance(payload.get(key), str) and payload[key].strip()):
            problems.append(f"'{key}' must be a non-empty string")
    for key in SEO_LIST_KEYS:
        if not (isinstance(payload.get(key), list) and payload[key]):
            problems.append(f"'{key}' must be a non-empty list")
    for key in ("candidateClips", "clipAnalysis"):
        for i, clip in enumerate(payload.get(key) or []):
            label = f"{key}[{i}]"
            _check_window(label, clip, transcript_duration, problems, boundaries)
            if isinstance(clip, dict):
                if not str(clip.get("headline") or "").strip():
                    problems.append(f"{label} needs a headline")
                if not str(clip.get("imagePrompt") or "").strip():
                    problems.append(f"{label} needs an imagePrompt")
    _check_clip_counts_and_picks(payload, problems)
    for i, row in enumerate(payload.get("highlights") or []):
        if not isinstance(row, dict) or not all(isinstance(row.get(k), str) for k in ("start", "end")):
            problems.append(f"highlights[{i}] needs HH:MM:SS string start/end")
    return problems


def _clip_key(clip: Dict[str, Any]) -> tuple:
    return (_finite(clip.get("start")), _finite(clip.get("end")), str(clip.get("headline") or "").strip())


def _check_clip_counts_and_picks(payload: Dict[str, Any], problems: List[str]) -> None:
    candidates = payload.get("candidateClips")
    picks = payload.get("clipAnalysis")
    if isinstance(candidates, list) and candidates and len(candidates) != CANDIDATE_CLIP_COUNT:
        problems.append(
            f"'candidateClips' must have exactly {CANDIDATE_CLIP_COUNT} clips (found {len(candidates)})"
        )
    if not isinstance(picks, list) or not picks:
        return  # reported above as an empty/missing list
    if len(picks) != PICKED_CLIP_COUNT:
        problems.append(f"'clipAnalysis' must have exactly {PICKED_CLIP_COUNT} clips (found {len(picks)})")
    # A pick must copy a candidate's window and headline; `why` may add the selection reason.
    candidate_keys = {_clip_key(c) for c in candidates or [] if isinstance(c, dict)}
    seen: set = set()
    for i, pick in enumerate(picks):
        if not isinstance(pick, dict):
            continue
        key = _clip_key(pick)
        if key not in candidate_keys:
            problems.append(f"clipAnalysis[{i}] is not one of the candidateClips (same start, end and headline)")
        elif key in seen:
            problems.append(f"clipAnalysis[{i}] repeats an earlier pick")
        seen.add(key)


def clip_duration_warnings(payload: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    for key in ("candidateClips", "clipAnalysis"):
        for i, clip in enumerate(payload.get(key) or []):
            start, end = _finite(clip.get("start")), _finite(clip.get("end"))
            if start is None or end is None:
                continue
            length = end - start
            if length < CLIP_MIN_SECONDS or length > CLIP_MAX_SECONDS:
                warnings.append(f"{key}[{i}] is {length:.0f}s (expected {CLIP_MIN_SECONDS:.0f}-{CLIP_MAX_SECONDS:.0f}s)")
    return warnings


def seo_warnings(payload: Dict[str, Any]) -> List[str]:
    """Soft SEO rules: reported to the operator and to Cowork, never blocking."""
    warnings = clip_duration_warnings(payload)
    title = payload.get("title")
    if isinstance(title, str) and len(title) > TITLE_MAX_CHARS:
        warnings.append(f"title is {len(title)} characters (keep it to {TITLE_MAX_CHARS})")
    meta = payload.get("metaDescription")
    low, high = META_DESCRIPTION_CHARS
    if isinstance(meta, str) and not low <= len(meta) <= high:
        warnings.append(f"metaDescription is {len(meta)} characters (aim for about 160)")
    highlights = payload.get("highlights")
    low, high = HIGHLIGHT_COUNT
    if isinstance(highlights, list) and not low <= len(highlights) <= high:
        warnings.append(f"highlights has {len(highlights)} entries (expected {low}-{high})")
    return warnings


def movies_warnings(payload: Dict[str, Any]) -> List[str]:
    """Soft movie rules: evidence windows should cover a whole review (60-180 s)."""
    warnings: List[str] = []
    for i, movie in enumerate(payload.get("movies") or []):
        if not isinstance(movie, dict):
            continue
        for j, ev in enumerate(movie.get("evidence") or []):
            length = _window_length(ev)
            if length is not None and not EVIDENCE_MIN_SECONDS <= length <= EVIDENCE_MAX_SECONDS:
                warnings.append(
                    f"movies[{i}].evidence[{j}] is {length:.0f}s "
                    f"(expected {EVIDENCE_MIN_SECONDS:.0f}-{EVIDENCE_MAX_SECONDS:.0f}s)"
                )
    return warnings


def _is_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


_APOSTROPHES = str.maketrans("", "", "'\u2019")


def _spoken_words(text: Any) -> List[str]:
    """Lowercased words with punctuation ignored ("that's" and "thats" are the same word)."""
    lowered = str(text or "").lower().translate(_APOSTROPHES)
    return "".join(ch if ch.isalnum() else " " for ch in lowered).split()


def _window_words(segments: Sequence[Dict[str, Any]], start: float, end: float) -> List[str]:
    """Words of every transcript segment lying inside the window, in time order."""
    inside = []
    for seg in segments:
        seg_start, seg_end = _finite(seg.get("start")), _finite(seg.get("end"))
        if seg_start is None or seg_end is None:
            continue
        if seg_start >= start - BOUNDARY_TOLERANCE_SECONDS and seg_end <= end + BOUNDARY_TOLERANCE_SECONDS:
            inside.append((seg_start, seg_end, seg.get("text")))
    inside.sort(key=lambda item: item[:2])
    return [word for _, _, text in inside for word in _spoken_words(text)]


def _first_missing_word(wanted: Sequence[str], spoken: Sequence[str]) -> Optional[str]:
    """Return the first word of ``wanted`` that ``spoken`` lacks, reading both in order."""
    rest = iter(spoken)
    for word in wanted:
        if word not in rest:  # consumes ``rest`` up to and including the match
            return word
    return None


def validate_shirts(payload: Any, segments: Optional[Sequence[Dict[str, Any]]] = None) -> List[str]:
    """Return problems with a Cowork T-shirt phrase file (empty list when valid).

    Rules from docs/cowork-handoff.md: at most 10 distinct phrases, each with a
    known speaker and origin, and a source only for quotes. When ``segments``
    is given, every window sits on transcript segment boundaries and the
    phrase's words are spoken, in order, inside it.
    """
    boundaries = _Boundaries(segments) if segments else None
    duration = boundaries.duration if boundaries is not None else None
    if not isinstance(payload, dict):
        return ["top level must be an object"]
    problems: List[str] = []
    episode = payload.get("episode")
    if not (isinstance(episode, dict) and _is_text(episode.get("stem"))):
        problems.append("'episode' must be an object with a non-empty string 'stem'")
    if not _is_text(payload.get("generatedAt")):
        problems.append("'generatedAt' must be a non-empty string")
    phrases = payload.get("phrases")
    if not isinstance(phrases, list):
        problems.append("'phrases' must be a list")
        return problems
    if len(phrases) > SHIRT_PHRASE_MAX_COUNT:
        problems.append(f"'phrases' must have at most {SHIRT_PHRASE_MAX_COUNT} phrases (found {len(phrases)})")
    first_seen: Dict[str, int] = {}
    for i, row in enumerate(phrases):
        label = f"phrases[{i}]"
        if not isinstance(row, dict):
            problems.append(f"{label} is not an object")
            continue
        words = _check_shirt_phrase(label, row, first_seen, i, problems)
        _check_shirt_labels(label, row, problems)
        window_problems: List[str] = []
        _check_window(label, row, duration, window_problems, boundaries)
        problems.extend(window_problems)
        if segments and words and not window_problems:
            start, end = float(row["start"]), float(row["end"])
            missing = _first_missing_word(words, _window_words(segments, start, end))
            if missing is not None:
                problems.append(
                    f"{label} words do not appear in order in the transcript between "
                    f"{start:.2f}s and {end:.2f}s (no match for {missing!r})"
                )
    return problems


def _check_shirt_phrase(
    label: str, row: Dict[str, Any], first_seen: Dict[str, int], index: int, problems: List[str]
) -> List[str]:
    """Check the phrase text and return its words (empty when it cannot be checked further)."""
    phrase = row.get("phrase")
    if not _is_text(phrase):
        problems.append(f"{label} needs a non-empty string 'phrase'")
        return []
    words = _spoken_words(phrase)
    if not words:
        problems.append(f"{label} phrase has no words")
        return []
    key = " ".join(phrase.split()).casefold()
    if key in first_seen:
        problems.append(f"{label} repeats phrases[{first_seen[key]}] (phrases must differ, ignoring case)")
    else:
        first_seen[key] = index
    return words


def _check_shirt_labels(label: str, row: Dict[str, Any], problems: List[str]) -> None:
    speaker, origin = row.get("speaker"), row.get("origin")
    if speaker not in SHIRT_SPEAKERS:
        problems.append(f"{label} has unknown speaker {speaker!r} (use {', '.join(SHIRT_SPEAKERS)})")
    if origin not in SHIRT_ORIGINS:
        problems.append(f"{label} has unknown origin {origin!r} (use {', '.join(SHIRT_ORIGINS)})")
    if "source" not in row:
        problems.append(f"{label} is missing 'source' (null unless origin is 'quote')")
    elif origin == "quote":
        if not _is_text(row["source"]):
            problems.append(f"{label} is a quote, so 'source' must name the work it comes from")
    elif origin in SHIRT_ORIGINS and row["source"] is not None:
        problems.append(f"{label} has origin {origin!r}, so 'source' must be null")
    if not _is_text(row.get("why")):
        problems.append(f"{label} needs a non-empty string 'why'")


def shirts_warnings(payload: Dict[str, Any]) -> List[str]:
    """Soft T-shirt phrase rules: printed by the validator, never a failure."""
    warnings: List[str] = []
    for i, row in enumerate(payload.get("phrases") or []):
        if not isinstance(row, dict):
            continue
        phrase = row.get("phrase")
        if isinstance(phrase, str) and len(phrase) > SHIRT_PHRASE_MAX_CHARS:
            warnings.append(f"phrases[{i}] phrase is {len(phrase)} characters (keep it to {SHIRT_PHRASE_MAX_CHARS})")
        length = _window_length(row)
        if length is not None and length > SHIRT_WINDOW_MAX_SECONDS:
            warnings.append(f"phrases[{i}] window is {length:.0f}s (keep it to {SHIRT_WINDOW_MAX_SECONDS:.0f}s)")
    return warnings


# --------------------------------------------------------------------------- state

def state_path(config: Dict[str, Any]) -> Path:
    return cowork_dir(config) / "state.json"


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def _seed_state(config: Dict[str, Any]) -> Dict[str, Any]:
    """First run: treat episodes that already have SEO output as done."""
    output_dir = Path(config.get("paths", {}).get("output_dir", "./output")).expanduser()
    seo_dir = Path(config.get("paths", {}).get("seo_dir", output_dir / "seo")).expanduser()
    episodes: Dict[str, Any] = {}
    for path in sorted(seo_dir.glob("*.seo.json")):
        stem = path.name[: -len(".seo.json")]
        if "." in stem:  # e.g. 20260713.seo.pre-budget-fix.json
            continue
        episodes[stem] = {"status": STATUS_DONE, "updatedAt": _now(), "note": "seeded from existing output"}
    return {"version": 1, "episodes": episodes}


def load_state(config: Dict[str, Any]) -> Dict[str, Any]:
    path = state_path(config)
    if not path.is_file():
        return _seed_state(config)
    with path.open(encoding="utf-8") as f:
        state = json.load(f)
    state.setdefault("version", 1)
    state.setdefault("episodes", {})
    return state


def save_state(config: Dict[str, Any], state: Dict[str, Any]) -> None:
    path = state_path(config)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".state.", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def episode_status(config: Dict[str, Any], stem: str) -> Optional[str]:
    return load_state(config)["episodes"].get(stem, {}).get("status")


def mark_episode(config: Dict[str, Any], stem: str, status: str, **fields: Any) -> None:
    state = load_state(config)
    entry = dict(state["episodes"].get(stem, {}))
    entry.update({k: v for k, v in fields.items() if v is not None})
    if status != STATUS_AWAITING:
        entry.pop("lastError", None)
    entry["status"] = status
    entry["updatedAt"] = _now()
    state["episodes"][stem] = entry
    save_state(config, state)


def awaiting(config: Dict[str, Any]) -> List[str]:
    return sorted(
        stem for stem, entry in load_state(config)["episodes"].items()
        if entry.get("status") == STATUS_AWAITING
    )
