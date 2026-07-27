'use client';

import { useState } from 'react';

type AdminOperation =
  | 'sounders'
  | 'templates'
  | 'cleanup';

export function RecordingAdminControls() {
  const [pending, setPending] = useState<AdminOperation | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function run(
    operation: AdminOperation,
    path: string,
    body?: object,
  ) {
    setPending(operation);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json() as {
        message?: string;
        count?: number;
        sessions?: number;
      };
      if (!response.ok) {
        throw new Error(result.message ?? `Request failed (${response.status})`);
      }
      setMessage(
        operation === 'cleanup'
          ? `Deleted ${String(result.sessions ?? 0)} ended sessions.`
          : `Updated ${String(result.count ?? 0)} ${operation}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed.');
    } finally {
      setPending(null);
    }
  }

  function cleanup() {
    if (!window.confirm('Delete recording sessions ended more than 30 days ago?')) {
      return;
    }
    void run('cleanup', '/api/admin/sessions/cleanup', {
      days: 30,
      limit: 25,
      confirmation: 'delete-ended-sessions',
    });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => void run('sounders', '/api/admin/sounders/refresh')}
        className="w-full px-4 py-2 rounded-lg border border-[var(--card-border)] hover:border-[var(--accent)] disabled:opacity-50"
      >
        {pending === 'sounders' ? 'Refreshing sounders…' : 'Refresh sounders from Azure'}
      </button>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => void run('templates', '/api/admin/segment-templates/seed')}
        className="w-full px-4 py-2 rounded-lg border border-[var(--card-border)] hover:border-[var(--accent)] disabled:opacity-50"
      >
        {pending === 'templates' ? 'Seeding templates…' : 'Seed segment templates'}
      </button>
      <button
        type="button"
        disabled={pending !== null}
        onClick={cleanup}
        className="w-full px-4 py-2 rounded-lg border border-[var(--danger)]/50 text-[var(--danger)] hover:border-[var(--danger)] disabled:opacity-50"
      >
        {pending === 'cleanup' ? 'Deleting ended sessions…' : 'Delete ended sessions older than 30 days'}
      </button>
      {message && (
        <p role="status" className="text-sm text-[var(--muted)]">
          {message}
        </p>
      )}
    </div>
  );
}
