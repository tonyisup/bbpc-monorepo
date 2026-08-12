'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from './SessionProvider';
import { useAudio } from './AudioProvider';
import { useUniqueId } from '@/hooks/useUniqueId';
import type { SegmentTemplate } from '@/types';

const SEGMENT_TYPES = [
  { value: 'intro', label: 'Intro' },
  { value: 'segment', label: 'Segment' },
  { value: 'news', label: 'News' },
  { value: 'ad', label: 'Ad' },
  { value: 'interview', label: 'Interview' },
  { value: 'outro', label: 'Outro' },
] as const;

export function SegmentPanel() {
  const { state, dispatch, elapsedMs } = useSession();
  const [label, setLabel] = useState('');
  const [segType, setSegType] = useState<string>('segment');
  const [activeSegId, setActiveSegId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<SegmentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const newId = useUniqueId('seg');
  const { play } = useAudio();

  // Load templates from Convex via the server API.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/segment-templates/list')
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        setTemplates(data.segmentTemplates || []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Apply a template: fill form + play intro sounder
  const handleTemplateClick = useCallback((tpl: SegmentTemplate) => {
    setLabel(tpl.label);
    setSegType(tpl.type);
    if (tpl.introSounder) {
      play(`/api/sounders/play?path=${encodeURIComponent(tpl.introSounder)}`);
    }
  }, [play]);

  const handleStartSegment = () => {
    if (activeSegId) return;
    const id = newId();
    setActiveSegId(id);
    dispatch({
      type: 'START_SEGMENT',
      segment: {
        id,
        start_ms: elapsedMs,
        end_ms: null,
        type: segType as 'intro' | 'segment' | 'ad' | 'outro' | 'news' | 'interview',
        label: label.trim() || SEGMENT_TYPES.find(s => s.value === segType)?.label || 'Segment',
      },
    });
  };

  const handleEndSegment = () => {
    if (!activeSegId) return;
    dispatch({ type: 'END_SEGMENT', id: activeSegId, end_ms: elapsedMs });
    setActiveSegId(null);
    setLabel('');
  };

  return (
    <div className="flex flex-col gap-4 p-4 h-full">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
        Segments ({state.segments.length})
      </h2>

      {/* Segment Templates */}
      {!loading && templates.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-[var(--muted)] mb-2">Quick Start</h3>
          <div className="flex flex-wrap gap-1.5">
            {templates.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => handleTemplateClick(tpl)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                  label === tpl.label && segType === tpl.type
                    ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-white'
                    : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--accent)]/50 hover:text-[var(--foreground)]'
                }`}
              >
                {tpl.label}
                {tpl.introSounder && <span className="ml-1 opacity-60">🔊</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Divider */}
      {(templates.length > 0 || loading) && (
        <div className="border-t border-[var(--card-border)]" />
      )}

      {/* Segment type selector */}
      <div>
        <h3 className="text-xs font-medium text-[var(--muted)] mb-2">Segment Type</h3>
        <div className="flex flex-wrap gap-2">
          {SEGMENT_TYPES.map(st => (
            <button
              key={st.value}
              onClick={() => setSegType(st.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                segType === st.value
                  ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-white'
                  : 'border-[var(--card-border)] text-[var(--muted)] hover:border-[var(--muted)]'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Label input */}
      <input
        type="text"
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder={`Label (default: ${SEGMENT_TYPES.find(s => s.value === segType)?.label})`}
        className="px-3 py-2 text-sm rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--foreground)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
      />

      {/* Start/End segment */}
      {activeSegId ? (
        <button
          onClick={handleEndSegment}
          className="px-4 py-3 text-sm font-bold rounded-lg bg-[var(--warning)] text-black hover:opacity-90 transition-opacity animate-pulse"
        >
          END SEGMENT
        </button>
      ) : (
        <button
          onClick={handleStartSegment}
          className="px-4 py-3 text-sm font-medium rounded-lg bg-[var(--card-bg)] border border-[var(--card-border)] hover:border-[var(--accent)] transition-colors"
        >
          Start Segment
        </button>
      )}

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {state.segments.length === 0 && (
          <p className="text-sm text-[var(--muted)] text-center py-8">
            No segments. Use a quick-start template above or create one manually.
          </p>
        )}
        {state.segments.map(seg => (
          <div
            key={seg.id}
            className={`flex items-start gap-3 p-3 rounded-lg border animate-fade-in-up ${
              seg.end_ms === null ? 'border-[var(--warning)] bg-[var(--warning)]/10' : 'border-[var(--card-border)] bg-[var(--card-bg)]'
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full border border-[var(--accent)] bg-[var(--accent)]/20 text-white">
                  {seg.type}
                </span>
                {seg.end_ms === null && (
                  <span className="text-[10px] text-[var(--warning)] font-medium">RECORDING</span>
                )}
              </div>
              <p className="text-sm font-medium mt-1">{seg.label}</p>
              <div className="text-xs text-[var(--muted)] mt-1 font-mono tabular-nums">
                {(seg.start_ms / 1000).toFixed(1)}s
                {seg.end_ms !== null && ` → ${(seg.end_ms / 1000).toFixed(1)}s`}
                {seg.end_ms !== null && ` (${((seg.end_ms - seg.start_ms) / 1000).toFixed(1)}s)`}
              </div>
            </div>
            <button
              onClick={() => dispatch({ type: 'DELETE_SEGMENT', id: seg.id })}
              className="text-xs text-[var(--muted)] hover:text-[var(--danger)] transition-colors shrink-0 mt-0.5"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
