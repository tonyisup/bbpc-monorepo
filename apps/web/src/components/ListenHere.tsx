import type { IconType } from "react-icons";
import {
  SiApplepodcasts,
  SiPatreon,
  SiSoundcloud,
  SiSpotify,
  SiYoutubemusic,
} from "react-icons/si";

interface PlatformLink {
  href: string;
  label: string;
  icon: IconType;
  iconClassName: string;
}

const platforms: PlatformLink[] = [
  {
    href: "https://www.patreon.com/badboyspodcast",
    label: "Patreon",
    icon: SiPatreon,
    iconClassName: "text-[#ff424d]",
  },
  {
    href: "https://podcasts.apple.com/us/podcast/bad-boys-podcast/id937655279",
    label: "Apple Podcasts",
    icon: SiApplepodcasts,
    iconClassName: "text-[#a970ff]",
  },
  {
    href: "https://soundcloud.com/badboyspodcast",
    label: "SoundCloud",
    icon: SiSoundcloud,
    iconClassName: "text-[#ff5500]",
  },
  {
    href: "https://open.spotify.com/show/7kNwGU5aJhw4IZ7x7V6jsl",
    label: "Spotify",
    icon: SiSpotify,
    iconClassName: "text-[#1ed760]",
  },
  {
    href: "https://music.youtube.com/playlist?list=PL5tJGBZ94i2eX66kGUk1dO1SxZiWC5J95",
    label: "YouTube Music",
    icon: SiYoutubemusic,
    iconClassName: "text-[#ff0033]",
  },
];

export function ListenHere() {
  return (
    <section className="w-full px-4 py-8" aria-labelledby="listen-heading">
      <div className="mx-auto max-w-4xl">
        <h2
          id="listen-heading"
          className="mb-4 text-center text-sm font-semibold text-zinc-300"
        >
          Listen and support
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {platforms.map((platform) => {
            const Icon = platform.icon;
            return (
              <a
                key={platform.label}
                href={platform.href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-red-500/30 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
              >
                <Icon
                  className={`h-5 w-auto ${platform.iconClassName}`}
                  aria-hidden="true"
                />
                <span>{platform.label}</span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
