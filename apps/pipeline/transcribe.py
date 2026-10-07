
import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile

from faster_whisper import WhisperModel

from lib.data_dir import data_dir

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def format_seconds(total_seconds):
    total_seconds = int(total_seconds)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def probe_audio_duration(audio_path):
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
                audio_path,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return float(result.stdout.strip())
    except (FileNotFoundError, subprocess.CalledProcessError, ValueError):
        return None


def load_partial_transcript(path):
    """Load existing transcript if present. Returns (segments, last_end_seconds) or (None, None)."""
    if not os.path.isfile(path):
        return None, None
    try:
        with open(path) as f:
            data = json.load(f)
        if not isinstance(data, list) or len(data) == 0:
            return None, None
        for seg in data:
            if not isinstance(seg, dict) or "start" not in seg or "end" not in seg:
                return None, None
        last_end = data[-1]["end"]
        return data, last_end
    except (json.JSONDecodeError, KeyError, TypeError):
        return None, None


def extract_audio_tail(audio_path, start_seconds, output_path):
    """Extract audio from start_seconds to end into output_path. Returns True on success."""
    try:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                str(start_seconds),
                "-i",
                audio_path,
                "-acodec",
                "copy",
                output_path,
            ],
            check=True,
            capture_output=True,
        )
        return os.path.isfile(output_path)
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


TRANSCRIPTS_DIR = str(data_dir() / "transcripts")


def transcribe_podcast(audio_path, output_json=None):
    if output_json is None:
        base = os.path.splitext(os.path.basename(audio_path))[0]
        output_json = os.path.join(TRANSCRIPTS_DIR, f"{base}.json")
    audio_duration = probe_audio_duration(audio_path)

    # Check for existing partial transcript to resume from
    existing_segments, last_end = load_partial_transcript(output_json)
    resume_from = None
    if existing_segments is not None and audio_duration is not None:
        if last_end >= audio_duration - 1.0:  # already covered (within 1s of end)
            print(f"Transcript already complete (covers {format_seconds(last_end)}). Exiting.")
            return
        resume_from = last_end
        print(f"Resuming from existing transcript: {len(existing_segments)} segments, up to {format_seconds(resume_from)}")

    print(f"Loading Whisper model...")
    model = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8")
    transcript = list(existing_segments) if existing_segments else []

    print(f"Transcribing {audio_path}...")
    if audio_duration is not None:
        print(
            f"Source duration: {format_seconds(audio_duration)} ({audio_duration:.2f}s)"
        )

    interrupted = False
    temp_audio_path = None
    try:
        if resume_from is not None:
            fd, temp_audio_path = tempfile.mkstemp(suffix=".mp3")
            os.close(fd)
            print(f"Extracting remaining audio (from {format_seconds(resume_from)} to end)...")
            if not extract_audio_tail(audio_path, resume_from, temp_audio_path):
                print("ffmpeg failed; transcribing from start.")
                try:
                    os.unlink(temp_audio_path)
                except OSError:
                    pass
                temp_audio_path = None
                resume_from = None
                transcript = []

        audio_to_transcribe = temp_audio_path if temp_audio_path else audio_path
        if not transcript:
            # Full run: transcribe from start
            segments, info = model.transcribe(audio_to_transcribe, beam_size=5, log_progress=True)
            print(f"Detected language: {info.language} with probability {info.language_probability:.2f}")
            offset = 0.0
        else:
            # Resume: only the tail is in audio_to_transcribe; segment times are relative to tail start
            segments, info = model.transcribe(audio_to_transcribe, beam_size=5, log_progress=True)
            print(f"Detected language (tail): {info.language} with probability {info.language_probability:.2f}")
            offset = resume_from

        segment_count = len(transcript)
        for segment in segments:
            segment_count += 1
            if segment_count % 250 == 0 and audio_duration:
                abs_end = segment.end + offset
                progress_pct = min(abs_end / audio_duration * 100, 100)
                print(
                    f"Processed {segment_count} segments. "
                    f"Audio covered: {format_seconds(abs_end)} ({progress_pct:.1f}%)."
                )
            transcript.append({
                "start": segment.start + offset,
                "end": segment.end + offset,
                "text": segment.text
            })

    except KeyboardInterrupt:
        interrupted = True
        print("\nInterrupted. Saving partial transcript...")
    except Exception as e:
        print(f"\nCRITICAL ERROR during transcription: {e}")
        print("Saving partial transcript...")
    finally:
        if temp_audio_path and os.path.isfile(temp_audio_path):
            try:
                os.unlink(temp_audio_path)
            except OSError:
                pass

    out_dir = os.path.dirname(output_json)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(output_json, "w") as f:
        json.dump(transcript, f, indent=2)

    final_timestamp = transcript[-1]["end"] if transcript else 0.0
    if interrupted:
        print(f"Partial transcript saved to {output_json} ({len(transcript)} segments, up to {format_seconds(final_timestamp)}).")
        sys.exit(130)
    print(f"Done! Saved transcript to {output_json}")
    print(f"Total segments processed: {len(transcript)}")
    print(
        f"Transcript coverage: {format_seconds(final_timestamp)} ({final_timestamp:.2f}s)"
    )
    if audio_duration is not None:
        coverage_pct = final_timestamp / audio_duration * 100 if audio_duration else 0
        print(f"Coverage vs source: {coverage_pct:.1f}%")
        if final_timestamp < audio_duration * 0.95:
            print("WARNING: Transcript ended well before the source audio duration.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcribe a podcast audio file.")
    parser.add_argument(
        "podcast_file",
        help="Path to the podcast audio file (e.g. .mp3, .wav)",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help=f"Output JSON path (default: {TRANSCRIPTS_DIR}/<input_basename>.json)",
    )
    args = parser.parse_args()

    if os.path.exists(args.podcast_file):
        transcribe_podcast(args.podcast_file, output_json=args.output)
    else:
        print(f"Error: {args.podcast_file} not found.")
        exit(1)
