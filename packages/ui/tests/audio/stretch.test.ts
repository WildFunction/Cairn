import { describe, expect, test } from 'bun:test';
import { makeStretcher } from '../../src/audio/stretch';

const RATE = 24000;
const QUANTUM = 128;

/** A voiced-speech stand-in: a 150Hz fundamental with harmonics, loud throughout. */
function voice(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / RATE;
    out[i] = 0.5 * Math.sin(2 * Math.PI * 150 * t)
      + 0.25 * Math.sin(2 * Math.PI * 300 * t)
      + 0.12 * Math.sin(2 * Math.PI * 450 * t);
  }
  return out;
}

function render(s: ReturnType<typeof makeStretcher>, seconds: number, rate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let from = 0; from < out.length; from += QUANTUM) {
    s.render(out.subarray(from, Math.min(out.length, from + QUANTUM)), rate);
  }
  return out;
}

function rms(x: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += (x[i] ?? 0) ** 2;
  return Math.sqrt(sum / (to - from));
}

/** Upward zero crossings per second: the fundamental, as long as it dominates. */
function pitch(x: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < x.length; i += 1) if ((x[i - 1] ?? 0) < 0 && (x[i] ?? 0) >= 0) crossings += 1;
  return crossings / (x.length / RATE);
}

describe('makeStretcher', () => {
  test('at 1x the signal passes through untouched', () => {
    const input = voice(1);
    const out = render(makeStretcher(input, RATE), 0.5, 1);
    // Past the first block, which fades in from silence
    for (let i = 480; i < out.length; i += 1) expect(out[i]).toBeCloseTo(input[i] ?? 0, 5);
  });

  test.each([0.75, 1.5, 2, 3])('at %px it consumes input at that rate and keeps the pitch', (rate) => {
    const s = makeStretcher(voice(8), RATE);
    const out = render(s, 2, rate);
    expect(s.position() / RATE).toBeCloseTo(2 * rate, 1);
    // The opening fade-in can cost one crossing
    expect(Math.abs(pitch(out) - 150)).toBeLessThan(2);
  });

  /**
   * The bug this engine exists for: WKWebView's `playbackRate` stalled the
   * playhead ~300ms on every change. Here a change may cost neither a gap in
   * the sound nor a beat before the new rate takes hold.
   */
  test.each([[1, 2], [2, 1], [1, 3], [3, 1.5]])('switching %px → %px leaves no gap and no lag', (from, to) => {
    const s = makeStretcher(voice(10), RATE);
    const before = render(s, 1, from);
    const switchedAt = s.position();
    const after = render(s, 0.1, to);

    expect((s.position() - switchedAt) / RATE).toBeCloseTo(0.1 * to, 1);

    const steady = rms(before, RATE / 2, RATE);
    const window = RATE * 0.005;
    for (let start = 0; start + window <= after.length; start += window) {
      const level = rms(after, start, start + window);
      expect(level).toBeGreaterThan(steady * 0.6);
      expect(level).toBeLessThan(steady * 1.6);
    }
  });

  test('seeking moves the playhead and fades in rather than clicking', () => {
    const s = makeStretcher(voice(4), RATE);
    render(s, 0.5, 2);
    s.seek(2 * RATE);
    expect(s.position()).toBe(2 * RATE);
    const out = render(s, 0.1, 1);
    expect(Math.abs(out[0] ?? 1)).toBeLessThan(0.001);
    expect(s.position() / RATE).toBeCloseTo(2.1, 2);
  });

  test('ends once the input is spent, and renders silence after', () => {
    const s = makeStretcher(voice(0.5), RATE);
    expect(s.ended()).toBe(false);
    render(s, 0.3, 2);
    expect(s.ended()).toBe(true);
    expect(s.position()).toBe(0.5 * RATE);
    expect(rms(render(s, 0.05, 2), 0, 1200)).toBe(0);
  });
});
