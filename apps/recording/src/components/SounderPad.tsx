'use client';

import { useCallback } from 'react';
import type { Sounder } from '@/types';

interface SounderPadProps {
  sounder: Sounder;
  playing: boolean;
  onTrigger: (s: Sounder) => void;
  draggable?: boolean;
}

export function SounderPad({ sounder, playing, onTrigger, draggable = false }: SounderPadProps) {
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('application/json', JSON.stringify(sounder));
    e.dataTransfer.effectAllowed = 'copy';
  }, [sounder]);

  return (
    <button
      draggable={draggable}
      onDragStart={draggable ? handleDragStart : undefined}
      onClick={() => onTrigger(sounder)}
      className={`
        relative px-2.5 py-2 text-xs font-medium rounded-lg border transition-all text-left select-none
        ${playing
          ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-white'
          : 'border-[var(--card-border)] bg-[var(--card-bg)] hover:border-[var(--accent)]/50 hover:bg-[var(--card-bg)]/80'}
        ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
      `}
    >
      <span className="block truncate leading-tight">{sounder.name}</span>
      <span className="block text-[10px] text-[var(--muted)] mt-0.5">
        {(sounder.duration / 1000).toFixed(1)}s
      </span>
    </button>
  );
}
