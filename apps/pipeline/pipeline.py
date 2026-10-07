import argparse
import os
import sys
from pathlib import Path

from azure.storage.blob import BlobServiceClient

from lib import clipper, cowork_handoff, diarizer, movie_extractor, parser, publisher, review_clipper, thumbnail, transcriber, transcript_importer
from lib.data_dir import require_data_dir
from lib.runtime_config import get_azure_connection_string, load_config

STAGES = ["transcribe", "import_transcript", "movies", "review_clip", "diarize", "parse", "clip", "thumbnail", "publish"]

def _resolve_episode(path_arg: str, episodes_dir: Path) -> Path:
    candidate = Path(path_arg).expanduser()
    if candidate.is_file():
        return candidate.resolve()

    within_dir = episodes_dir / path_arg
    if within_dir.is_file():
        return within_dir.resolve()

    raise SystemExit(f"Episode file not found: {path_arg}")


def _resolve_latest_episode_from_azure(episodes_dir: Path, container_name: str = "episodes") -> Path:
    connection_string = get_azure_connection_string()
    blob_service_client = BlobServiceClient.from_connection_string(connection_string)
    container_client = blob_service_client.get_container_client(container_name)

    blobs = [blob for blob in container_client.list_blobs() if getattr(blob, "name", "")]
    if not blobs:
        raise SystemExit(f"No blobs found in Azure container: {container_name}")

    latest_blob = max(blobs, key=lambda blob: blob.last_modified or 0)
    local_filename = Path(latest_blob.name).name
    local_episode_path = episodes_dir / local_filename
    episodes_dir.mkdir(parents=True, exist_ok=True)

    if not local_episode_path.is_file():
        blob_client = container_client.get_blob_client(latest_blob.name)
        with local_episode_path.open("wb") as f:
            f.write(blob_client.download_blob().readall())

    return local_episode_path.resolve()


def _should_run(stage: str, only: str | None, start: str | None = None) -> bool:
    if only is not None:
        return only == stage
    if start is not None:
        return STAGES.index(stage) >= STAGES.index(start)
    return True


