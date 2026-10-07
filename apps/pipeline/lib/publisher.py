import json
from pathlib import Path

from lib.convex_client import ConvexPipelineClient


def run(context: dict) -> None:
    config = context.get("config")
    if not config:
        print("Config not provided, skipping publish.")
        return

    seo_path = context.get("seo_path")
    if not seo_path:
        print("No SEO file provided, skipping publish.")
        return

    with open(seo_path, "r", encoding="utf-8") as f:
        seo_data = json.load(f)

    filename = Path(context.get("episode_path")).stem
    if len(filename) < 8 or not filename[:8].isdigit():
        raise RuntimeError(
            f"Could not parse an episode date from filename: {filename}"
        )
    episode_date = f"{filename[:4]}-{filename[4:6]}-{filename[6:8]}"
    expected_title = seo_data.get("title")
    expected_desc = seo_data.get("metaDescription")
    keywords = seo_data.get("keywords", [])
    if expected_title is not None and not isinstance(expected_title, str):
        raise RuntimeError("SEO title must be a string or null.")
    if expected_desc is not None and not isinstance(expected_desc, str):
        raise RuntimeError("SEO description must be a string or null.")
    if not isinstance(keywords, list) or not all(
        isinstance(keyword, str) for keyword in keywords
    ):
        raise RuntimeError("SEO keywords must be an array of strings.")
    expected_keywords = ", ".join(keywords)
    client = context.get("convex_client")
    if client is None:
        client = ConvexPipelineClient.from_environment()
    if not isinstance(client, ConvexPipelineClient):
        required = {"get_episode_by_date", "publish_episode_seo"}
        if not all(hasattr(client, method) for method in required):
            raise RuntimeError("convex_client does not implement the pipeline contract.")
    episode = client.get_episode_by_date(episode_date)
    if episode is None:
        raise RuntimeError(f"No episode found for date {episode_date}.")
    updated, changed = client.publish_episode_seo(
        episode=episode,
        seo_title=expected_title,
        seo_description=expected_desc,
        seo_keywords=expected_keywords,
    )
    expected_title_normalized = (
        expected_title.strip() or None
        if expected_title is not None
        else None
    )
    expected_desc_normalized = (
        expected_desc.strip() or None
        if expected_desc is not None
        else None
    )
    expected_keywords_normalized = expected_keywords.strip() or None
    if (
        updated.seo_title != expected_title_normalized
        or updated.seo_description != expected_desc_normalized
        or updated.seo_keywords != expected_keywords_normalized
    ):
        raise RuntimeError("Convex SEO publish response did not match the request.")
    print(
        "Episode SEO metadata is current in Convex"
        f" ({'updated' if changed else 'already applied'})."
    )
