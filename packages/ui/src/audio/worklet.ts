import { makeStretcher } from './stretch';

export const PROCESSOR_NAME = 'cairn-narration';

export type ToWorklet =
  | { readonly type: 'load'; readonly samples: Float32Array; readonly frame: number; readonly epoch: number }
  | { readonly type: 'seek'; readonly frame: number; readonly epoch: number }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'rate'; readonly rate: number };

/** `epoch` names the seek a report follows, so one sent before a seek cannot undo it. */
export interface FromWorklet {
  readonly frame: number;
  readonly epoch: number;
  readonly ended: boolean;
}

declare const sampleRate: number;
declare function registerProcessor(name: string, processor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

/**
 * Runs inside the worklet. Stringified along with `makeStretcher`, so it may
 * reference nothing but its arguments — and no class fields, which a bundler
 * lowers into a helper that would not exist over there.
 */
function register(name: string, make: typeof makeStretcher): void {
  /** A report every other quantum is ~11ms at 24kHz: finer than the pane redraws. */
  const REPORT_EVERY = 2;

  const voice = (port: MessagePort): ((out: Float32Array) => void) => {
    let stretcher: ReturnType<typeof make> | undefined;
    let playing = false;
    let rate = 1;
    let gain = 0;
    let seekTo: number | undefined;
    let epoch = 0;
    let quanta = 0;

    const report = (ended: boolean): void => {
      port.postMessage({ frame: seekTo ?? stretcher?.position() ?? 0, epoch, ended });
    };

    port.onmessage = (e: MessageEvent<ToWorklet>): void => {
      const m = e.data;
      if (m.type === 'play') playing = true;
      else if (m.type === 'pause') playing = false;
      else if (m.type === 'rate') rate = m.rate;
      else if (m.type === 'seek') { seekTo = m.frame; epoch = m.epoch; }
      else {
        stretcher = make(m.samples, sampleRate);
        playing = false;
        gain = 0;
        seekTo = m.frame;
        epoch = m.epoch;
      }
    };

    return (out) => {
      const audible = playing && seekTo === undefined;
      if (!stretcher || (gain === 0 && !audible)) {
        if (stretcher && seekTo !== undefined) {
          stretcher.seek(seekTo);
          seekTo = undefined;
          report(false);
        }
        return;
      }

      stretcher.render(out, rate);
      // Starts, stops and seeks ramp across one quantum; a hard edge is a click.
      const to = audible ? 1 : 0;
      if (gain !== 1 || to !== 1) {
        const step = (to - gain) / out.length;
        for (let i = 0; i < out.length; i += 1) out[i] = (out[i] ?? 0) * (gain + step * i);
      }
      gain = to;

      const ended = stretcher.ended();
      if (ended) { playing = false; gain = 0; }
      quanta += 1;
      if (ended || gain === 0 || quanta % REPORT_EVERY === 0) report(ended);
    };
  };

  class Narration extends AudioWorkletProcessor {
    declare fill: (out: Float32Array) => void;

    constructor() {
      super();
      this.fill = voice(this.port);
    }

    process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
      const out = outputs[0]?.[0];
      if (out) this.fill(out);
      return true;
    }
  }

  registerProcessor(name, Narration);
}

/** The worklet module as text: a Blob URL loads the same under Vite's dev server and `views://`. */
export function workletSource(): string {
  return `(${register.toString()})(${JSON.stringify(PROCESSOR_NAME)}, ${makeStretcher.toString()});`;
}
