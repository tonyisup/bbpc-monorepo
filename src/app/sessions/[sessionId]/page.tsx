import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { DashboardApp } from '@/components/dashboard/DashboardApp';
import { getParticipantForGrant, getSession } from '@/lib/sessions/store';
import { SESSION_GRANTS_COOKIE, readSessionGrantsFromCookieValue } from '@/lib/sessions/cookies';

function getOrigin(headersList: Headers): string {
  const proto = headersList.get('x-forwarded-proto') ?? 'http';
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host');
  return host ? `${proto}://${host}` : '';
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const cookieStore = await cookies();
  const grants = readSessionGrantsFromCookieValue(cookieStore.get(SESSION_GRANTS_COOKIE)?.value);
  const grant = grants.find(candidate => candidate.sessionId === sessionId);
  const participant = await getParticipantForGrant(sessionId, grant);

  if (!participant) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[var(--background)] text-[var(--foreground)] px-6">
        <div className="max-w-sm w-full border border-[var(--card-border)] bg-[var(--card-bg)] rounded p-6">
          <h1 className="text-xl font-semibold mb-2">Invite required</h1>
          <p className="text-sm text-[var(--muted)]">
            This recording session is private. Ask the host for the invite link.
          </p>
        </div>
      </main>
    );
  }

  const session = await getSession(sessionId, grant!);
  if (!session) notFound();

  const headersList = await headers();
  const origin = getOrigin(headersList);
  const inviteUrl = `${origin}/join/${session.inviteToken}`;

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