def main() -> None:
    parser_obj = argparse.ArgumentParser(description="Podcast Content Factory Pipeline")
    parser_obj.add_argument(
        "episode",
        nargs="?",
        help="Path or filename of the episode (relative to episodes_dir). If omitted, uses latest episode from Azure.",
    )
    parser_obj.add_argument("--config", default="config.json", help="Path to config.json")
    parser_obj.add_argument("--only", choices=STAGES, help="Run a single pipeline stage")
    parser_obj.add_argument("--transcript", help="Optional override for transcript output path")
    parser_obj.add_argument("--fresh-transcript", action="store_true", help="Ignore any existing partial transcript")
    parser_obj.add_argument("--episode-id", help="Verified Convex episode ID for transcript import when filename-date lookup is unsuitable")
    parser_obj.add_argument("--confirm-complete", action="store_true", help="Confirm an existing transcript is complete for --only import_transcript")
    parser_obj.add_argument("--dry-run", action="store_true", help="Validate and inspect without writes; requires --only import_transcript")
    parser_obj.add_argument("--from", dest="from_stage", choices=STAGES, help="Run this stage and every stage after it")
    parser_obj.add_argument("--cowork-mode", choices=cowork_handoff.MODES, help="Override settings.cowork_mode for this run")
    args = parser_obj.parse_args()
    if args.only and args.from_stage:
        parser_obj.error("--only and --from are mutually exclusive")
    if args.dry_run and args.only != "import_transcript":
        parser_obj.error("--dry-run requires --only import_transcript")
    if args.only == "import_transcript" and not args.confirm_complete:
        parser_obj.error("--only import_transcript requires --confirm-complete after reviewing the transcript")

    config_path = Path(args.config)
    config = load_config(config_path)
    require_data_dir()

    episodes_dir = Path(config.get("paths", {}).get("episodes_dir", "./episodes")).expanduser().resolve()
    if args.episode:
        episode_path = _resolve_episode(args.episode, episodes_dir)
    else:
        episode_path = _resolve_latest_episode_from_azure(episodes_dir)
        # Unattended runs: skip finished episodes and resume ones handed to Cowork.
        status = cowork_handoff.episode_status(config, episode_path.stem)
        if status == cowork_handoff.STATUS_DONE:
            print(f"{episode_path.stem} is already processed; pass the episode explicitly to rerun it.")
            return
        if status == cowork_handoff.STATUS_AWAITING and not (args.only or args.from_stage):
            if not cowork_handoff.outputs_ready(config, episode_path.stem):
                print(f"{episode_path.stem} is waiting for Cowork; nothing to do yet.")
                sys.exit(cowork_handoff.EXIT_AWAITING_COWORK)
            print(f"Cowork outputs ready for {episode_path.stem}; resuming from the movies stage.")
            args.from_stage = "movies"

    if _should_run("import_transcript", args.only, args.from_stage):
        transcript_importer.check_configuration()

    transcripts_dir = Path(config.get("paths", {}).get("transcripts_dir", "./transcripts")).expanduser().resolve()
    transcript_output_path = (
        Path(args.transcript).expanduser().resolve()
        if args.transcript
        else transcripts_dir / f"{episode_path.stem}.json"
    )

    print(f"Processing episode: {episode_path}")
    print(f"Transcript path: {transcript_output_path}")
    seo_output_path = Path(config.get("paths", {}).get("seo_dir", "./output/seo")).expanduser().resolve() / f"{episode_path.stem}.seo.json"

    context: dict = {
        "config": config,
        "episode_path": str(episode_path),
        "transcript_path": str(transcript_output_path),
        "seo_path": str(seo_output_path),
        "episode_id": args.episode_id,
        "transcript_complete": args.confirm_complete,
        "transcript_dry_run": args.dry_run,
        "cowork_mode": args.cowork_mode,
    }

    try:
        _run_stages(args, context, episode_path, transcript_output_path)
    except cowork_handoff.AwaitingCowork as exc:
        cowork_handoff.mark_episode(
            config, episode_path.stem, cowork_handoff.STATUS_AWAITING,
            episodePath=str(episode_path), transcriptPath=context["transcript_path"],
            waitingOn=exc.stage,
        )
        print(f"{exc}\nRe-run with --from movies once Cowork has written its files.")
        sys.exit(cowork_handoff.EXIT_AWAITING_COWORK)
    except cowork_handoff.CoworkOutputInvalid as exc:
        cowork_handoff.mark_episode(
            config, episode_path.stem, cowork_handoff.STATUS_AWAITING,
            episodePath=str(episode_path), transcriptPath=context["transcript_path"],
            lastError=str(exc),
        )
        print(exc)
        sys.exit(cowork_handoff.EXIT_AWAITING_COWORK)

    if _should_run("publish", args.only, args.from_stage):
        cowork_handoff.mark_episode(config, episode_path.stem, cowork_handoff.STATUS_DONE)
    print("Pipeline complete.")


def _run_stages(args, context: dict, episode_path: Path, transcript_output_path: Path) -> None:

    if _should_run("transcribe", args.only, args.from_stage):
        engine, model_name = transcriber.engine_from_settings(context["config"].get("settings", {}))
        print(f"[1/9] Transcribing with {engine} ({model_name})...")
        progress_file = os.environ.get("BACKFILL_PROGRESS_FILE")
        transcript_path = transcriber.run(
            context["episode_path"],
            output_path=str(transcript_output_path),
            resume=not args.fresh_transcript,
            engine=engine,
            model_name=model_name,
            progress_file=progress_file or None,
            require_complete=True,
        )
        context["transcript_path"] = transcript_path
        context["transcript_complete"] = True
        print(f"Transcript saved to {transcript_path}")

    if _should_run("import_transcript", args.only, args.from_stage):
        print(f"[2/9] Importing transcript for {episode_path.name}...")
        transcript_importer.run(context)

    if _should_run("movies", args.only, args.from_stage):
        print(f"[3/9] Extracting reviewed movies from {episode_path.name}...")
        movie_extractor.run(context)

    if _should_run("review_clip", args.only, args.from_stage):
        print(f"[4/9] Creating movie review clips for {episode_path.name}...")
        review_clipper.run(context)

    if _should_run("diarize", args.only, args.from_stage):
        print(f"[5/9] Diarizing {episode_path.name}...")
        diarizer.run(context)

    if _should_run("parse", args.only, args.from_stage):
        print(f"[6/9] Parsing {episode_path.name}...")
        parser.run(context)

    if _should_run("clip", args.only, args.from_stage):
        print(f"[7/9] Clipping {episode_path.name}...")
        clipper.run(context)

    if _should_run("thumbnail", args.only, args.from_stage):
        print(f"[8/9] Generating thumbnail for {episode_path.name}...")
        thumbnail.run(context)

    if _should_run("publish", args.only, args.from_stage):
        print(f"[9/9] Publishing {episode_path.name}...")
        publisher.run(context)


if __name__ == "__main__":
    main()
