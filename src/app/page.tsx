import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from '@clerk/nextjs';

const CREATE_ERROR_MESSAGES = {
  'sign-in-required': 'Sign in before creating a recording session.',
  unavailable:
    'A recording session cannot be created in the current migration stage or with this account.',
} as const;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ createError?: string }>;
}) {
  const { createError } = await searchParams;
  const createErrorMessage =
    createError && createError in CREATE_ERROR_MESSAGES
      ? CREATE_ERROR_MESSAGES[
          createError as keyof typeof CREATE_ERROR_MESSAGES
        ]
      : null;

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--background)] text-[var(--foreground)] px-6">
      <div className="max-w-sm w-full border border-[var(--card-border)] bg-[var(--card-bg)] rounded p-6 text-center">
        <h1 className="text-2xl font-semibold mb-2">BBPC Recording</h1>
        <p className="text-sm text-[var(--muted)] mb-6">
          Create a private recording session, then invite the rest of the room.
        </p>
        {createErrorMessage && (
          <p
            role="alert"
            className="mb-4 rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-sm text-[var(--warning)]"
          >
            {createErrorMessage}
          </p>
        )}
        <SignedIn>
          <div className="flex items-center justify-center gap-3 mb-4 text-sm text-[var(--muted)]">
            <span>Signed in</span>
            <UserButton />
          </div>
          <form action="/api/sessions/create" method="post">
            <button
              type="submit"
              className="w-full px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90"
            >
              Create recording session
            </button>
          </form>
        </SignedIn>
        <SignedOut>
          <SignInButton mode="modal">
            <button
              type="button"
              className="w-full px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90"
            >
              Sign in to create a session
            </button>
          </SignInButton>
        </SignedOut>
      </div>
    </main>
  );
}
