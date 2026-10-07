import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from lib import transcriber, transcript_importer


@pytest.mark.parametrize("failure", [KeyboardInterrupt(), RuntimeError("synthetic decoder failure")])
def test_interrupted_transcription_saves_partial_but_fails_before_import(tmp_path, monkeypatch, failure):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"synthetic")
    output = tmp_path / "transcript.json"

    def segments():
        yield SimpleNamespace(start=0, end=3, text="Synthetic partial")
        raise failure

    model = SimpleNamespace(transcribe=lambda *a, **k: (segments(), SimpleNamespace(language="en", language_probability=1)))
    monkeypatch.setattr(transcriber, "_get_model", lambda *_: model)
    monkeypatch.setattr(transcriber, "_probe_audio_duration", lambda *_: 10)
    with pytest.raises(RuntimeError, match="Transcription did not finish"):
        transcriber.run(str(audio), output_path=str(output), engine="faster-whisper", require_complete=True)
    assert json.loads(output.read_text()) == [{"start": 0, "end": 3, "text": "Synthetic partial"}]


@pytest.mark.parametrize("duration,end", [(None, 10), (10, 8), (10, 11)])
def test_incomplete_coverage_or_overrun_cannot_be_automatically_imported(duration, end):
    with pytest.raises(RuntimeError):
        transcriber._require_complete_transcript([{"end": end}], duration)


def test_successful_and_resumed_transcripts_can_complete(tmp_path, monkeypatch):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"synthetic")
    output = tmp_path / "transcript.json"
    model = Mock()
    model.transcribe.return_value = (iter([SimpleNamespace(start=0, end=10, text="Synthetic complete")]), SimpleNamespace(language="en", language_probability=1))
    monkeypatch.setattr(transcriber, "_get_model", lambda *_: model)
    monkeypatch.setattr(transcriber, "_probe_audio_duration", lambda *_: 10)
    for _ in range(2):
        assert Path(transcriber.run(str(audio), output_path=str(output), engine="faster-whisper", require_complete=True)) == output.resolve()
    model.transcribe.assert_called_once()
    output.write_text(json.dumps([{"start": 0, "end": 11, "text": "Overrun"}]))
    with pytest.raises(RuntimeError, match="timestamps exceed"):
        transcriber.run(str(audio), output_path=str(output), engine="faster-whisper", require_complete=True)
    assert json.loads(output.read_text())[0]["end"] == 11


def test_parakeet_engine_writes_offset_sentence_segments(tmp_path, monkeypatch):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"synthetic")
    output = tmp_path / "transcript.json"
    sentences = [
        SimpleNamespace(start=0.0, end=4.0, text="Next up was Young Guns 2."),
        SimpleNamespace(start=4.0, end=4.5, text="  "),
        SimpleNamespace(start=5.0, end=10.0, text="Angel Heart from 1987."),
    ]
    model = Mock()
    model.transcribe.return_value = SimpleNamespace(sentences=sentences)
    loaded = []
    monkeypatch.setattr(transcriber, "_get_model", lambda *args: loaded.append(args) or model)
    monkeypatch.setattr(transcriber, "_probe_audio_duration", lambda *_: 10)
    transcriber.run(str(audio), output_path=str(output), require_complete=True)
    assert loaded == [("parakeet", "mlx-community/parakeet-tdt-0.6b-v2")]
    assert model.transcribe.call_args.kwargs["chunk_duration"] == transcriber.PARAKEET_CHUNK_SECONDS
    assert json.loads(output.read_text()) == [
        {"start": 0.0, "end": 4.0, "text": " Next up was Young Guns 2."},
        {"start": 5.0, "end": 10.0, "text": " Angel Heart from 1987."},
    ]


def test_engine_from_settings_defaults_to_parakeet_and_reads_model_keys():
    assert transcriber.engine_from_settings({}) == ("parakeet", "mlx-community/parakeet-tdt-0.6b-v2")
    assert transcriber.engine_from_settings({"transcription_engine": "Faster-Whisper", "whisper_model": "large-v3"}) == (
        "faster-whisper",
        "large-v3",
    )
    with pytest.raises(ValueError, match="Unknown transcription_engine"):
        transcriber.engine_from_settings({"transcription_engine": "google"})


