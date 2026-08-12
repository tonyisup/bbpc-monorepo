'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSession } from './SessionProvider';
import { useAudio } from './AudioProvider';
import { SounderPad } from './SounderPad';

interface SounderFromApi {
  id: string;
  name: string;
  category: string;
  url: string;
  duration: number;
}

export function SounderBoard() {
  const { dispatch, sessionStatus } = useSession();
  const { play } = useAudio();
  const [apiSounders, setApiSounders] = useState<SounderFromApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sounders/list')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        setApiSounders(data.sounders || []);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Extract unique categories
  const categories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const s of apiSounders) {
      cats.set(s.category, (cats.get(s.category) || 0) + 1);
    }
    return Array.from(cats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [apiSounders]);

  // Filter sounders by search + category
  const filteredSounders = useMemo(() => {
    let result = apiSounders;
    if (activeCategory) {
      result = result.filter(s => s.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    }
    return result;
  }, [apiSounders, search, activeCategory]);

  // Group filtered sounders by category for display
  const grouped = useMemo(() => {
    const map = new Map<string, SounderFromApi[]>();
    for (const s of filteredSounders) {
      const list = map.get(s.category) ?? [];
      list.push(s);
      map.set(s.category, list);
    }
    return map;
  }, [filteredSounders]);

  const handleTrigger = useCallback((sounder: SounderFromApi) => {
    if (sessionStatus === 'ended') return;

    setPlayingId(sounder.id);
    const audio = play(sounder.url);
    audio.addEventListener('ended', () => {
      setPlayingId(null);
    });
    dispatch({
      type: 'TRIGGER_SOUNDER',
      sounder: {
        id: sounder.id,
        name: sounder.name,
        category: sounder.category,
        duration: sounder.duration,
        url: sounder.url,
      },
    });
  }, [dispatch, play, sessionStatus]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-sm text-[var(--muted)]">Loading sounders...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 gap-2">
        <div className="text-sm text-[var(--danger)]">Failed to load sounders</div>
        <div className="text-xs text-[var(--muted)]">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + filter bar */}
      <div className="flex flex-col gap-2 p-3 border-b border-[var(--card-border)]">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sounders..."
          className="w-full px-3 py-1.5 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
        />
        {/* Category pills */}
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all ${
              !activeCategory
                ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-white'
                : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)]'
            }`}
          >
            All ({apiSounders.length})
          </button>
          {categories.map(([cat, count]) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full border transition-all ${
                activeCategory === cat
                  ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-white'
                  : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)]'
              }`}
            >
              {cat} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Sounder grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredSounders.length === 0 && (
          <div className="text-center py-8 text-sm text-[var(--muted)]">
            No sounders match &quot;{search}&quot;
          </div>
        )}

        {Array.from(grouped.entries()).map(([category, sounders]) => (
          <div key={category} className="mb-4">
            <h3 className="text-xs font-medium text-[var(--muted)] mb-2">
              {category} ({sounders.length})
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {sounders.map(s => (
                <SounderPad
                  key={s.id}
                  sounder={s}
                  playing={playingId === s.id}
                  onTrigger={handleTrigger}
                  draggable
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
