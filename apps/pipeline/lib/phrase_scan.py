"""Find phrases that recur across BBPC episodes: catchphrases, running gags, drops.

A deterministic scan of every transcript, meant to be re-run whenever more
transcripts are backfilled. It surfaces candidates with the evidence for each
(how many episodes, when, a burst of consecutive episodes, examples with
timestamps). Whether a phrase is T-shirt material, and whether it is an
original or a movie quote, is left to a person or Cowork.

How it works:

1. Tokenize each ``<YYYYMMDD>.json`` transcript into lowercase words.
2. For each phrase length from 2 to ``max_words``, count how many episodes
   contain each phrase. A phrase is counted only if both of its shorter
   sub-phrases were frequent, which keeps memory bounded as the archive grows.
3. Phrases still frequent at ``max_words`` are pre-recorded drops or rituals
   (intros, disclaimers); overlapping ones are stitched into one *passage*.
   Each passage is the text its episodes share, credited only to episodes
   that contain it, so versions of a drop with different endings stay apart.
4. Shorter phrases are kept only in their longest form, and only if they are
   distinctive: *fixed* (the phrase accounts for a large share of the episodes
   its rarest content word appears in, and that word is not in most episodes)
   or a *burst* (concentrated in a run of consecutive episodes). Phrases whose
   words are all in most episodes are *staples*: the scan has no outside
   English baseline, so "we ride together" and "next week" look alike there,
   and staples are listed separately for a one-time human review.
5. Phrases with numbers, starting or ending on a function word, or with fewer
   than two content words are skipped, as are filler passages.

Standard library only, so it runs without the pipeline venv.
"""
from __future__ import annotations

import bisect
import datetime as _dt
import json
import os
import re
import tempfile
from array import array
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

RESULT_VERSION = 1
TRANSCRIPT_NAME = re.compile(r"^(\d{8})\.json$")
_TOKEN = re.compile(r"[A-Za-z0-9]+(?:['\u2019][A-Za-z]+)*")

# Function words and filler. A listed phrase needs at least two other words.
STOPWORDS = frozenset("""
a an the and or but if so of to in on at for with from by as into onto about over under up down out off
is are was were be been being am do does did doing done have has had having will would could should can
may might must shall i me my mine we us our you your yours he him his she her hers it its they them their
this that these those there here what which who whom whose when where why how all any both each few more
most other some such no nor not only own same than too very just now then also even still again ever
s t d ll m re ve don didn doesn isn wasn aren weren won wouldn couldn shouldn can't cannot
i'm i've i'll i'd you're you've you'll you'd he's she's it's we're we've we'll we'd they're they've
they'll they'd that's there's here's what's who's let's don't didn't doesn't isn't wasn't aren't
weren't won't wouldn't couldn't shouldn't haven't hasn't hadn't ain't
oh uh um uhm hmm ah eh yeah yep yes nope okay ok like know think mean right well really actually
gonna wanna gotta kinda sorta thing things stuff something anything nothing everything lot little
get got go going goes went gone say said says see saw look looking want wanted one two
""".split())
# A phrase may not start or end with these: it would be a fragment of a longer sentence.
EDGE_WORDS = frozenset("""
a an the and or but so of to in on at for with from by as that than if because into about
""".split())


@dataclass
class ScanOptions:
    min_episodes: int = 4        # a phrase must appear in at least this many episodes
    max_words: int = 8           # recurring phrases this long are passages (drops, rituals)
    common_share: float = 0.6    # a word in more than this share of episodes is everywhere
    fixed_share: float = 0.3     # phrase episodes / episodes of its rarest content word
    burst_window: int = 20       # consecutive episodes considered for a burst
    burst_min: int = 5           # episodes inside the window needed for a burst
    burst_lift: float = 3.0      # window rate / overall rate needed for a burst
    subsume_ratio: float = 0.8   # hide a phrase if a longer one has this share of its episodes
    drop_share: float = 0.8      # hide a phrase if this share of its uses sit inside passages
    title_share: float = 0.6     # share of title-cased uses that marks a likely title
    examples: int = 3
    ignore_file: Optional[Path] = None


