import argparse
import json
import subprocess
import sys
from pathlib import Path

from azure.storage.blob import BlobServiceClient
from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.progress import BarColumn, Progress, TextColumn
from rich.table import Table

from lib.mp3_episode_meta import (
    EpisodeMetadataError,
    read_episode_metadata_from_audio,
)
from lib.convex_client import ConvexPipelineClient
from lib.data_dir import require_data_dir
from lib.runtime_config import (
    get_azure_connection_string,
    load_config,
)

# Configuration
CONFIG_PATH = Path("config.json")
config = load_config(CONFIG_PATH)

CONNECTION_STRING = get_azure_connection_string()
EPISODES_DIR = Path(config["paths"]["episodes_dir"])
TRANSCRIPTS_DIR = Path(config["paths"].get("transcripts_dir", "transcripts"))


def get_db_episode_dates(
    client: ConvexPipelineClient | None = None,
) -> set[str]:
    """Fetch every dated canonical episode through bounded Convex pages."""
    convex = client or ConvexPipelineClient.from_environment()
    return convex.list_episode_dates()


def episode_exists_in_db_set(filename, existing_dates):
    try:
        stem = Path(filename).stem
        year = stem[:4]
        month = stem[4:6]
        day = stem[6:8]
        episode_date = f"{year}-{month}-{day}"
        return episode_date in existing_dates
    except Exception:
        return False


def filename_to_episode_date(filename: str) -> str:
    stem = Path(filename).stem
    return f"{stem[:4]}-{stem[4:6]}-{stem[6:8]}"


def insert_episode_from_audio_metadata(
    client: ConvexPipelineClient,
    filename: str,
    episode_path: Path,
    db_dates: set[str],
) -> None:
    """Create one canonical episode from audio metadata when its date is absent."""
    if episode_exists_in_db_set(filename, db_dates):
        return

    number, title = read_episode_metadata_from_audio(episode_path)
    episode_date = filename_to_episode_date(filename)
    client.upsert_episode_from_audio(
        date=episode_date,
        number=number,
        title=title,
    )
    db_dates.add(episode_date)


def upsert_episode_with_retry(
    filename: str,
    episode_path: Path,
    db_dates: set[str],
    *,
    client: ConvexPipelineClient | None = None,
    max_attempts: int = 3,
) -> None:
    """Idempotently create an episode; the client owns bounded retries."""
    if max_attempts < 1:
        raise ValueError("max_attempts must be positive")
    convex = client or ConvexPipelineClient.from_environment()
    insert_episode_from_audio_metadata(
        convex,
        filename,
        episode_path,
        db_dates,
    )


