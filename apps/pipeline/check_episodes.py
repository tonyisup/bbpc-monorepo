from lib.convex_client import ConvexPipelineClient


try:
    client = ConvexPipelineClient.from_environment()
    dates = sorted(client.list_episode_dates(), reverse=True)[:5]
    for episode_date in dates:
        episode = client.get_episode_by_date(episode_date)
        if episode is not None:
            print(
                f"Number: {episode.number}, Title: {episode.title},"
                f" Date: {episode.date}"
            )
except Exception as e:
    print(f"Error: {e}")
