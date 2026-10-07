import json
import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from lib import transcriber

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def _make_audio(path, tone_seconds, silence_seconds):
    """Write a mono WAV: a tone followed by digital silence."""
    filters = f"sine=frequency=440:duration={tone_seconds}"
    inputs = ["-f", "lavfi", "-i", filters]
    if silence_seconds:
        inputs += ["-f", "lavfi", "-i", f"anullsrc=r=16000:cl=mono:d={silence_seconds}"]
        graph = ["-filter_complex", "[0:a]aresample=16000[a0];[a0][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]"]
    else:
        graph = ["-ar", "16000"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, *graph, "-ac", "1", str(path)], check=True)


def test_parse_silences_pairs_starts_with_ends():
    stderr = (
        "[silencedetect @ 0x1] silence_start: 12.5\n"
        "[silencedetect @ 0x1] silence_end: 20 | silence_duration: 7.5\n"
        "[silencedetect @ 0x1] silence_start: 40.25\n"
    )
    assert transcriber._parse_silences(stderr) == [(12.5, 20.0), (40.25, None)]


@needs_ffmpeg
def test_detect_speech_end_widens_window_over_long_silent_tail(tmp_path, monkeypatch):
    audio = tmp_path / "tail.wav"
    _make_audio(audio, tone_seconds=20, silence_seconds=30)
    # A 10 s window starts inside the silence, so detection must widen it.
    monkeypatch.setattr(transcriber, "SILENCE_WINDOW_SECONDS", 10.0)
    assert transcriber._detect_speech_end(audio, 50.0) == pytest.approx(20.0, abs=0.5)


@needs_ffmpeg
def test_detect_speech_end_is_full_duration_without_silent_tail(tmp_path):
    audio = tmp_path / "tone.wav"
    _make_audio(audio, tone_seconds=15, silence_seconds=0)
    assert transcriber._detect_speech_end(audio, 15.0) == 15.0


def test_detect_speech_end_falls_back_to_duration_when_ffmpeg_fails(tmp_path):
    audio = tmp_path / "broken.mp3"
    audio.write_bytes(b"not audio")
    assert transcriber._detect_speech_end(audio, 42.0) == 42.0


def test_coverage_gate_uses_speech_end_for_silent_tail():
    transcript = [{"start": 0, "end": 83}]
    with pytest.raises(RuntimeError, match="less than 95%"):
        transcriber._require_complete_transcript(transcript, 100)
    transcriber._require_complete_transcript(transcript, 100, speech_end=80)
    with pytest.raises(RuntimeError, match="less than 95%"):
        transcriber._require_complete_transcript([{"start": 0, "end": 70}], 100, speech_end=80)


def test_coverage_gate_still_rejects_timestamps_past_real_duration():
    with pytest.raises(RuntimeError, match="timestamps exceed"):
        transcriber._require_complete_transcript([{"start": 0, "end": 101}], 100, speech_end=80)


