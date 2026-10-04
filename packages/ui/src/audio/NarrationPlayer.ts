import { PROCESSOR_NAME, workletSource, type FromWorklet, type ToWorklet } from './worklet';

/** edge-tts narrates at 24kHz; a context at the same rate halves the decoded buffer and the search. */
const SAMPLE_RATE = 24000;
/** A paused context still holds the output device open, which keeps the Mac awake. */
const SUSPEND_AFTER_MS = 400;
/** How often a playing station tells its listener where it is. */
const TIME_EVERY_MS = 250;
const VOLUME_SMOOTH_S = 0.015;

export interface NarrationEvents {
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
  /** Fires as the position moves: a few times a second playing, at once on a seek. */
  onTime: (seconds: number) => void;
}

/**
 * The deck's narration, played through a time-stretcher that never leaves the
 * signal path. Shaped like the slice of `HTMLMediaElement` the transport uses,
 * because that is what it replaced — see `stretch.ts` for why.
 */
export class NarrationPlayer {
  private readonly context: AudioContext;
  private readonly level: GainNode;
  private readonly module: Promise<void>;
  private node: AudioWorkletNode | undefined;
  private frames = 0;
  private frame = 0;
  private epoch = 0;
  private ticket = 0;
  private loaded = false;
  private playing = false;
  private wantsPlay = false;
  private finished = false;
  private rate = 1;
  private gain = 1;
  private silent = false;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private toldAt = 0;

  constructor(private readonly events: NarrationEvents) {
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.level = this.context.createGain();
    this.level.connect(this.context.destination);
    const url = URL.createObjectURL(new Blob([workletSource()], { type: 'text/javascript' }));
    this.module = this.context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
  }

  /** Replaces what is loaded. Rejects if the audio cannot be fetched or decoded. */
  async load(src: string, startAt: number, autoplay: boolean): Promise<void> {
    const ticket = ++this.ticket;
    this.pause();
    this.loaded = false;
    this.finished = false;
    this.frames = 0;
    this.frame = Math.round(startAt * SAMPLE_RATE);
    // Bumped before the wait, so the outgoing station's last reports cannot move the new one
    this.epoch += 1;
    this.wantsPlay = autoplay;

    const [bytes] = await Promise.all([fetchBytes(src), this.module]);
    const decoded = await this.context.decodeAudioData(bytes);
    if (ticket !== this.ticket) return;

    this.node ??= this.connect();
    const samples = decoded.getChannelData(0).slice();
    this.frames = samples.length;
    this.frame = Math.min(this.frame, this.frames);
    this.post({ type: 'load', samples, frame: this.frame, epoch: this.epoch }, [samples.buffer]);
    this.post({ type: 'rate', rate: this.rate });
    this.loaded = true;
    if (this.wantsPlay) await this.play();
  }

  get currentTime(): number {
    return this.frame / SAMPLE_RATE;
  }

  set currentTime(seconds: number) {
    const frame = Math.round(Math.min(Math.max(0, seconds), this.duration || Infinity) * SAMPLE_RATE);
    this.frame = frame;
    this.finished = false;
    this.epoch += 1;
    if (this.loaded) {
      this.post({ type: 'seek', frame, epoch: this.epoch });
      // A suspended context renders nothing, so the seek would wait for the next play
      if (!this.playing) this.wake();
    }
    this.events.onTime(this.currentTime);
  }

  get duration(): number {
    return this.frames / SAMPLE_RATE;
  }

  get paused(): boolean {
    return !this.playing;
  }

  get playbackRate(): number {
    return this.rate;
  }

  set playbackRate(rate: number) {
    this.rate = rate;
    this.post({ type: 'rate', rate });
  }

  get volume(): number {
    return this.gain;
  }

  set volume(volume: number) {
    this.gain = volume;
    this.applyLevel();
  }

  get muted(): boolean {
    return this.silent;
  }

  set muted(muted: boolean) {
    this.silent = muted;
    this.applyLevel();
  }

  /** Before the audio has loaded this only records the intent; `load` acts on it. */
  async play(): Promise<void> {
    this.wantsPlay = true;
    if (!this.loaded) return;
    clearTimeout(this.idle);
    // Stays pending until a gesture when the webview forbids autoplay, as `<audio>.play()` did.
    await this.context.resume();
    if (!this.wantsPlay || this.playing) return;
    if (this.finished) this.currentTime = 0;
    this.playing = true;
    this.post({ type: 'play' });
    this.events.onPlay();
  }

  pause(): void {
    this.wantsPlay = false;
    if (!this.playing) return;
    this.stopped();
    this.post({ type: 'pause' });
    this.events.onTime(this.currentTime);
    this.events.onPause();
  }

  dispose(): void {
    this.ticket += 1;
    clearTimeout(this.idle);
    this.node?.disconnect();
    void this.context.close();
  }

  private connect(): AudioWorkletNode {
    const node = new AudioWorkletNode(this.context, PROCESSOR_NAME, { numberOfInputs: 0, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.heard(e.data);
    node.connect(this.level);
    return node;
  }

  private heard(report: FromWorklet): void {
    if (report.epoch !== this.epoch) return;
    this.frame = report.frame;

    if (report.ended && this.playing) {
      this.finished = true;
      this.wantsPlay = false;
      this.stopped();
      this.events.onTime(this.currentTime);
      this.events.onPause();
      this.events.onEnded();
      return;
    }

    const now = performance.now();
    if (this.playing && now - this.toldAt >= TIME_EVERY_MS) {
      this.toldAt = now;
      this.events.onTime(this.currentTime);
    }
  }

  private stopped(): void {
    this.playing = false;
    this.wake();
  }

  /** Runs the context long enough to fade out or land a seek, then lets it rest. */
  private wake(): void {
    clearTimeout(this.idle);
    if (this.context.state !== 'running') void this.context.resume();
    this.idle = setTimeout(() => {
      if (!this.playing) void this.context.suspend();
    }, SUSPEND_AFTER_MS);
  }

  private applyLevel(): void {
    this.level.gain.setTargetAtTime(this.silent ? 0 : this.gain, this.context.currentTime, VOLUME_SMOOTH_S);
  }

  private post(message: ToWorklet, transfer: Transferable[] = []): void {
    this.node?.port.postMessage(message, transfer);
  }
}

async function fetchBytes(src: string): Promise<ArrayBuffer> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`narration ${res.status}: ${src}`);
  return res.arrayBuffer();
}
