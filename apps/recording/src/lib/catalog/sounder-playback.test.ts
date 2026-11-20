// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { byteRange, sounderPath } from './sounder-playback';

describe('sounder playback route input', () => {
  it('accepts only one catalog-shaped audio path', () => {
    expect(sounderPath('Intros/Base.mp3')).toBe('Intros/Base.mp3');
    // Repeated query parameters arrive as an array and used to throw.
    expect(sounderPath(['a.mp3', 'b.mp3'])).toBeNull();
    expect(sounderPath(undefined)).toBeNull();
    expect(sounderPath('Intros/../secret.mp3')).toBeNull();
    expect(sounderPath('/Intros/Base.mp3')).toBeNull();
    expect(sounderPath('Intros/.hidden.mp3')).toBeNull();
    expect(sounderPath('notes/plan.txt')).toBeNull();
  });

  it('parses byte ranges without producing NaN', () => {
    expect(byteRange(undefined, 1_000)).toBeNull();
    expect(byteRange('bytes=0-99', 1_000)).toEqual({ start: 0, end: 99 });
    expect(byteRange('bytes=900-', 1_000)).toEqual({ start: 900, end: 999 });
    expect(byteRange('bytes=900-5000', 1_000)).toEqual({ start: 900, end: 999 });
    // Suffix ranges ask for the last n bytes.
    expect(byteRange('bytes=-500', 1_000)).toEqual({ start: 500, end: 999 });
    expect(byteRange('bytes=1000-', 1_000)).toBe('unsatisfiable');
    expect(byteRange('bytes=50-10', 1_000)).toBe('unsatisfiable');
    // Unsupported forms are ignored and the whole file is served.
    expect(byteRange('bytes=abc', 1_000)).toBeNull();
    expect(byteRange('bytes=0-1,5-9', 1_000)).toBeNull();
  });
});