def get_last_seo_data(filename):
    seo_path = Path(config.get("paths", {}).get("output_dir", "./output")) / "seo" / f"{Path(filename).stem}.seo.json"
    if seo_path.exists():
        try:
            with open(seo_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("title", "No Title"), ", ".join(data.get("keywords", [])[:3])
        except Exception:
            return "Error", ""
    return "None", ""


def _run_pipeline_for_episode(filename: str, episode_path: Path) -> bool:
    try:
        subprocess.run(
            [sys.executable, "pipeline.py", str(episode_path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"\npipeline.py failed for {filename} (exit {e.returncode})")
        if e.stdout:
            print(e.stdout)
        if e.stderr:
            print(e.stderr)
        return False
    return True


def make_layout(overall_progress, episode_progress, table):
    layout = Layout()
    layout.split_column(
        Layout(Panel("Podcast Factory Backfill Dashboard", style="bold blue"), size=3),
        Layout(overall_progress, size=4),
        Layout(episode_progress, size=4),
        Layout(table),
    )
    return layout


def build_backfill_tasks(blobs, db_dates, date_after=None, date_before=None):
    """
    Episodes to process:
    - Azure blob exists, date not in Convex (create episode, then pipeline), or
    - Date in Convex but transcript JSON is missing (pipeline only).
    """

    def passes_date_range(name):
        try:
            stem = Path(name).stem
            if date_after and stem < date_after:
                return False
            if date_before and stem > date_before:
                return False
            return True
        except Exception:
            return False

    tasks = set()
    for b in blobs:
        name = b.name
        if not passes_date_range(name):
            continue
        stem = Path(name).stem
        transcript_missing = not (TRANSCRIPTS_DIR / f"{stem}.json").exists()
        in_db = episode_exists_in_db_set(name, db_dates)
        if not in_db:
            tasks.add(name)
        elif transcript_missing:
            tasks.add(name)

    return sorted(tasks, key=lambda n: Path(n).stem)


def run_dry_run(tasks, db_dates):
    print(f"\n=== Dry run: {len(tasks)} task(s) ===\n")
    for filename in tasks:
        stem = Path(filename).stem
        in_db = episode_exists_in_db_set(filename, db_dates)
        local = (EPISODES_DIR / filename).is_file()
        tr = TRANSCRIPTS_DIR / f"{stem}.json"
        has_tr = tr.exists()
        actions = []
        if not in_db:
            actions.append(
                "create Convex episode (number/title from MP3 tags, date from filename)"
            )
        if not has_tr:
            actions.append("run pipeline.py (all stages: transcribe → movies → diarize → parse → clip → publish)")

        print(f"  {filename}")
        print(
            f"    in Convex (by date): {in_db}  |  local file: {local}"
            f"  |  transcript: {'yes' if has_tr else 'no'}"
        )
        print(f"    would: {'; '.join(actions)}")

        if not in_db and local:
            try:
                num, title = read_episode_metadata_from_audio(EPISODES_DIR / filename)
                print(f"    ID3 preview: number={num}, title={title!r}")
            except EpisodeMetadataError as e:
                print(f"    ID3 preview: FAILED — {e}")
        elif not in_db and not local:
            print("    ID3 preview: (skipped — download Azure blob first to read tags)")

        print()

    print("No downloads, Convex writes, or pipeline runs were performed.")


def backfill(date_after=None, date_before=None, dry_run=False):
    require_data_dir()
    container_name = "episodes"
    blob_service_client = BlobServiceClient.from_connection_string(CONNECTION_STRING)
    container_client = blob_service_client.get_container_client(container_name)

    EPISODES_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    (Path(config.get("paths", {}).get("output_dir", "./output")) / "seo").mkdir(parents=True, exist_ok=True)

    convex = ConvexPipelineClient.from_environment()
    print("Fetching existing episode dates from Convex...")
    db_dates = get_db_episode_dates(convex)
    print(f"Convex dates: {len(db_dates)}")

    print("Fetching blob list from Azure (this may take a moment)...")
    blobs = list(container_client.list_blobs())

    print(f"Blobs: {len(blobs)}")

    if date_after or date_before:
        after_label = date_after if date_after else "start"
        before_label = date_before if date_before else "end"
        print(f"Date filter: {after_label} → {before_label}")

    azure_only = sum(
        1 for b in blobs if not episode_exists_in_db_set(b.name, db_dates)
    )
    print(f"Blobs whose filename date is not in Convex: {azure_only}")

    tasks = build_backfill_tasks(blobs, db_dates, date_after, date_before)
    print(
        "Tasks to process (new Convex rows and/or missing transcripts):"
        f" {len(tasks)}"
    )

    if not tasks:
        print("Nothing to process.")
        return

    if dry_run:
        run_dry_run(tasks, db_dates)
        return

    overall_progress = Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
    )
    overall_task = overall_progress.add_task("Backfilling...", total=len(tasks))

    episode_progress = Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total}"),
    )
    episode_task = episode_progress.add_task("Episode steps", total=3)

    table = Table(title="Live Status", expand=True)
    table.add_column("Key", style="cyan")
    table.add_column("Value", style="magenta")

    layout = make_layout(overall_progress, episode_progress, table)
    console = Console()

    with Live(layout, refresh_per_second=4, console=console) as live:
        last_completed = "N/A"
        last_keywords = "N/A"
        pipeline_failures: list[str] = []

        for filename in tasks:
            episode_progress.reset(episode_task, total=3, completed=0)
            episode_progress.update(episode_task, description=f"{filename}")

            table = Table(title="Live Status", expand=True)
            table.add_column("Key", style="cyan")
            table.add_column("Value", style="magenta")
            table.add_row("Current", filename)
            table.add_row("Last Completed", last_completed)
            table.add_row("Last Keywords", last_keywords)
            live.update(make_layout(overall_progress, episode_progress, table))

            episode_path = EPISODES_DIR / filename
            if not episode_path.exists():
                blob_client = container_client.get_blob_client(filename)
                # Download beside the target; an interrupted run must not leave a
                # partial file that the existence check then skips.
                partial_path = episode_path.with_name(f"{episode_path.name}.part")
                with open(partial_path, "wb") as f:
                    f.write(blob_client.download_blob().readall())
                partial_path.replace(episode_path)
            episode_progress.advance(episode_task)
            live.update(make_layout(overall_progress, episode_progress, table))

            try:
                upsert_episode_with_retry(
                    filename,
                    episode_path,
                    db_dates,
                    client=convex,
                )
            except EpisodeMetadataError as e:
                print(f"\nSkipping {filename}: {e}\n")
                overall_progress.update(overall_task, advance=1)
                continue
            except Exception as e:
                print(f"\nConvex error for {filename}: {e}\n")
                overall_progress.update(overall_task, advance=1)
                continue

            episode_progress.advance(episode_task)
            live.update(make_layout(overall_progress, episode_progress, table))

            if not _run_pipeline_for_episode(filename, episode_path):
                pipeline_failures.append(filename)
                overall_progress.update(overall_task, advance=1)
                continue

            episode_progress.advance(episode_task)
            last_completed = filename
            _, last_keywords = get_last_seo_data(filename)
            overall_progress.update(overall_task, advance=1)

    print("Backfill complete.")
    if pipeline_failures:
        print(f"Pipeline failures ({len(pipeline_failures)}):")
        for filename in pipeline_failures:
            print(f"  - {filename}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill podcast transcripts.")
    parser.add_argument("--date-after", default=None, help="Only process episodes on/after this date (YYYYMMDD).")
    parser.add_argument("--date-before", default=None, help="Only process episodes on/before this date (YYYYMMDD).")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would run; no Azure download, Convex writes, or pipeline.",
    )
    args = parser.parse_args()

    backfill(date_after=args.date_after, date_before=args.date_before, dry_run=args.dry_run)
