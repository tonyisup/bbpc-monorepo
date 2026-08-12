'use client';

import { useState } from 'react';
import { useSession } from './SessionProvider';
import { useUniqueId } from '@/hooks/useUniqueId';
import type { EditCue } from '@/types';

const CUE_TYPES: EditCue['type'][] = ['doxx-bleep', 'network-drop', 'dmca-music', 'spoiler', 'other'];

const CUE_COLORS: Record<EditCue['type'], string> = {
  'doxx-bleep': 'bg-red-500/20 border-red-500 text-red-300',
  'network-drop': 'bg-amber-500/20 border-amber-500 text-amber-300',
  'dmca-music': 'bg-purple-500/20 border-purple-500 text-purple-300',
  'spoiler': 'bg-sky-500/20 border-sky-500 text-sky-300',
  'other': 'bg-zinc-500/20 border-zinc-500 text-zinc-300',
};

export function EditCuePanel() {
  const { state, dispatch, elapsedMs } = useSession();
  const [activeType, setActiveType] = useState<EditCue['type']>('doxx-bleep');
  const [reason, setReason] = useState('');
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const newId = useUniqueId('edit');

  const handleStartCue = () => {
    if (activeCueId) return;
    const id = newId();
    setActiveCueId(id);
    dispatch({
      type: 'ADD_EDIT_CUE',
      cue: {
        id,
        start_ms: elapsedMs,
        end_ms: null,
        type: activeType,
        reason: reason.trim() || undefined,
        author: state.hostName,
      },
    });
  };

  const handleEndCue = () => {
    if (!activeCueId) return;
    dispatch({ type: 'UPDATE_EDIT_CUE', id: activeCueId, end_ms: elapsedMs });
    setActiveCueId(null);
    setReason('');
  };

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
        Edit Cues ({state.editCues.length})
      </h2>

      {/* Cue type selector */}
      <div className="flex flex-wrap gap-2">
        {CUE_TYPES.map(type => (
          <button
            key={type}
            onClick={() => setActiveType(type)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
              activeType === type
                ? CUE_COLORS[type]
                : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)]'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Reason input */}
      <input
        type="text"
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason (optional)..."
        className="px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
      />

      {/* Start/End cue button */}
      {activeCueId ? (
        <button
          onClick={handleEndCue}
          className="px-4 py-3 text-sm font-bold rounded-lg bg-[var(--danger)] text-white hover:opacity-90 transition-opacity animate-pulse"
        >
          END {activeType.toUpperCase()} CUE
        </button>
      ) : (
        <button
          onClick={handleStartCue}
          className="px-4 py-3 text-sm font-medium rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] hover:border-[var(--accent)] transition-colors"
        >
          Start {activeType} cue
        </button>
      )}

      {/* Cue list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {state.editCues.length === 0 && (
          <p className="text-sm text-[var(--muted)] text-center py-8">
            No edit cues. Start a cue to mark regions for post-processing.
          </p>
        )}
        {[...state.editCues].reverse().map(cue => (
          <div
            key={cue.id}
            className={`flex items-start gap-3 p-3 rounded-lg border animate-fade-in-up ${
              cue.end_ms === null ? 'border-[var(--danger)] bg-[var(--danger)]/10' : 'border-[var(--card-border)] bg-[var(--card-bg)]'
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${CUE_COLORS[cue.type]}`}>
                  {cue.type}
                </span>
                {cue.end_ms === null && (
                  <span className="text-[10px] text-[var(--danger)] font-medium">ACTIVE</span>
                )}
              </div>
              {cue.reason && <p className="text-sm mt-1">{cue.reason}</p>}
              <div className="flex items-center gap-3 mt-1 text-xs text-[var(--muted)]">
                <span className="font-mono tabular-nums">
                  {(cue.start_ms / 1000).toFixed(1)}s
                  {cue.end_ms !== null && ` → ${(cue.end_ms / 1000).toFixed(1)}s`}
                </span>
                <span>{cue.author}</span>
              </div>
            </div>
            <button
              onClick={() => dispatch({ type: 'DELETE_EDIT_CUE', id: cue.id })}
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
