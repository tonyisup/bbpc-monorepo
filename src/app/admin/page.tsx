import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from '@clerk/nextjs';

import { RecordingAdminControls } from '@/components/RecordingAdminControls';

export default function RecordingAdminPage() {
  return (
    <main className="min-h-screen overflow-y-auto bg-[var(--background)] text-[var(--foreground)] px-6 py-12">
      <div className="mx-auto max-w-md border border-[var(--card-border)] bg-[var(--card-bg)] rounded p-6">
        <h1 className="text-2xl font-semibold mb-2">Recording administration</h1>
        <p className="text-sm text-[var(--muted)] mb-6">
          These operations require a linked BBPC Administrator and are subject
          to the shared Convex cutover write gate.
        </p>
        <SignedIn>
          <div className="flex items-center justify-between mb-6 text-sm text-[var(--muted)]">
            <span>Signed in</span>
            <UserButton />
          </div>
          <RecordingAdminControls />
        </SignedIn>
        <SignedOut>
          <SignInButton mode="modal">
            <button
              type="button"
              className="w-full px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90"
            >
              Sign in as an administrator
            </button>
          </SignInButton>
        </SignedOut>
      </div>
    </main>
  );
}
