'use client';

import { createContext, useContext, useCallback, useRef } from 'react';

interface AudioManager {
  play: (url: string, options?: { record?: boolean }) => HTMLAudioElement;
  stopAll: () => void;
  setSounderDestination: (dest: MediaStreamAudioDestinationNode | null) => void;
}

const AudioContext = createContext<AudioManager | null>(null);

type MediaElementSourceFactory = (
  ctx: AudioContext,
  audio: HTMLMediaElement,
) => MediaElementAudioSourceNode;

export function connectSounderToRecordingGraph(
  audio: HTMLMediaElement,
  destination: MediaStreamAudioDestinationNode,
  createSource: MediaElementSourceFactory = (ctx, media) => ctx.createMediaElementSource(media),
) {
  const ctx = destination.context as AudioContext;
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }

  const source = createSource(ctx, audio);
  source.connect(ctx.destination);
  source.connect(destination);
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const activeRef = useRef<Set<HTMLAudioElement>>(new Set());
  const sounderDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const play = useCallback((url: string, options: { record?: boolean } = {}): HTMLAudioElement => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    activeRef.current.add(audio);

    // Route to sounder destination if recording
    if (sounderDestRef.current && options.record !== false) {
      try {
        connectSounderToRecordingGraph(audio, sounderDestRef.current);
      } catch {
        // If already connected or CORS issue, just play normally
      }
    }

    audio.addEventListener('ended', () => {
      activeRef.current.delete(audio);
    });

    audio.addEventListener('error', () => {
      activeRef.current.delete(audio);
    });

    audio.play().catch(() => {
      activeRef.current.delete(audio);
    });

    return audio;
  }, []);

  const stopAll = useCallback(() => {
    for (const audio of activeRef.current) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    activeRef.current.clear();
  }, []);

  const setSounderDestination = useCallback((dest: MediaStreamAudioDestinationNode | null) => {
    sounderDestRef.current = dest;
  }, []);

  return (
    <AudioContext.Provider value={{ play, stopAll, setSounderDestination }}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudio(): AudioManager {
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudio must be used within AudioProvider');
  return ctx;
}
