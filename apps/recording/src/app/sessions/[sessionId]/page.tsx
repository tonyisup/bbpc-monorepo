import { auth } from '@clerk/nextjs/server';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { DashboardApp } from '@/components/dashboard/DashboardApp';
import { findParticipantForGrant, getSession } from '@/lib/sessions/store';
import { SESSION_GRANTS_COOKIE, readSessionGrantsFromCookieValue } from '@/lib/sessions/cookies';

function getOrigin(headersList: Headers): string {
  const proto = headersList.get('x-forwarded-proto') ?? 'http';
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host');
  return host ? `${proto}://${host}` : '';
}

const RECOVER_ERROR_MESSAGES = {
  'sign-in-required': 'Sign in with the account that created this session.',
  'not-owner': 'This account did not create this session. Ask the host for the invite link.',
  unavailable: 'Access could not be recovered right now. Try again.',
} as const;

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ recoverError?: string }>;
}) {
  const { sessionId } = await params;
  const { recoverError } = await searchParams;
  const cookieStore = await cookies();
  const grants = readSessionGrantsFromCookieValue(cookieStore.get(SESSION_GRANTS_COOKIE)?.value);
  const grant = grants.find(candidate => candidate.sessionId === sessionId);
  // A stale grant (for example, replaced by owner recovery) shows recovery.
  const participant = await findParticipantForGrant(sessionId, grant);

  if (!grant || !participant) {
    const { userId } = await auth();
    const recoverErrorMessage =
      recoverError && recoverError in RECOVER_ERROR_MESSAGES
        ? RECOVER_ERROR_MESSAGES[recoverError as keyof typeof RECOVER_ERROR_MESSAGES]
        : null;
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--background)] text-[var(--foreground)] px-6">
        <div className="max-w-sm w-full border border-[var(--card-border)] bg-[var(--card-bg)] rounded p-6">
          <h1 className="text-xl font-semibold mb-2">Invite required</h1>
          <p className="text-sm text-[var(--muted)]">
            This recording session is private. Ask the host for the invite link.
          </p>
          {recoverErrorMessage && (
            <p role="alert" className="mt-4 text-sm text-[var(--warning)]">{recoverErrorMessage}</p>
          )}
          {/* An owner whose browser lost the session grant can get a new one. */}
          {userId && (
            <form action={`/api/sessions/${encodeURIComponent(sessionId)}/recover`} method="post" className="mt-4">
              <button
                type="submit"
                className="w-full px-4 py-2 rounded-lg border border-[var(--card-border)] text-sm hover:border-[var(--accent)]"
              >
                I created this session
              </button>
            </form>
          )}
        </div>
      </main>
    );
  }

  const session = await getSession(sessionId, grant);
  if (!session) notFound();

  const headersList = await headers();
  const origin = getOrigin(headersList);
  const inviteUrl =
    participant.role === 'owner' && grant.inviteToken
      ? `${origin}/join/${grant.inviteToken}`
      : null;

  return (
    <DashboardApp
      sessionId={session.id}
      inviteUrl={inviteUrl}
      episode={session.episode}
      date={session.createdAt.slice(0, 10)}
      hostName={participant.displayName}
      participantClientId={participant.clientId}
      participantAccessToken={participant.accessToken}
      participantRole={participant.role}
      initialStatus={session.status}
      initialEndedAt={session.endedAt ?? null}
    />
  );
}
