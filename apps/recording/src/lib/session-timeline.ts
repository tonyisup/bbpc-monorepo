import type { RecordingRun } from '@/types';

/**
 * A session has one timeline. Each Start/Stop pair is a run; paused time
 * between runs is not part of the timeline, so the timeline position is
 * frozen while paused and resumes where it stopped.
 */

function runDurationMs(run: RecordingRun, now: number): number {
  const end = run.stopped_at_epoch_ms ?? now;
  return Math.max(0, end - run.started_at_epoch_ms);
}

function openRun(runs: RecordingRun[]): RecordingRun | undefined {
  const last = runs.at(-1);
  return last && last.stopped_at_epoch_ms === null ? last : undefined;
}

export function startRecordingRun(runs: RecordingRun[], startedAt: number): RecordingRun[] {
  const open = openRun(runs);
  if (open?.started_at_epoch_ms === startedAt) return runs;
  // A new start without a stop (for example a host tab that crashed) ends the
  // previous run where the new one begins.
  const closed = open ? stopRecordingRun(runs, startedAt) : runs;
  const last = closed.at(-1);
  const start = Math.max(startedAt, last?.stopped_at_epoch_ms ?? startedAt);
  const timelineStart = last ? last.timeline_start_ms + runDurationMs(last, start) : 0;
  return [...closed, { started_at_epoch_ms: start, stopped_at_epoch_ms: null, timeline_start_ms: timelineStart }];
}

export function stopRecordingRun(runs: RecordingRun[], stoppedAt: number): RecordingRun[] {
  const open = openRun(runs);
  if (!open) return runs;
  return [
    ...runs.slice(0, -1),
    { ...open, stopped_at_epoch_ms: Math.max(stoppedAt, open.started_at_epoch_ms) },
  ];
}

/**
 * The run a wall-clock time belongs to: the run it falls in, or the next run
 * when it falls in a pause (a slightly early clock or a late join).
 */
export function recordingRunAt(runs: RecordingRun[], epochMs: number): RecordingRun | null {
  return runs.find(run => run.stopped_at_epoch_ms === null || epochMs <= run.stopped_at_epoch_ms) ?? null;
}

/** Timeline position of a wall-clock time. Paused time maps to the pause point. */
export function timelineMsAt(runs: RecordingRun[], epochMs: number): number {
  const run = recordingRunAt(runs, epochMs);
  if (run) {
    return run.timeline_start_ms + Math.max(0, epochMs - run.started_at_epoch_ms);
  }
  const last = runs.at(-1);
  return last ? last.timeline_start_ms + runDurationMs(last, epochMs) : 0;
}

/** Total recorded timeline length; for an open run, measured up to `now`. */
export function timelineLengthMs(runs: RecordingRun[], now: number): number {
  const last = runs.at(-1);
  return last ? last.timeline_start_ms + runDurationMs(last, now) : 0;
}

/**
 * Where an upload that began at `startedAt` sits on the timeline, and how long
 * it can play before its run ended (null while the run is still open).
 */
export function uploadTimelinePlacement(
  runs: RecordingRun[],
  startedAt: number,
): { runIndex: number; offsetMs: number; maxDurationMs: number | null } | null {
  const run = recordingRunAt(runs, startedAt);
  if (!run) return null;
  const effectiveStart = Math.max(startedAt, run.started_at_epoch_ms);
  return {
    runIndex: runs.indexOf(run),
    offsetMs: run.timeline_start_ms + (effectiveStart - run.started_at_epoch_ms),
    maxDurationMs: run.stopped_at_epoch_ms === null ? null : run.stopped_at_epoch_ms - effectiveStart,
  };
}