@dataclass
class _Tokens:
    words: List[str]                  # lowercase
    original: List[str]
    spans: List[Tuple[int, int]]      # character offsets into text
    segment: List[int]                # segment index of each token
    text: str
    segments: List[Dict[str, Any]] = field(default_factory=list)


# --------------------------------------------------------------------------- input

def transcript_files(transcripts_dir: Path) -> List[Tuple[str, Path]]:
    """Dated transcripts only (``20260914.json``); engine variants and tests are skipped."""
    rows = []
    for path in Path(transcripts_dir).iterdir():
        match = TRANSCRIPT_NAME.match(path.name)
        if match and path.is_file():
            rows.append((match.group(1), path))
    return sorted(rows)


def _normalize(token: str) -> str:
    return token.lower().replace("\u2019", "'")


def _tokens(path: Path) -> _Tokens:
    with path.open(encoding="utf-8") as f:
        segments = json.load(f)
    if isinstance(segments, dict):
        segments = segments.get("segments", [])
    parts, starts, offset = [], [], 0
    for seg in segments:
        text = str(seg.get("text") or "")
        starts.append(offset)
        parts.append(text)
        offset += len(text) + 1
    text = " ".join(parts)
    toks = _Tokens([], [], [], [], text, list(segments))
    for match in _TOKEN.finditer(text):
        toks.original.append(match.group(0))
        toks.words.append(_normalize(match.group(0)))
        toks.spans.append(match.span())
        toks.segment.append(bisect.bisect_right(starts, match.start()) - 1)
    return toks


