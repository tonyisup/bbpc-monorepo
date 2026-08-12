'use client';

import { useState } from 'react';
import { useSession } from './SessionProvider';
import { useUniqueId } from '@/hooks/useUniqueId';

export function NotesPanel() {
  const { state, dispatch, elapsedMs } = useSession();
  const [text, setText] = useState('');
  const newId = useUniqueId('note');

  const handleAddNote = () => {
    if (!text.trim()) return;
    dispatch({
      type: 'ADD_NOTE',
      note: {
        id: newId(),
        timestamp_ms: elapsedMs,
        text: text.trim(),
        author: state.hostName,
      },
    });
    setText('');
  };

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
        Session Notes ({state.notes.length})
      </h2>

      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddNote()}
          placeholder="Type a note..."
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
        />
        <button
          onClick={handleAddNote}
          disabled={!text.trim()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {state.notes.length === 0 && (
          <p className="text-sm text-[var(--muted)] text-center py-8">
            No notes yet. Add timestamped notes during recording.
          </p>
        )}
        {[...state.notes].reverse().map(note => (
          <div
            key={note.id}
            className="flex items-start gap-3 p-3 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] animate-fade-in-up"
          >
            <span className="font-mono text-xs text-[var(--accent)] tabular-nums whitespace-nowrap mt-0.5">
              {(note.timestamp_ms / 1000).toFixed(1)}s
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm break-words">{note.text}</p>
              <span className="text-xs text-[var(--muted)]">{note.author}</span>
            </div>
            <button
              onClick={() => dispatch({ type: 'DELETE_NOTE', id: note.id })}
              className="text-xs text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