@pytest.mark.parametrize("dry_run", [True, False])
def test_import_uses_existing_auth_and_passes_tokens_only_in_environment(tmp_path, monkeypatch, dry_run):
    source = tmp_path / "custom.json"
    source.write_text("[]")
    monkeypatch.setattr(transcript_importer, "get_convex_url", lambda: "https://synthetic.convex.cloud")
    monkeypatch.setattr(transcript_importer, "resolve_convex_pipeline_auth", lambda: ("synthetic.jwt.token", None))
    execute = Mock()
    monkeypatch.setattr(transcript_importer, "_execute", execute)
    context = {"transcript_path": str(source), "episode_path": "20260908.mp3", "episode_id": "episode-1", "transcript_dry_run": dry_run}
    with pytest.raises(RuntimeError, match="completion is unconfirmed"):
        transcript_importer.run(context)
    execute.assert_not_called()
    transcript_importer.run({**context, "transcript_complete": True})
    args, env = execute.call_args.args
    assert ("--apply" in args) is not dry_run
    assert args[args.index("--episode-id") + 1] == "episode-1"
    assert "synthetic.jwt.token" not in args
    assert env["BBPC_PIPELINE_ACCESS_TOKEN"] == "synthetic.jwt.token"
    assert "CLERK_MACHINE_SECRET_KEY" not in env


def test_pipeline_orders_import_after_completion_and_stops_on_partial(tmp_path, monkeypatch):
    import pipeline

    audio = tmp_path / "20260908.mp3"
    audio.write_bytes(b"synthetic")
    # output_dir keeps the run's state.json out of the working directory.
    monkeypatch.setattr(pipeline, "load_config", lambda _: {"paths": {"transcripts_dir": str(tmp_path), "output_dir": str(tmp_path / "output")}})
    monkeypatch.setenv("BBPC_PIPELINE_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(pipeline.transcript_importer, "check_configuration", Mock())
    monkeypatch.setattr("sys.argv", ["pipeline.py", str(audio)])
    events = []

    def transcribe(*args, **kwargs):
        assert kwargs["require_complete"] is True
        assert kwargs["engine"] == "parakeet"
        events.append("transcribe")
        return str(tmp_path / "custom.json")

    def imported(context):
        assert context["transcript_complete"] is True
        assert context["transcript_path"] == str(tmp_path / "custom.json")
        events.append("import_transcript")

    monkeypatch.setattr(pipeline.transcriber, "run", transcribe)
    monkeypatch.setattr(pipeline.transcript_importer, "run", imported)
    for name in ["movie_extractor", "review_clipper", "diarizer", "parser", "clipper", "thumbnail", "publisher"]:
        monkeypatch.setattr(getattr(pipeline, name), "run", lambda context, name=name: events.append(name))
    pipeline.main()
    assert events[:2] == ["transcribe", "import_transcript"]
    assert events[-1] == "publisher"
    events.clear()
    monkeypatch.setattr(pipeline.transcriber, "run", Mock(side_effect=RuntimeError("Partial transcript saved")))
    with pytest.raises(RuntimeError, match="Partial transcript"):
        pipeline.main()
    assert events == []


def test_import_only_requires_confirmation_and_does_not_transcribe(tmp_path, monkeypatch):
    import pipeline

    audio = tmp_path / "20260908.mp3"
    audio.write_bytes(b"synthetic")
    # output_dir keeps the run's state.json out of the working directory.
    monkeypatch.setattr(pipeline, "load_config", lambda _: {"paths": {"transcripts_dir": str(tmp_path), "output_dir": str(tmp_path / "output")}})
    monkeypatch.setenv("BBPC_PIPELINE_DATA_DIR", str(tmp_path))
    check = Mock()
    run = Mock()
    transcribe = Mock()
    monkeypatch.setattr(pipeline.transcript_importer, "check_configuration", check)
    monkeypatch.setattr(pipeline.transcript_importer, "run", run)
    monkeypatch.setattr(pipeline.transcriber, "run", transcribe)
    argv = ["pipeline.py", str(audio), "--only", "import_transcript"]
    monkeypatch.setattr("sys.argv", argv)
    with pytest.raises(SystemExit) as error:
        pipeline.main()
    assert error.value.code == 2
    check.assert_not_called()
    monkeypatch.setattr("sys.argv", [*argv, "--confirm-complete", "--dry-run", "--episode-id", "verified-id"])
    pipeline.main()
    transcribe.assert_not_called()
    context = run.call_args.args[0]
    assert context["transcript_complete"] is True
    assert context["transcript_dry_run"] is True
    assert context["episode_id"] == "verified-id"
