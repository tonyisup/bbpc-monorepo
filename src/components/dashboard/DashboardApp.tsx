'use client';

import { useState } from 'react';
import { ConvexClientProvider } from '@/components/ConvexClientProvider';
import { SessionProvider } from '@/components/SessionProvider';
import { AudioProvider } from '@/components/AudioProvider';
import { PresenceProvider } from '@/components/PresenceProvider';
import { DashboardHeader } from '@/components/DashboardHeader';
import { SounderBoard } from '@/components/SounderBoard';
import { FavoritesSidebar } from '@/components/FavoritesSidebar';
import { NotesPanel } from '@/components/NotesPanel';
import { EditCuePanel } from '@/components/EditCuePanel';
import { SegmentPanel } from '@/components/SegmentPanel';
import { ExportBar } from '@/components/ExportBar';
import { useSession } from '@/components/SessionProvider';
import type { SessionRole, SessionStatus } from '@/lib/sessions/types';

type Tab = 'sounders' | 'notes' | 'edit' | 'segments';

const TABS: { id: Tab; label: string }[] = [
  { id: 'sounders', label: 'Sounders' },
  { id: 'notes', label: 'Notes' },
  { id: 'edit', label: 'Edit Cues' },
  { id: 'segments', label: 'Segments' },
];

interface DashboardAppProps {
  sessionId: string;
  inviteUrl: string;
  episode: string;
  date: string;
  hostName: string;
  participantClientId: string;
  participantAccessToken: string;
  participantRole: SessionRole;
  initialStatus: SessionStatus;
  initialEndedAt: string | null;
}

function DashboardContent() {
  const [activeTab, setActiveTab] = useState<Tab>('sounders');
  const { toManifest, sessionStatus, endedAt } = useSession();
  const sessionEnded = sessionStatus === 'ended';

  return (
    <div className="flex flex-col h-screen">
      <DashboardHeader />
      {sessionEnded && (
        <div className="px-6 py-2 border-b border-[var(--warning)]/30 bg-[var(--warning)]/10 text-xs text-[var(--warning)]">
          Session ended{endedAt ? ` at ${endedAt.replace('T', ' ').slice(0, 19)} UTC` : ''}. Export remains available.
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 shrink-0 border-r border-[var(--card-border)] overflow-hidden hidden lg:flex flex-col bg-[var(--card-bg)]">
          <FavoritesSidebar />
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">
          <nav className="flex border-b border-[var(--card-border)] bg-[var(--card-bg)]">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'text-white border-b-2 border-[var(--accent)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-hidden">
            {activeTab === 'sounders' && <SounderBoard />}
            {activeTab === 'notes' && <NotesPanel />}
            {activeTab === 'edit' && <EditCuePanel />}
            {activeTab === 'segments' && <SegmentPanel />}
          </div>
        </main>
      </div>

      <ExportBar manifest={toManifest()} />
    </div>
  );
}

export function DashboardApp({
  sessionId,
  inviteUrl,
  episode,
  date,
  hostName,
  participantClientId,
  participantAccessToken,
  participantRole,
  initialStatus,
  initialEndedAt,
}: DashboardAppProps) {
  return (
    <ConvexClientProvider>
      <PresenceProvider sessionId={sessionId}>
        <AudioProvider>
          <SessionProvider
            sessionId={sessionId}
            inviteUrl={inviteUrl}
            episode={episode}
            date={date}
            hostName={hostName}
            participantClientId={participantClientId}
            participantAccessToken={participantAccessToken}
            participantRole={participantRole}
            initialStatus={initialStatus}
            initialEndedAt={initialEndedAt}
          >
            <DashboardContent />
          </SessionProvider>
        </AudioProvider>
      </PresenceProvider>
    </ConvexClientProvider>
  );
}
