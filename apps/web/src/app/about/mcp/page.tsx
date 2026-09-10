import Link from "next/link";

export default function AboutMCPPage() {
  return (
    <div className="bbpc-page max-w-3xl space-y-6">
      <p className="bbpc-kicker">Meet the hosts</p>
      <h1 className="text-4xl font-black tracking-tight text-white">
        Tony (MCP)
      </h1>
      <p className="text-lg leading-relaxed text-zinc-300">
        Tony is one of the three hosts of the Bad Boys Podcast, alongside Harley
        and Fonso. He built the show&apos;s website after receiving one of their
        early episodes by email. They invited him on as a guest to say thanks,
        and he stayed.
      </p>
      <p className="leading-relaxed text-zinc-300">
        These days, you can hear MCP reviewing movies, trading stories, and
        arguing with his cohosts on the show.
      </p>
      <Link
        className="font-semibold text-red-300 underline underline-offset-4"
        href="/about"
      >
        More about the podcast
      </Link>
    </div>
  );
}
