"""Transcription utilities for the podcast pipeline.

This module wraps the standalone `transcribe.py` script so the pipeline can
import and reuse the logic without duplicating code.
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterable, List, Mapping, Optional, Tuple, Union

logger = logging.getLogger(__name__)

ENGINE_PARAKEET = "parakeet"
ENGINE_FASTER_WHISPER = "faster-whisper"
DEFAULT_ENGINE = ENGINE_PARAKEET
DEFAULT_MODELS = {
    ENGINE_PARAKEET: "mlx-community/parakeet-tdt-0.6b-v2",
    ENGINE_FASTER_WHISPER: "large-v3-turbo",
}
_MODEL_SETTING_KEYS = {ENGINE_PARAKEET: "parakeet_model", ENGINE_FASTER_WHISPER: "whisper_model"}
# Parakeet transcribes long audio in overlapping chunks that it merges itself.
PARAKEET_CHUNK_SECONDS = 120.0
PARAKEET_OVERLAP_SECONDS = 15.0

# Parakeet segments longer than this are split at their largest word gaps.
MAX_SEGMENT_SECONDS = 15.0
# Prefer split points that leave at least this much audio on each side.
MIN_SPLIT_PART_SECONDS = 2.0
_SENTENCE_END = (".", "!", "?", ",", ";", ":")

# Trailing-silence detection for the coverage gate (ffmpeg silencedetect).
SILENCE_NOISE_DB = -50
SILENCE_MIN_SECONDS = 5.0
SILENCE_WINDOW_SECONDS = 600.0
# How close to the end of speech a transcript must reach to count as finished.
SPEECH_END_TOLERANCE_SECONDS = 5.0

_MODEL_CACHE: Any = None
_MODEL_KEY: Optional[Tuple[str, str]] = None


def _format_seconds(total_seconds: float) -> str:
    total_seconds = int(total_seconds)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def _probe_audio_duration(audio_path: Path) -> Optional[float]:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(audio_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return float(result.stdout.strip())
    except (FileNotFoundError, subprocess.CalledProcessError, ValueError):
        logger.warning("Unable to probe duration for %s", audio_path)
        return None


def _load_partial_transcript(path: Path) -> Tuple[Optional[List[dict]], Optional[float]]:
    if not path.is_file():
        return None, None
    try:
        with path.open() as f:
            data = json.load(f)
        if not isinstance(data, list) or not data:
            return None, None
        for segment in data:
            if not isinstance(segment, dict) or "start" not in segment or "end" not in segment:
                return None, None
        return data, data[-1]["end"]
    except (json.JSONDecodeError, KeyError, TypeError):
        logger.warning("Existing transcript %s could not be parsed; ignoring", path)
        return None, None


def _extract_audio_tail(audio_path: Path, start_seconds: float, output_path: Path) -> bool:
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                str(start_seconds),
                "-i",
                str(audio_path),
                "-acodec",
                "copy",
                str(output_path),
            ],
            check=True,
            capture_output=True,
        )
        return output_path.is_file()
    except (FileNotFoundError, subprocess.CalledProcessError):
        logger.exception("ffmpeg failed while extracting tail starting at %s", start_seconds)
        return False


def engine_from_settings(settings: Mapping[str, Any]) -> Tuple[str, str]:
    """Return (engine, model_name) from config settings."""
    engine = str(settings.get("transcription_engine") or DEFAULT_ENGINE).strip().lower()
    if engine not in DEFAULT_MODELS:
        raise ValueError(
            f"Unknown transcription_engine '{engine}'; expected one of: {', '.join(sorted(DEFAULT_MODELS))}"
        )
    return engine, str(settings.get(_MODEL_SETTING_KEYS[engine]) or DEFAULT_MODELS[engine])


def _get_model(engine: str, model_name: str) -> Any:
    global _MODEL_CACHE, _MODEL_KEY
    if _MODEL_CACHE is None or _MODEL_KEY != (engine, model_name):
        logger.info("Loading %s model '%s'...", engine, model_name)
        if engine == ENGINE_PARAKEET:
            # MLX only runs on Apple Silicon, so import it only when selected.
            from parakeet_mlx import from_pretrained

            _MODEL_CACHE = from_pretrained(model_name)
        else:
            from faster_whisper import WhisperModel

            _MODEL_CACHE = WhisperModel(model_name, device="cpu", compute_type="int8")
        _MODEL_KEY = (engine, model_name)
    return _MODEL_CACHE


def _tokens_in_text_order(text: str, tokens: List[Any]) -> Optional[List[Any]]:
    """Reorder *tokens* to spell *text*, or return None if they cannot.

    parakeet-mlx sorts a sentence's tokens by start time, which misplaces tokens
    that share a frame (often punctuation); the sentence text keeps the true order.
    """
    remaining = list(tokens)
    ordered: List[Any] = []
    position = 0
    while remaining:
        matches = [t for t in remaining if t.text and text.startswith(t.text, position)]
        if not matches:
            return None
        token = min(matches, key=lambda t: (t.start, -len(t.text)))
        ordered.append(token)
        remaining.remove(token)
        position += len(token.text)
    return ordered if text[position:].strip() == "" else None


def _tokens_to_words(tokens: Iterable[Any]) -> List[dict]:
    """Merge Parakeet sub-word tokens (in text order) into words; a leading space starts a word."""
    words: List[dict] = []
    for token in tokens:
        if not words or token.text.startswith(" "):
            words.append({"start": token.start, "end": token.end, "text": token.text.strip()})
        else:
            # Frame-sharing tokens can carry out-of-order times; keep the word's span.
            words[-1]["start"] = min(words[-1]["start"], token.start)
            words[-1]["end"] = max(words[-1]["end"], token.end)
            words[-1]["text"] += token.text
    return [
        {"start": round(w["start"], 3), "end": round(w["end"], 3), "text": w["text"]}
        for w in words
        if w["text"]
    ]


def _enforce_forward_timing(words: List[dict], floor: float) -> float:
    """Clamp word times so each word starts at or after the previous word ends.

    A few Parakeet tokens carry times seconds too early; the Convex importer
    rejects segments that start before the previous one. Returns the new floor.
    """
    for word in words:
        word["start"] = max(word["start"], floor)
        word["end"] = max(word["end"], word["start"])
        floor = word["end"]
    return floor


def _segment_from_words(words: List[dict]) -> dict:
    return {
        "start": words[0]["start"],
        "end": words[-1]["end"],
        "text": " " + " ".join(w["text"] for w in words),
        "words": words,
    }


def _best_split_index(words: List[dict]) -> int:
    """Pick the word index to split before: widest gap, then punctuation, then balance."""
    first, last = words[0]["start"], words[-1]["end"]
    middle = (first + last) / 2
    candidates = range(1, len(words))
    balanced = [
        i for i in candidates
        if words[i - 1]["end"] - first >= MIN_SPLIT_PART_SECONDS
        and last - words[i]["start"] >= MIN_SPLIT_PART_SECONDS
    ]
    return max(
        balanced or candidates,
        key=lambda i: (
            round(words[i]["start"] - words[i - 1]["end"], 2),
            words[i - 1]["text"].endswith(_SENTENCE_END),
            -abs(words[i]["start"] - middle),
        ),
    )


def _split_long_segment(segment: dict, max_seconds: float = MAX_SEGMENT_SECONDS) -> List[dict]:
    """Split a segment with word timings until no part is longer than *max_seconds*."""
    words = segment.get("words") or []
    if segment["end"] - segment["start"] <= max_seconds or len(words) < 2:
        return [segment]
    cut = _best_split_index(words)
    return (
        _split_long_segment(_segment_from_words(words[:cut]), max_seconds)
        + _split_long_segment(_segment_from_words(words[cut:]), max_seconds)
    )


def _transcribe_segments(
    model: Any,
    engine: str,
    audio_path: Path,
    on_chunk: Optional[Callable[[int, int], None]] = None,
) -> Iterable[Any]:
    """Yield segments with start/end/text relative to *audio_path*."""
    if engine == ENGINE_PARAKEET:
        result = model.transcribe(
            str(audio_path),
            chunk_duration=PARAKEET_CHUNK_SECONDS,
            overlap_duration=PARAKEET_OVERLAP_SECONDS,
            chunk_callback=on_chunk,
        )
        segments: List[dict] = []
        floor = 0.0
        for sentence in result.sentences:
            if not sentence.text.strip():
                continue
            tokens = _tokens_in_text_order(sentence.text, list(getattr(sentence, "tokens", None) or []))
            words = _tokens_to_words(tokens) if tokens else []
            if words:
                floor = _enforce_forward_timing(words, floor)
                segments.extend(_split_long_segment(_segment_from_words(words)))
            else:
                # Leading space matches the Whisper segment text convention.
                start = max(sentence.start, floor)
                end = max(sentence.end, start)
                floor = end
                segments.append({"start": start, "end": end, "text": " " + sentence.text.strip()})
        return [SimpleNamespace(**segment) for segment in segments]
    segments, info = model.transcribe(str(audio_path), beam_size=5, log_progress=True)
    logger.info("Detected language: %s (p=%.2f)", info.language, info.language_probability)
    return segments


def _write_progress(progress_path: Optional[Path], position: float, duration: Optional[float]) -> None:
    if not progress_path or not duration:
        return
    pct = min(position / duration * 100, 100)
    try:
        progress_path.write_text(
            f"{pct:.2f}\t{_format_seconds(position)} / {_format_seconds(duration)}\n", encoding="utf-8"
        )
    except OSError:
        pass


def _parse_silences(stderr: str) -> List[Tuple[float, Optional[float]]]:
    """Return (start, end) pairs from ffmpeg silencedetect output; end is None if unterminated."""
    silences: List[Tuple[float, Optional[float]]] = []
    for match in re.finditer(r"silence_(start|end): (-?[0-9.]+)", stderr):
        kind, value = match.group(1), float(match.group(2))
        if kind == "start":
            silences.append((value, None))
        elif silences and silences[-1][1] is None:
            silences[-1] = (silences[-1][0], value)
    return silences


def _detect_speech_end(audio_path: Path, duration: float) -> float:
    """Return where speech ends: the start of trailing silence, else *duration*.

    Scans the last SILENCE_WINDOW_SECONDS and widens the window while the
    whole window is silent. Any ffmpeg failure falls back to *duration*.
    """
    window = min(SILENCE_WINDOW_SECONDS, duration)
    while True:
        offset = max(0.0, duration - window)
        try:
            result = subprocess.run(
                [
                    "ffmpeg", "-hide_banner", "-nostdin",
                    "-ss", f"{offset:.3f}", "-i", str(audio_path),
                    "-af", f"silencedetect=noise={SILENCE_NOISE_DB}dB:d={SILENCE_MIN_SECONDS}",
                    "-f", "null", "-",
                ],
                capture_output=True,
                text=True,
            )
        except FileNotFoundError:
            logger.warning("ffmpeg not found; coverage uses the full file duration")
            return duration
        if result.returncode != 0:
            logger.warning("Silence detection failed for %s; coverage uses the full file duration", audio_path)
            return duration
        silences = _parse_silences(result.stderr)
        if not silences:
            return duration
        start, end = silences[-1]
        # Timestamps are relative to the seek offset; a trailing silence reaches EOF.
        if end is not None and end < (duration - offset) - 1.0:
            return duration
        if start <= 0.5 and offset > 0:
            window = min(window * 2, duration)
            continue
        return offset + max(start, 0.0)


def _require_complete_transcript(
    transcript: List[dict],
    duration: Optional[float],
    speech_end: Optional[float] = None,
) -> None:
    """Conservative coverage gate before automatic publication; keep failed files for review.

    Coverage is measured against *speech_end* (where trailing silence starts)
    when given, so silent tails do not fail complete transcripts. Timestamps
    are still checked against the real *duration*.
    """
    if duration is None or not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("Cannot confirm transcript completion: source audio duration is unavailable.")
    if not transcript:
        raise RuntimeError("Cannot import an empty transcript.")
    previous_start = -1.0
    for segment in transcript:
        end = segment.get("end")
        if isinstance(end, bool) or not isinstance(end, (int, float)) or not math.isfinite(end) or end < 0 or end > duration:
            raise RuntimeError("Transcript timestamps exceed the audio duration or are invalid; review the saved file before importing.")
        start = segment.get("start")
        if isinstance(start, (int, float)) and not isinstance(start, bool):
            # The Convex importer rejects segments that start before the previous one.
            if start < previous_start:
                raise RuntimeError("Transcript segment starts are out of order; review the saved file before importing.")
            previous_start = start
    effective = duration
    if speech_end is not None and math.isfinite(speech_end) and 0 < speech_end < duration:
        effective = speech_end
    if transcript[-1]["end"] < effective * 0.95:
        raise RuntimeError(
            "Transcript covers less than 95% of the source audio "
            f"(ends {transcript[-1]['end']:.1f}s, speech ends {effective:.1f}s); review the saved file before importing."
        )


def run(
    episode_path: str,
    *,
    output_path: str,
    resume: bool = True,
    engine: str = DEFAULT_ENGINE,
    model_name: Optional[str] = None,
    progress_file: Optional[Union[str, Path]] = None,
    require_complete: bool = False,
) -> str:
    """Transcribe *episode_path* and return the transcript JSON path."""
    if engine not in DEFAULT_MODELS:
        raise ValueError(f"Unknown transcription engine '{engine}'")
    model_name = model_name or DEFAULT_MODELS[engine]
    audio_path = Path(episode_path).expanduser().resolve()
    if not audio_path.is_file():
        raise FileNotFoundError(f"Episode file not found: {audio_path}")

    out_path = Path(output_path).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    audio_duration = _probe_audio_duration(audio_path)
    speech_end = _detect_speech_end(audio_path, audio_duration) if audio_duration else None
    if audio_duration and speech_end is not None and speech_end < audio_duration:
        logger.info(
            "Trailing silence from %s; coverage measured to end of speech",
            _format_seconds(speech_end),
        )
    existing_segments: Optional[List[dict]] = None
    last_end: Optional[float] = None
    resume_from: Optional[float] = None

    if resume:
        existing_segments, last_end = _load_partial_transcript(out_path)
        if existing_segments and audio_duration is not None:
            complete_at = audio_duration - 1.0
            if speech_end is not None and speech_end < audio_duration:
                complete_at = speech_end - SPEECH_END_TOLERANCE_SECONDS
            if last_end and last_end >= complete_at:
                if require_complete:
                    _require_complete_transcript(existing_segments, audio_duration, speech_end)
                logger.info("Transcript already complete (%s).", _format_seconds(last_end))
                return str(out_path)
            resume_from = last_end
            logger.info(
                "Resuming transcript from %s (%d existing segments)",
                _format_seconds(resume_from or 0),
                len(existing_segments),
            )

    model = _get_model(engine, model_name)
    transcript: List[dict] = list(existing_segments) if existing_segments else []

    logger.info("Transcribing %s with %s (%s)", audio_path.name, engine, model_name)
    if audio_duration is not None:
        logger.info("Source duration: %s (%.2fs)", _format_seconds(audio_duration), audio_duration)

    interrupted = False
    temp_audio_path: Optional[Path] = None
    try:
        audio_to_transcribe = audio_path
        offset = 0.0
        if resume_from is not None:
            fd, tmp_name = tempfile.mkstemp(suffix=audio_path.suffix or ".mp3")
            os.close(fd)
            temp_audio_path = Path(tmp_name)
            logger.info("Extracting remaining audio starting at %s", _format_seconds(resume_from))
            if _extract_audio_tail(audio_path, resume_from, temp_audio_path):
                audio_to_transcribe = temp_audio_path
                offset = resume_from
            else:
                logger.warning("Tail extraction failed; restarting from beginning")
                transcript = []
                resume_from = None
                offset = 0.0
                audio_to_transcribe = audio_path

        progress_path = Path(progress_file).resolve() if progress_file else None
        if progress_path and audio_duration:
            try:
                progress_path.write_text("0.00\tStarting...\n", encoding="utf-8")
            except OSError:
                pass

        def on_chunk(position: int, total: int) -> None:
            if audio_duration and total:
                covered = offset + (audio_duration - offset) * position / total
                _write_progress(progress_path, covered, audio_duration)
                logger.info("Transcribing – %s / %s", _format_seconds(covered), _format_seconds(audio_duration))

        segments = _transcribe_segments(model, engine, audio_to_transcribe, on_chunk)

        for idx, segment in enumerate(segments, start=len(transcript) + 1):
            abs_end = segment.end + offset
            progress_pct = (
                min(abs_end / audio_duration * 100, 100) if audio_duration else 0.0
            )
            if idx % 25 == 0:
                _write_progress(progress_path, abs_end, audio_duration)
            if audio_duration and idx % 250 == 0:
                logger.info(
                    "Processed %d segments – covered %s (%.1f%%)",
                    idx,
                    _format_seconds(abs_end),
                    progress_pct,
                )
            row = {
                "start": segment.start + offset,
                "end": segment.end + offset,
                "text": segment.text,
            }
            words = getattr(segment, "words", None)
            if words:
                row["words"] = [
                    {"start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3), "text": w["text"]}
                    for w in words
                ]
            transcript.append(row)

    except KeyboardInterrupt:
        interrupted = True
        logger.warning("Transcription interrupted; saving partial transcript")
    except Exception:  # pragma: no cover - defensive logging
        interrupted = True
        logger.exception("Critical error during transcription; saving partial result")
    finally:
        if temp_audio_path and temp_audio_path.exists():
            try:
                temp_audio_path.unlink()
            except OSError:
                pass

    with out_path.open("w") as f:
        json.dump(transcript, f, indent=2)

    final_timestamp = transcript[-1]["end"] if transcript else 0.0
    logger.info(
        "Transcript saved to %s (%d segments, %s)",
        out_path,
        len(transcript),
        _format_seconds(final_timestamp),
    )
    if audio_duration:
        coverage_end = speech_end or audio_duration
        coverage_pct = final_timestamp / coverage_end * 100
        logger.info("Coverage vs end of speech: %.1f%%", coverage_pct)
        if final_timestamp < coverage_end * 0.95:
            logger.warning("Transcript ended well before the end of speech")

    if interrupted:
        logger.warning("Partial transcript available at %s", out_path)
        if require_complete:
            raise RuntimeError("Transcription did not finish. Partial transcript saved; no later pipeline stages should run.")
    if require_complete:
        _require_complete_transcript(transcript, audio_duration, speech_end)
    return str(out_path)
