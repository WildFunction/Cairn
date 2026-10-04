/**
 * Pitch-preserving time stretch (WSOLA), the algorithm Chromium's audio renderer
 * runs for `playbackRate`. It stays in the signal path at every rate, so a rate
 * change is the next block landing somewhere else — nothing is torn down, which
 * is what WKWebView's own `playbackRate` does, stalling ~300ms each time.
 *
 * `makeStretcher` is stringified into the audio worklet (see `worklet.ts`), so
 * it may reference nothing outside its own body.
 */
export interface Stretcher {
  /** The input frame being heard. */
  position(): number;
  ended(): boolean;
  seek(frame: number): void;
  /** Fills `out`, consuming input at `rate` times real time. */
  render(out: Float32Array, rate: number): void;
}

export function makeStretcher(input: Float32Array, sampleRate: number): Stretcher {
  // Chromium's figures: 20ms blocks, half overlapped, matched within ±15ms.
  const hop = Math.round(sampleRate * 0.01);
  const size = hop * 2;
  const reach = Math.round(sampleRate * 0.015);
  /** The coarse pass compares at ~8kHz; speech periodicity survives that. */
  const stride = Math.max(1, Math.round(sampleRate / 8000));

  // Periodic Hann: the two halves sum to exactly 1, so an unstretched signal passes through untouched.
  const fade = new Float32Array(size);
  for (let i = 0; i < size; i += 1) fade[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);

  const tail = new Float32Array(hop);
  const ready = new Float32Array(hop);
  let readAt = hop;
  let chosen = -hop;
  /** Where the tempo says the next block starts. */
  let wanted = 0;
  /** Where it would start if the previous block simply carried on. */
  let natural = 0;

  const at = (i: number): number => input[i] ?? 0;

  const likeness = (candidate: number, step: number): number => {
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < size; i += step) {
      const c = at(candidate + i);
      dot += at(natural + i) * c;
      energy += c * c;
    }
    return dot / Math.sqrt(energy + 1e-9);
  };

  const bestNear = (from: number, to: number, step: number): number => {
    let best = from;
    let top = -Infinity;
    for (let c = from; c <= to; c += step) {
      const score = likeness(c, step);
      if (score > top) { top = score; best = c; }
    }
    return best;
  };

  const advance = (rate: number): void => {
    const centre = Math.round(wanted);
    if (Math.abs(natural - centre) <= reach) {
      chosen = natural;
    } else {
      const coarse = bestNear(Math.max(0, centre - reach), centre + reach, stride);
      chosen = bestNear(Math.max(0, coarse - stride + 1), coarse + stride - 1, 1);
    }
    for (let i = 0; i < hop; i += 1) {
      ready[i] = (tail[i] ?? 0) + (fade[i] ?? 0) * at(chosen + i);
      tail[i] = (fade[hop + i] ?? 0) * at(chosen + hop + i);
    }
    natural = chosen + hop;
    wanted += hop * rate;
    readAt = 0;
  };

  return {
    position: () => Math.min(input.length, Math.max(0, chosen + readAt)),
    ended: () => chosen >= input.length && readAt === hop,
    seek: (frame) => {
      tail.fill(0);
      wanted = frame;
      natural = frame;
      chosen = frame - hop;
      readAt = hop;
    },
    render: (out, rate) => {
      for (let i = 0; i < out.length; i += 1) {
        if (readAt === hop) advance(rate);
        out[i] = ready[readAt] ?? 0;
        readAt += 1;
      }
    },
  };
}