@needs_ffmpeg
def test_run_passes_gate_when_transcript_stops_at_silent_tail(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock

    audio = tmp_path / "episode.wav"
    _make_audio(audio, tone_seconds=20, silence_seconds=30)
    model = Mock()
    model.transcribe.return_value = SimpleNamespace(
        sentences=[SimpleNamespace(start=0.0, end=19.5, text="All speech.", tokens=[])]
    )
    monkeypatch.setattr(transcriber, "_get_model", lambda *_: model)
    output = tmp_path / "episode.json"
    transcriber.run(str(audio), output_path=str(output), require_complete=True)
    # A second run treats the transcript as complete instead of resuming into the silence.
    transcriber.run(str(audio), output_path=str(output), require_complete=True)
    model.transcribe.assert_called_once()


def _tok(text, start, duration=0.16):
    from types import SimpleNamespace

    return SimpleNamespace(text=text, start=start, end=start + duration, duration=duration)


def test_tokens_merge_into_words_with_attached_punctuation():
    tokens = [_tok(" An", 8.96), _tok("ge", 9.12), _tok("l", 9.28), _tok(" He", 9.44), _tok("art", 9.6, 0.24), _tok(".", 9.84)]
    assert transcriber._tokens_to_words(tokens) == [
        {"start": 8.96, "end": 9.44, "text": "Angel"},
        {"start": 9.44, "end": 10.0, "text": "Heart."},
    ]


def _words(spec):
    """spec: list of (text, start, end)."""
    return [{"start": s, "end": e, "text": t} for t, s, e in spec]


def test_long_segment_splits_at_largest_word_gap():
    words = _words([("one", 0, 4), ("two", 4.1, 8), ("three", 11, 14), ("four", 14.1, 18)])
    parts = transcriber._split_long_segment(transcriber._segment_from_words(words))
    assert [p["text"] for p in parts] == [" one two", " three four"]
    assert [(p["start"], p["end"]) for p in parts] == [(0, 8), (11, 18)]
    assert parts[1]["words"] == words[2:]


def test_run_on_segment_is_split_until_every_part_fits():
    # 96 s of evenly spaced, unpunctuated words (like a spoken points tally).
    words = _words([(f"w{i}", i * 0.8, i * 0.8 + 0.6) for i in range(120)])
    parts = transcriber._split_long_segment(transcriber._segment_from_words(words))
    assert all(p["end"] - p["start"] <= transcriber.MAX_SEGMENT_SECONDS for p in parts)
    assert [w for p in parts for w in p["words"]] == words


def test_short_segment_is_not_split():
    segment = transcriber._segment_from_words(_words([("hi", 0, 1), ("there", 1.2, 2)]))
    assert transcriber._split_long_segment(segment) == [segment]


def test_parakeet_run_stores_words_with_resume_offset(tmp_path, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock

    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"synthetic")
    output = tmp_path / "t.json"
    sentence = SimpleNamespace(start=0.0, end=0.8, text=" Hi there.", tokens=[_tok(" Hi", 0.0, 0.3), _tok(" there", 0.4, 0.3), _tok(".", 0.7, 0.1)])
    model = Mock()
    model.transcribe.return_value = SimpleNamespace(sentences=[sentence])
    monkeypatch.setattr(transcriber, "_get_model", lambda *_: model)
    monkeypatch.setattr(transcriber, "_probe_audio_duration", lambda *_: 10)
    monkeypatch.setattr(transcriber, "_extract_audio_tail", lambda *_: True)
    output.write_text(json.dumps([{"start": 0.0, "end": 5.0, "text": " Earlier."}]))
    transcriber.run(str(audio), output_path=str(output))
    rows = json.loads(output.read_text())
    assert rows[1] == {
        "start": 5.0, "end": 5.8, "text": " Hi there.",
        "words": [{"start": 5.0, "end": 5.3, "text": "Hi"}, {"start": 5.4, "end": 5.8, "text": "there."}],
    }


def test_tokens_are_restored_to_sentence_text_order():
    # parakeet-mlx sorts by start, putting a same-frame period first.
    period, wait, now = _tok(".", 1.0, 0.0), _tok(" Wait", 1.0, 0.2), _tok(" now", 1.2, 0.2)
    ordered = transcriber._tokens_in_text_order(" Wait now.", [period, wait, now])
    assert [t.text for t in ordered] == [" Wait", " now", "."]
    assert [w["text"] for w in transcriber._tokens_to_words(ordered)] == ["Wait", "now."]


def test_repeated_tokens_keep_time_order():
    first, second = _tok(" some", 1.0), _tok(" some", 2.0)
    ordered = transcriber._tokens_in_text_order(" some some", [second, first])
    assert ordered == [first, second]


def test_tokens_that_cannot_spell_the_text_are_rejected():
    assert transcriber._tokens_in_text_order(" hello", [_tok(" help", 0.0)]) is None


def test_word_times_are_forced_forward():
    words = [{"start": 10.0, "end": 10.4, "text": "All"}, {"start": 5.0, "end": 10.9, "text": "Thanks"}, {"start": 11.0, "end": 10.8, "text": "for"}]
    floor = transcriber._enforce_forward_timing(words, 9.0)
    assert [(w["start"], w["end"]) for w in words] == [(10.0, 10.4), (10.4, 10.9), (11.0, 11.0)]
    assert floor == 11.0


def test_coverage_gate_rejects_out_of_order_segment_starts():
    transcript = [{"start": 5, "end": 6}, {"start": 4, "end": 99}]
    with pytest.raises(RuntimeError, match="out of order"):
        transcriber._require_complete_transcript(transcript, 100)


def test_failed_write_keeps_the_previous_transcript(tmp_path, monkeypatch):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"synthetic")
    output = tmp_path / "transcript.json"
    previous = [{"start": 0, "end": 3, "text": "Earlier partial"}]
    output.write_text(json.dumps(previous))
    segments = iter([SimpleNamespace(start=0, end=10, text="New")])
    model = SimpleNamespace(
        transcribe=lambda *a, **k: (segments, SimpleNamespace(language="en", language_probability=1))
    )
    monkeypatch.setattr(transcriber, "_get_model", lambda *_: model)
    monkeypatch.setattr(transcriber, "_probe_audio_duration", lambda *_: 10)
    monkeypatch.setattr(transcriber.json, "dump", Mock(side_effect=OSError("disk full")))

    with pytest.raises(OSError, match="disk full"):
        transcriber.run(str(audio), output_path=str(output), resume=False, engine="faster-whisper")

    assert json.loads(output.read_text()) == previous
