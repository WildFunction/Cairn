import { describe, expect, test } from 'bun:test';
import { PROCESSOR_NAME, workletSource, type FromWorklet, type ToWorklet } from '../../src/audio/worklet';

const RATE = 24000;
const QUANTUM = 128;

interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

/**
 * Evaluates the module text the way the worklet scope would: with nothing in
 * reach but that scope's own globals. A reference to anything else — an import,
 * a bundler helper — throws here instead of silently in the audio thread.
 */
function boot(): { send: (m: ToWorklet) => void; reports: FromWorklet[]; quantum: () => Float32Array } {
  const reports: FromWorklet[] = [];
  const port = {
    onmessage: undefined as ((e: { data: ToWorklet }) => void) | undefined,
    postMessage: (m: FromWorklet) => reports.push(m),
  };
  class AudioWorkletProcessor {
    readonly port = port;
  }
  let made: Processor | undefined;
  const registerProcessor = (name: string, ctor: new () => Processor): void => {
    expect(name).toBe(PROCESSOR_NAME);
    made = new ctor();
  };
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', workletSource())(
    AudioWorkletProcessor, registerProcessor, RATE,
  );
  const processor = made;
  if (!processor) throw new Error('the module registered nothing');
  return {
    send: (m) => port.onmessage?.({ data: m }),
    reports,
    quantum: () => {
      const out = new Float32Array(QUANTUM);
      processor.process([], [[out]]);
      return out;
    },
  };
}

function tone(seconds: number): Float32Array {
  const out = new Float32Array(seconds * RATE);
  for (let i = 0; i < out.length; i += 1) out[i] = 0.5 * Math.sin((2 * Math.PI * 150 * i) / RATE);
  return out;
}

const peak = (x: Float32Array): number => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const last = (reports: FromWorklet[]): FromWorklet | undefined => reports[reports.length - 1];

describe('the narration worklet', () => {
  test('is self-contained, and silent until told to play', () => {
    const w = boot();
    w.send({ type: 'load', samples: tone(2), frame: 0, epoch: 1 });
    expect(peak(w.quantum())).toBe(0);
    expect(last(w.reports)).toEqual({ frame: 0, epoch: 1, ended: false });
  });

  test('plays at the rate it is given and reports where it is', () => {
    const w = boot();
    w.send({ type: 'load', samples: tone(4), frame: 0, epoch: 1 });
    w.quantum();
    w.send({ type: 'rate', rate: 2 });
    w.send({ type: 'play' });
    for (let i = 0; i < 100; i += 1) w.quantum();
    expect(peak(w.quantum())).toBeGreaterThan(0.4);
    expect((last(w.reports)?.frame ?? 0) / (100 * QUANTUM)).toBeCloseTo(2, 1);
  });

  test('a pause fades out within one quantum instead of cutting', () => {
    const w = boot();
    w.send({ type: 'load', samples: tone(2), frame: 0, epoch: 1 });
    w.send({ type: 'play' });
    for (let i = 0; i < 20; i += 1) w.quantum();
    w.send({ type: 'pause' });
    const fading = w.quantum();
    expect(peak(fading.subarray(0, 32))).toBeGreaterThan(0.1);
    expect(Math.abs(fading[QUANTUM - 1] ?? 1)).toBeLessThan(0.02);
    expect(peak(w.quantum())).toBe(0);
  });

  test('a seek reports under its own epoch, so an older report cannot undo it', () => {
    const w = boot();
    w.send({ type: 'load', samples: tone(4), frame: 0, epoch: 1 });
    w.send({ type: 'play' });
    for (let i = 0; i < 20; i += 1) w.quantum();
    w.send({ type: 'seek', frame: 3 * RATE, epoch: 2 });
    for (let i = 0; i < 3; i += 1) w.quantum();
    const after = w.reports.filter((r) => r.epoch === 2);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((r) => r.frame >= 3 * RATE)).toBe(true);
  });

  test('says so once when the audio runs out', () => {
    const w = boot();
    w.send({ type: 'load', samples: tone(0.1), frame: 0, epoch: 1 });
    w.send({ type: 'play' });
    for (let i = 0; i < 60; i += 1) w.quantum();
    expect(w.reports.filter((r) => r.ended)).toHaveLength(1);
    expect(last(w.reports)?.frame).toBe(0.1 * RATE);
  });
});
