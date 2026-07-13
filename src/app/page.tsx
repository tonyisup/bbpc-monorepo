export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--background)] text-[var(--foreground)] px-6">
      <div className="max-w-sm w-full border border-[var(--card-border)] bg-[var(--card-bg)] rounded p-6 text-center">
        <h1 className="text-2xl font-semibold mb-2">BBPC Recording</h1>
        <p className="text-sm text-[var(--muted)] mb-6">
          Create a private recording session, then invite the rest of the room.
        </p>
        <form action="/api/sessions/create" method="post">
          <button
            type="submit"
            className="w-full px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90"
          >
            Create recording session
          </button>
        </form>
      </div>
    </main>
  );
}
