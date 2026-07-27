'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useSession } from './SessionProvider';
import { useAudio } from './AudioProvider';
import { usePresence } from './PresenceProvider';
import type { Sounder as SounderItem } from '@/types';
import {
  BBPC_CLIENT_API_VERSION,
  recordingApi,
} from '@/lib/convex/api';

const EMPTY_FAVORITES: SounderItem[] = [];
const FAVORITES_STORAGE_KEY = 'bbpc-favorites-v1';

function isStoredSounder(value: unknown): value is SounderItem {
  if (!value || typeof value !== 'object') return false;
  const sounder = value as Partial<SounderItem>;

  return (
    typeof sounder.id === 'string' &&
    typeof sounder.name === 'string' &&
    typeof sounder.category === 'string' &&
    typeof sounder.duration === 'number' &&
    typeof sounder.url === 'string'
  );
}

function readStoredFavorites(): SounderItem[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return EMPTY_FAVORITES;

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY_FAVORITES;

    return parsed.filter(isStoredSounder);
  } catch {
    return EMPTY_FAVORITES;
  }
}

function writeStoredFavorites(favorites: SounderItem[]) {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // Persistence is a convenience layer; Convex remains the source of truth.
  }
}

export function FavoritesSidebar() {
  const {
    dispatch,
    sessionId,
    participantClientId,
    participantAccessToken,
    sessionStatus,
  } = useSession();
  const { play } = useAudio();
  const { members, connected, resetConnections } = usePresence();
  const savedFavorites = useQuery(recordingApi.favorites.list, {
    publicSessionId: sessionId,
    clientId: participantClientId,
    accessToken: participantAccessToken,
  });
  const replaceFavorites = useMutation(recordingApi.favorites.replaceAll);
  const [optimisticFavorites, setOptimisticFavorites] = useState<SounderItem[] | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const saveSequenceRef = useRef(0);
  const localFavoritesSeededRef = useRef(false);
  const favorites = optimisticFavorites ?? savedFavorites ?? EMPTY_FAVORITES;
  const sessionEnded = sessionStatus === 'ended';

  const saveFavorites = useCallback((next: SounderItem[]) => {
    writeStoredFavorites(next);

    const saveSequence = saveSequenceRef.current + 1;
    saveSequenceRef.current = saveSequence;
    void replaceFavorites({
      clientApiVersion: BBPC_CLIENT_API_VERSION,
      publicSessionId: sessionId,
      clientId: participantClientId,
      accessToken: participantAccessToken,
      favorites: next,
      updatedAt: Date.now(),
    }).then(() => {
      if (saveSequenceRef.current === saveSequence) {
        setOptimisticFavorites(null);
      }
    }).catch(err => {
      console.error('[Favorites] Failed to save favorites:', err);
    });
  }, [participantAccessToken, participantClientId, replaceFavorites, sessionId]);

  const updateFavorites = useCallback((updater: (current: SounderItem[]) => SounderItem[]) => {
    if (sessionEnded) return;

    const next = updater(favorites);
    setOptimisticFavorites(next);
    saveFavorites(next);
  }, [favorites, saveFavorites, sessionEnded]);

  useEffect(() => {
    if (savedFavorites === undefined) return;

    if (savedFavorites.length > 0) {
      localFavoritesSeededRef.current = true;
      writeStoredFavorites(savedFavorites);
      return;
    }

    if (localFavoritesSeededRef.current || sessionEnded) return;

    localFavoritesSeededRef.current = true;
    const storedFavorites = readStoredFavorites();
    if (storedFavorites.length === 0) return;

    void saveFavorites(storedFavorites);
  }, [saveFavorites, savedFavorites, sessionEnded]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // --- Play ---
  const handleTrigger = useCallback((s: SounderItem) => {
    if (sessionEnded) return;
    if (editMode) return;
    setPlayingId(s.id);
    const audio = play(s.url);
    audio.addEventListener('ended', () => { setPlayingId(null); });
    dispatch({ type: 'TRIGGER_SOUNDER', sounder: { id: s.id, name: s.name, category: s.category, duration: s.duration, url: s.url } });
  }, [dispatch, editMode, play, sessionEnded]);

  // --- Remove ---
  const handleRemove = useCallback((id: string) => {
    updateFavorites(prev => prev.filter(f => f.id !== id));
  }, [updateFavorites]);

  const handleClear = useCallback(() => {
    updateFavorites(() => []);
  }, [updateFavorites]);

  // --- Rename ---
  const startRename = useCallback((s: SounderItem) => {
    setRenamingId(s.id);
    setRenameText(s.name);
  }, []);

  const commitRename = useCallback(() => {
    if (!renamingId) return;
    const trimmed = renameText.trim();
    if (trimmed) {
      updateFavorites(prev => prev.map(f => f.id === renamingId ? { ...f, name: trimmed } : f));
    }
    setRenamingId(null);
    setRenameText('');
  }, [renamingId, renameText, updateFavorites]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameText('');
  }, []);

  // --- Reorder (drag within grid) ---
  const handlePadDragStart = useCallback((idx: number) => (e: React.DragEvent) => {
    if (!editMode) return;
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
    setDragIdx(idx);
  }, [editMode]);

  const handlePadDragOver = useCallback((idx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIdx !== null && idx !== dragIdx) {
      setDropIdx(idx);
    }
  }, [dragIdx]);

  const handlePadDrop = useCallback((targetIdx: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const sourceIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (isNaN(sourceIdx) || sourceIdx === targetIdx) return;
    updateFavorites(prev => {
      const next = [...prev];
      const [moved] = next.splice(sourceIdx, 1);
      next.splice(targetIdx > sourceIdx ? targetIdx - 1 : targetIdx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setDropIdx(null);
  }, [updateFavorites]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDropIdx(null);
  }, []);

  // --- Drop from external (Sounders tab) ---
  const handleSidebarDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleSidebarDragLeave = useCallback(() => { setDragOver(false); }, []);

  const handleSidebarDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json')) as SounderItem;
      if (!data?.id) return;
      updateFavorites(prev => {
        if (prev.some(f => f.id === data.id)) return prev;
        return [...prev, data];
      });
    } catch { /* ignore */ }
  }, [updateFavorites]);

  return (
    <div
      className={`flex flex-col h-full transition-colors ${dragOver ? 'bg-[var(--accent)]/10' : ''}`}
      onDragOver={handleSidebarDragOver}
      onDragLeave={handleSidebarDragLeave}
      onDrop={handleSidebarDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--card-border)]">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Favorites
          {favorites.length > 0 && (
            <span className="ml-1 text-[var(--accent)] font-normal normal-case">
              ({favorites.length})
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1.5">
          {favorites.length > 0 && !editMode && !sessionEnded && (
            <button
              onClick={() => setEditMode(true)}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--accent)] transition-colors px-1.5 py-0.5 rounded border border-transparent hover:border-[var(--card-border)]"
              title="Rearrange, rename, and remove favorites"
            >
              Edit
            </button>
          )}
          {editMode && (
            <button
              onClick={() => { setEditMode(false); cancelRename(); }}
              className="text-[10px] text-[var(--accent)] hover:text-white transition-colors px-1.5 py-0.5 rounded border border-[var(--accent)]/50 hover:border-[var(--accent)] bg-[var(--accent)]/10"
            >
              Done
            </button>
          )}
          {favorites.length > 0 && !editMode && !sessionEnded && (
            <button
              onClick={handleClear}
              className="text-[10px] text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
              title="Remove all favorites"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Edit mode hint */}
      {editMode && favorites.length > 0 && (
        <div className="px-3 py-1.5 bg-[var(--accent)]/5 border-b border-[var(--card-border)]">
          <p className="text-[10px] text-[var(--muted)]">
            Drag to reorder · Tap name to rename · ✕ to remove
          </p>
        </div>
      )}

      {/* Empty state */}
      {favorites.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <div className="text-2xl mb-2">🎵</div>
            <p className="text-xs text-[var(--muted)]">
              Drag sounders here from the Sounders tab to build your favorites.
            </p>
          </div>
        </div>
      )}

      {/* Favorites grid */}
      {favorites.length > 0 && (
        <div className="flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-2 gap-1.5">
            {favorites.map((s, idx) => (
              <div
                key={s.id}
                draggable={editMode}
                onDragStart={handlePadDragStart(idx)}
                onDragOver={handlePadDragOver(idx)}
                onDrop={handlePadDrop(idx)}
                onDragEnd={handleDragEnd}
                className={`relative group rounded-lg transition-all ${
                  editMode && dropIdx === idx && dragIdx !== idx
                    ? 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--card-bg)]'
                    : ''
                } ${editMode && dragIdx === idx ? 'opacity-40' : ''}`}
              >
                {/* Playing indicator */}
                {playingId === s.id && (
                  <div className="absolute inset-0 rounded-lg border border-[var(--accent)] bg-[var(--accent)]/20 z-10 pointer-events-none" />
                )}

                {/* Edit overlay: remove button */}
                {editMode && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(s.id); }}
                    className="absolute -top-1 -right-1 z-20 w-5 h-5 rounded-full bg-[var(--danger)] text-white text-[10px] font-bold flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
                  >
                    ✕
                  </button>
                )}

                {/* Pad content */}
                {renamingId === s.id ? (
                  <input
                    ref={renameInputRef}
                    value={renameText}
                    onChange={e => setRenameText(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') cancelRename(); }}
                    onClick={e => e.stopPropagation()}
                    className="w-full px-2 py-1.5 text-xs font-medium rounded-lg border border-[var(--accent)] bg-[var(--card-bg)] text-[var(--foreground)] focus:outline-none text-left"
                  />
                ) : (
                  <button
                    onClick={() => { if (editMode) return; handleTrigger(s); }}
                    onDoubleClick={() => { if (editMode) startRename(s); }}
                    title={editMode ? 'Drag to reorder, double-click to rename' : s.name}
                    className={`w-full px-2 py-2 text-xs font-medium rounded-lg border transition-all text-left select-none ${
                      editMode
                        ? 'border-[var(--card-border)] bg-[var(--card-bg)] cursor-grab active:cursor-grabbing'
                        : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--accent)]/50 cursor-pointer'
                    }`}
                  >
                    <span className="block truncate leading-tight">{s.name}</span>
                    {!editMode && (
                      <span className="block text-[10px] text-[var(--muted)] mt-0.5">
                        {(s.duration / 1000).toFixed(1)}s
                      </span>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection Info Panel */}
      <div className="border-t border-[var(--card-border)] mt-auto shrink-0">
        <div className="flex items-center justify-between px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
            Online {members.length > 0 && <span className="text-[var(--accent)] normal-case">({members.length})</span>}
          </h3>
          <div className="flex items-center gap-1.5">
            {members.length > 1 && (
              <button
                onClick={() => resetConnections()}
                className="text-[9px] text-[var(--muted)] hover:text-[var(--danger)] transition-colors px-1 py-0.5 rounded border border-transparent hover:border-[var(--card-border)]"
                title="Reset connections (fixes duplicate entries)"
              >
                Reset
              </button>
            )}
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`} />
          </div>
        </div>

        {/* Channel info */}
        <div className="px-3 pb-1">
          <div className="flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
            <span>Channel:</span>
            <code className="text-[var(--accent)] bg-[var(--card-bg)] px-1 rounded">
              {sessionId}
            </code>
          </div>
        </div>

        {/* Member list */}
        <div className="px-3 pb-2 space-y-1">
          {members.length === 0 && (
            <p className="text-[10px] text-[var(--muted)]">No other hosts connected</p>
          )}
          {members.map(member => (
            <div key={member.id} className="flex items-center gap-2 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
              <span className="text-[var(--foreground)]">{member.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
