import Image from "next/image";
import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="bbpc-page max-w-6xl space-y-14">
      <section className="grid items-start gap-8 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
        <div className="max-w-2xl">
          <p className="bbpc-kicker">About the show</p>
          <h1 className="mt-1 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Three friends. Too many movies. No filter.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-zinc-300">
            Harley, Fonso, and{" "}
            <Link
              className="font-semibold text-red-300 underline underline-offset-4"
              href="/about/mcp"
            >
              Tony (aka MCP)
            </Link>{" "}
            get together to argue about movies, recap their weekends, and follow
            every tangent that gets in the way.
          </p>
          <p className="mt-4 leading-relaxed text-zinc-400">
            New releases, cult favorites, listener messages, running gags, and
            strong opinions all get the same treatment: honest reactions from
            people who have known each other long enough to disagree properly.
          </p>
        </div>

        <figure className="bbpc-panel overflow-hidden">
          <Image
            src="/bad-ghibli-boys.png"
            alt="Illustration of the three Bad Boys Podcast hosts"
            width={1024}
            height={1536}
            priority
            className="h-auto w-full"
            sizes="(max-width: 768px) 100vw, 38vw"
          />
        </figure>
      </section>

      <section aria-labelledby="origin-heading" className="max-w-4xl">
        <h2
          id="origin-heading"
          className="text-3xl font-black tracking-tight text-white"
        >
          How it started
        </h2>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <article className="border-l-2 border-red-500 pl-5">
            <h3 className="text-xl font-bold text-white">The weekly call</h3>
            <p className="mt-2 leading-relaxed text-zinc-300">
              Fonso and Harley met in the 1990s. When Harley later traded city
              life for the woods, they kept in touch through weekly phone calls
              that always circled back to movies.
            </p>
          </article>
          <article className="border-l-2 border-white/15 pl-5">
            <h3 className="text-xl font-bold text-white">
              The emailed podcast
            </h3>
            <p className="mt-2 leading-relaxed text-zinc-300">
              They started recording those calls and emailing the files to
              friends. Harley handled the distribution. It was a podcast before
              they bothered calling it one.
            </p>
          </article>
          <article className="border-l-2 border-white/15 pl-5">
            <h3 className="text-xl font-bold text-white">
              MCP builds the site
            </h3>
            <p className="mt-2 leading-relaxed text-zinc-300">
              Tony received one of the emails and built a website for the show.
              As payment, Fonso and Harley let him guest on an episode. He never
              left.
            </p>
          </article>
          <article className="border-l-2 border-white/15 pl-5">
            <h3 className="text-xl font-bold text-white">Still arguing</h3>
            <p className="mt-2 leading-relaxed text-zinc-300">
              More than a decade later, the calls are still happening, the movie
              arguments are still unresolved, and listeners now get to join the
              game.
            </p>
          </article>
        </div>
      </section>

      <aside className="bbpc-panel flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-xl font-bold text-white">
            Help keep the site running
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Hosting, movie data, and Reese&apos;s are not free.
          </p>
        </div>
        <Link
          href="https://ko-fi.com/tonyisup"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg bg-red-500 px-5 font-semibold text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          Buy Tony a Reese&apos;s
        </Link>
      </aside>
    </div>
  );
}