def _ignored(options: ScanOptions) -> Set[str]:
    path = Path(options.ignore_file) if options.ignore_file else None
    if not path or not path.is_file():
        return set()
    return {" ".join(_normalize(t) for t in _TOKEN.findall(line))
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")}


# --------------------------------------------------------------------------- counting

def _count_levels(episodes: Sequence[array], vocab_size: int, options: ScanOptions):
    """Episode counts of frequent phrases per length, and where each frequent phrase starts."""
    df: Dict[int, Dict[tuple, int]] = {}
    ok: Dict[int, List[bytearray]] = {}

    pairs: Counter = Counter()
    for ids in episodes:
        pairs.update({ids[i] * vocab_size + ids[i + 1] for i in range(len(ids) - 1)})
    df[2] = {divmod(k, vocab_size): c for k, c in pairs.items() if c >= options.min_episodes}
    del pairs
    ok[2] = [bytearray((ids[i], ids[i + 1]) in df[2] for i in range(len(ids) - 1)) for ids in episodes]

    for n in range(3, options.max_words + 1):
        prev = ok[n - 1]
        counts: Counter = Counter()
        for e, ids in enumerate(episodes):
            p = prev[e]
            counts.update({tuple(ids[i:i + n]) for i in range(len(ids) - n + 1) if p[i] and p[i + 1]})
        level = {g: c for g, c in counts.items() if c >= options.min_episodes}
        del counts
        df[n] = level
        ok[n] = [bytearray(bool(prev[e][i] and prev[e][i + 1] and tuple(ids[i:i + n]) in level)
                           for i in range(len(ids) - n + 1))
                 for e, ids in enumerate(episodes)]
    return df, ok


def _maximal(df: Dict[int, Dict[tuple, int]], options: ScanOptions, listable) -> Dict[tuple, int]:
    """Phrases shorter than ``max_words`` that no longer phrase covers for most of their episodes.

    A longer phrase covers a shorter one only if it is itself represented: it is
    listable, a passage (``max_words`` long), or covered in turn. Otherwise
    "the pain train", dropped for its edge word, would hide "pain train".
    Lengths are processed longest first so coverage chains through.
    """
    covered: Set[tuple] = set()
    for n in range(options.max_words, 2, -1):
        shorter = df[n - 1]
        for gram, count in df[n].items():
            if n < options.max_words and gram not in covered and not listable(gram):
                continue
            for sub in (gram[:-1], gram[1:]):
                if sub in shorter and count >= options.subsume_ratio * shorter[sub]:
                    covered.add(sub)
    return {g: c for n in range(2, options.max_words) for g, c in df[n].items() if g not in covered}


# --------------------------------------------------------------------------- scan

def scan(transcripts_dir: Path, options: Optional[ScanOptions] = None) -> Dict[str, Any]:
    options = options or ScanOptions()
    files = transcript_files(Path(transcripts_dir))
    vocab: Dict[str, int] = {}
    episodes: List[array] = []
    for _, path in files:
        episodes.append(array("I", (vocab.setdefault(w, len(vocab)) for w in _tokens(path).words)))
    stems = [stem for stem, _ in files]
    n_eps = len(episodes)

    result: Dict[str, Any] = {
        "version": RESULT_VERSION,
        "scannedAt": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat(),
        "transcripts": n_eps,
        "firstStem": stems[0] if stems else None,
        "lastStem": stems[-1] if stems else None,
        "options": {k: (str(v) if isinstance(v, Path) else v) for k, v in asdict(options).items()},
        "phrases": [],
        "passages": [],
    }
    if n_eps == 0:
        return result

    word_df: Counter = Counter()
    for ids in episodes:
        word_df.update(set(ids))
    words_by_id = {i: w for w, i in vocab.items()}
    df, ok = _count_levels(episodes, len(vocab), options)
    ignored = _ignored(options)

    def listable(gram: tuple) -> bool:
        ws = [words_by_id[i] for i in gram]
        return (ws[0] not in EDGE_WORDS and ws[-1] not in EDGE_WORDS
                and sum(w not in STOPWORDS for w in ws) >= 2
                and not any(w[0].isdigit() for w in ws))  # scores, budgets, runtimes, phone numbers

    candidates: Dict[tuple, Dict[str, Any]] = {}
    for gram, count in _maximal(df, options, listable).items():
        if not listable(gram):
            continue
        ws = [words_by_id[i] for i in gram]
        phrase = " ".join(ws)
        if phrase in ignored:
            continue
        rarest = min(word_df[vocab[w]] for w in ws if w not in STOPWORDS)
        typical = count >= options.fixed_share * rarest      # the phrase is how its rarest word is used
        everywhere = rarest > options.common_share * n_eps   # ...but that word is in most episodes
        candidates[gram] = {"phrase": phrase, "rarest": rarest,
                            "fixed": typical and not everywhere, "staple": typical and everywhere}

    occurrences, passages = _locate(files, episodes, ok, candidates, options, ignored)

    phrases = []
    for gram, info in candidates.items():
        occ = occurrences.get(gram)
        if not occ or occ["inPassage"] >= options.drop_share * occ["uses"]:
            continue
        eps = sorted(occ["first"])
        burst = _burst(eps, n_eps, options)
        reasons = ([r for r in ("fixed", "staple") if info[r]]) + (["burst"] if burst else [])
        if not reasons:
            continue
        phrases.append({
            "phrase": info["phrase"],
            "words": len(gram),
            "episodes": len(eps),
            "uses": occ["uses"],
            "firstStem": stems[eps[0]],
            "lastStem": stems[eps[-1]],
            "fixedShare": round(len(eps) / info["rarest"], 2),
            "burst": None if not burst else {
                "count": burst[0], "window": min(options.burst_window, n_eps), "lift": burst[1],
                "fromStem": stems[burst[2]], "toStem": stems[burst[3]],
            },
            "looksLikeTitle": occ["titleCase"] >= options.title_share * occ["uses"],
            "reasons": reasons,
            "stems": [stems[e] for e in eps],
            "_examples": _pick_examples(occ["first"], options.examples),
        })
    phrases.sort(key=lambda p: (-p["episodes"], p["phrase"]))
    _attach_examples(files, phrases)
    result["phrases"] = phrases
    result["passages"] = [
        {"text": p["text"], "episodes": len(p["eps"]), "firstStem": stems[p["eps"][0]],
         "lastStem": stems[p["eps"][-1]], "stems": [stems[e] for e in p["eps"]]}
        for p in passages
    ]
    return result


def _burst(eps: Sequence[int], n_eps: int, options: ScanOptions):
    """Best run within ``burst_window`` consecutive episodes: (count, lift, first, last) or None."""
    window = min(options.burst_window, n_eps)
    best, best_lo, best_hi, lo = 0, 0, 0, 0
    for hi in range(len(eps)):
        while eps[hi] - eps[lo] >= window:
            lo += 1
        if hi - lo + 1 > best:
            best, best_lo, best_hi = hi - lo + 1, lo, hi
    lift = (best / window) / (len(eps) / n_eps)
    if best >= options.burst_min and lift >= options.burst_lift:
        return best, round(lift, 1), eps[best_lo], eps[best_hi]
    return None


def _locate(files, episodes, ok, candidates, options, ignored=frozenset()):
    """Second pass: where each candidate occurs, its casing, and the recurring passages."""
    by_len: Dict[int, Set[tuple]] = defaultdict(set)
    for gram in candidates:
        by_len[len(gram)].add(gram)
    top = options.max_words
    occurrences: Dict[tuple, Dict[str, Any]] = {}
    runs = []  # one per stretch of consecutive recurring top-length phrases
    for e, ((_, path), ids) in enumerate(zip(files, episodes)):
        toks = _tokens(path)
        covered = bytearray(len(ids))
        top_ok = ok[top][e]
        i = 0
        while i < len(top_ok):
            if not top_ok[i]:
                i += 1
                continue
            first = i
            while i < len(top_ok) and top_ok[i]:
                i += 1
            end = i - 1 + top
            covered[first:end] = b"\x01" * (end - first)
            base = toks.spans[first][0]
            runs.append({
                "e": e,
                "ids": tuple(ids[first:end]),
                "words": toks.words[first:end],
                "text": toks.text[base:toks.spans[end - 1][1]],
                "spans": [(a - base, b - base) for a, b in toks.spans[first:end]],
            })
        for n, grams in by_len.items():
            level = ok[n][e]
            for i in range(len(level)):
                if not level[i]:
                    continue
                gram = tuple(ids[i:i + n])
                if gram not in grams:
                    continue
                occ = occurrences.setdefault(gram, {"uses": 0, "inPassage": 0, "titleCase": 0, "first": {}})
                occ["uses"] += 1
                occ["inPassage"] += all(covered[i:i + n])
                occ["titleCase"] += all(o[:1].isupper() for o, w in zip(toks.original[i:i + n], toks.words[i:i + n])
                                        if w not in STOPWORDS)
                occ["first"].setdefault(e, i)
    return occurrences, _group_passages(runs, top, options.min_episodes, ignored)


def _group_passages(runs, top: int, min_episodes: int, ignored=frozenset()) -> List[Dict[str, Any]]:
    """Turn runs of recurring text into passages, each with the episodes that contain it.

    Runs that share a top-length phrase are versions of the same drop, but
    versions can differ (a shared opening, different endings). So each group
    reports the text its episodes share, and only the episodes whose run
    contains that exact text; the rest of the group is grouped again.
    """
    parent: Dict[tuple, tuple] = {}

    def find(g):
        parent.setdefault(g, g)
        while parent[g] != g:
            parent[g] = parent[parent[g]]
            g = parent[g]
        return g

    def grams(run):
        ids = run["ids"]
        return [ids[k:k + top] for k in range(len(ids) - top + 1)]

    for run in runs:
        gs = grams(run)
        for g in gs[1:]:
            parent[find(g)] = find(gs[0])
    groups: Dict[tuple, List] = defaultdict(list)
    for run in runs:
        groups[find(grams(run)[0])].append(run)

    passages = []
    for members in groups.values():
        while len({r["e"] for r in members}) >= min_episodes:
            passage, members = _shared_passage(members, grams)
            if passage is None:
                break
            words = passage["words"]
            if " ".join(words) in ignored:
                continue
            if sum(w not in STOPWORDS for w in words) < 2:
                continue  # filler such as "you know what I mean, yeah yeah"
            passages.append(passage)
    passages.sort(key=lambda p: (-len(p["eps"]), p["text"]))
    return passages


def _contains(seq: tuple, sub: tuple) -> bool:
    n = len(sub)
    return any(seq[i:i + n] == sub for i in range(len(seq) - n + 1))


def _shared_passage(members, grams):
    """The text most of ``members`` share, the episodes containing it, and the leftover runs."""
    eps_of: Dict[tuple, Set[int]] = defaultdict(set)
    for run in members:
        for g in grams(run):
            eps_of[g].add(run["e"])
    best = max(len(v) for v in eps_of.values())
    # Display from the latest episode's version that has a most-shared phrase.
    rep = max((r for r in members if any(len(eps_of[g]) == best for g in grams(r))),
              key=lambda r: (r["e"], len(r["ids"])))
    rep_grams = grams(rep)
    core = next(k for k, g in enumerate(rep_grams) if len(eps_of[g]) == best)
    shared = eps_of[rep_grams[core]]
    lo = hi = core
    while lo > 0 and eps_of[rep_grams[lo - 1]] >= shared:
        lo -= 1
    while hi + 1 < len(rep_grams) and eps_of[rep_grams[hi + 1]] >= shared:
        hi += 1
    top = len(rep_grams[0])
    first, last = lo, hi + top - 1
    ids = rep["ids"][first:last + 1]
    inside = [r for r in members if _contains(r["ids"], ids)]
    rest = [r for r in members if not _contains(r["ids"], ids)]
    text = rep["text"][rep["spans"][first][0]:rep["spans"][last][1]]
    return ({"text": " ".join(text.split()), "eps": sorted({r["e"] for r in inside}),
             "words": rep["words"][first:last + 1]}, rest)


def _pick_examples(first_by_episode: Dict[int, int], count: int) -> List[Tuple[int, int]]:
    """First use in the earliest, a middle, and the latest episode."""
    eps = sorted(first_by_episode)
    if len(eps) > count:
        eps = sorted({eps[round(k * (len(eps) - 1) / max(count - 1, 1))] for k in range(count)})
    return [(e, first_by_episode[e]) for e in eps]


def _attach_examples(files, phrases) -> None:
    wanted: Dict[int, List[Tuple[Dict[str, Any], int]]] = defaultdict(list)
    for phrase in phrases:
        for e, i in phrase.pop("_examples"):
            wanted[e].append((phrase, i))
        phrase["examples"] = []
    for e in sorted(wanted):
        stem, path = files[e]
        toks = _tokens(path)
        for phrase, i in wanted[e]:
            segs = toks.segments[toks.segment[i]:toks.segment[i + phrase["words"] - 1] + 1]
            phrase["examples"].append({
                "stem": stem,
                "start": float(segs[0].get("start") or 0.0),
                "text": " ".join(" ".join(str(s.get("text") or "") for s in segs).split()),
            })


# --------------------------------------------------------------------------- re-runs and output

def compare(previous: Optional[Dict[str, Any]], current: Dict[str, Any]) -> Dict[str, Any]:
    """Phrases new since ``previous``, and phrases now seen in more episodes."""
    before = {p["phrase"]: p["episodes"] for p in (previous or {}).get("phrases", [])}
    new, grown = [], {}
    for p in current["phrases"]:
        if p["phrase"] not in before:
            new.append(p["phrase"])
        elif p["episodes"] > before[p["phrase"]]:
            grown[p["phrase"]] = [before[p["phrase"]], p["episodes"]]
    return {"previousScan": (previous or {}).get("scannedAt"),
            "previousTranscripts": (previous or {}).get("transcripts"), "new": new, "grown": grown}


def write_outputs(out_dir: Path, result: Dict[str, Any], top: int = 100) -> Dict[str, Any]:
    """Write ``recurring-phrases.json`` and ``.md``; return the changes since the previous scan."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "recurring-phrases.json"
    previous = json.loads(json_path.read_text(encoding="utf-8")) if json_path.is_file() else None
    result["changes"] = compare(previous, result)
    _atomic_write(json_path, json.dumps(result, indent=1, ensure_ascii=False) + "\n")
    _atomic_write(out_dir / "recurring-phrases.md", render_markdown(result, top))
    return result["changes"]


def _atomic_write(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def _line(p: Dict[str, Any]) -> str:
    ex = p["examples"][-1] if p.get("examples") else None
    where = f' — "{ex["text"][:120]}" ({ex["stem"]} {_clock(ex["start"])})' if ex else ""
    burst = ""
    if p.get("burst"):
        b = p["burst"]
        burst = f', burst {b["count"]} of {b["window"]} eps {b["fromStem"]}–{b["toStem"]}'
    return f'- **{p["phrase"]}**: {p["episodes"]} eps, {p["firstStem"]}–{p["lastStem"]}{burst}{where}'


def render_markdown(result: Dict[str, Any], top: int = 100) -> str:
    phrases = result["phrases"]
    spoken = [p for p in phrases if not p["looksLikeTitle"]]
    catchphrases = [p for p in spoken if "fixed" in p["reasons"]]
    staples = [p for p in spoken if "staple" in p["reasons"]]
    gags = sorted((p for p in spoken if p["burst"]), key=lambda p: (-p["burst"]["count"], -p["burst"]["lift"]))
    titles = [p for p in phrases if p["looksLikeTitle"]]
    changes = result.get("changes") or {}
    out = [
        "# Recurring phrases",
        "",
        f'{result["transcripts"]} transcripts ({result["firstStem"]}–{result["lastStem"]}), '
        f'scanned {result["scannedAt"]} by `scripts/scan_phrases.py`. Full data: '
        "`recurring-phrases.json`. These are candidates: whether a phrase is original or a "
        "movie quote, and whether it belongs on a shirt, is a human call. Add reviewed noise "
        "to `ignore.txt` beside this file.",
        "",
    ]
    if changes.get("previousScan"):
        by_phrase = {p["phrase"]: p for p in phrases}
        out += [f'## New since the last scan ({changes["previousTranscripts"]} transcripts then)', ""]
        out += [_line(by_phrase[x]) for x in changes["new"][:top]] or ["- no new phrases"]
        out += [f"- {x}: {a} → {b} eps" for x, (a, b) in list(changes["grown"].items())[:top]]
        out.append("")
    out += ["## Catchphrases (most episodes)", ""] + [_line(p) for p in catchphrases[:top]] + [""]
    out += ["## Running gags (bursts)", ""] + [_line(p) for p in gags[:top]] + [""]
    out += ["## Recurring passages (drops and rituals)", ""]
    out += [f'- {p["episodes"]} eps, {p["firstStem"]}–{p["lastStem"]}: "{p["text"][:300]}"'
            for p in result["passages"][:top]] + [""]
    out += ["## Staples (review once)", "",
            "Phrases made only of words found in most episodes. The scan can't tell show "
            "staples (\"we ride together\") from ordinary English (\"next week\"); add the "
            "ordinary ones to `ignore.txt`.", ""]
    out += [_line(p) for p in staples[:top]] + [""]
    out += ["## Likely titles and names", ""] + [_line(p) for p in titles[:top]] + [""]
    return "\n".join(out)
