export function CallContent() {
  return (
    <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
      <h1 className="text-5xl font-extrabold tracking-tight">Join Call</h1>

      <div className="w-full max-w-2xl text-center">
        <p className="text-lg">
          Click the button below to join the Discord call.
        </p>

        <a
          href="https://discord.gg/your-invite-link"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-block rounded-lg bg-purple-600 px-8 py-4 text-lg font-semibold text-white transition hover:bg-purple-700"
        >
          Join Discord Call
        </a>
      </div>
    </div>
  );
}
