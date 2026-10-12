/**
 * Microsoft's Edge Read Aloud service behind the `Narrator` interface.
 *
 * Free and needs no key, like the `edge-tts` CLI this replaces — but spoken to
 * directly over its WebSocket rather than through a Python process. That removes
 * an install step the reader could not be asked to perform, and it is the only
 * shape that could ever run inside a sandboxed player.
 *
 * Everything here opens a socket or writes a file. That is why it lives in
 * `runtime/`: the cue arithmetic is pure and lives in `pipeline/tts.ts`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Communicate } from 'edge-tts-universal';
import type { DraftDeck, NodeDeck } from '../types';
import {
  assembleDeck, cuesFromBoundaries, DEFAULT_VOICE, type Narrator, type SpeechBoundary,
  type TtsOptions,
} from '../pipeline/tts';
import { CairnError } from '../errors';

const CONNECT_TIMEOUT_MS = 20_000;
const PROBE_TEXT = 'Cairn';
const SPEAK_ATTEMPTS = 3;

interface Speech {
  readonly audio: Uint8Array;
  readonly boundaries: readonly SpeechBoundary[];
}

let reachable = false;

/** Drop the memoised probe, so "the network is back now" is answerable without a restart. */
export function forgetNarrationProbe(): void {
  reachable = false;
}

/**
 * Checked before the first model call, not at synthesis time.
 *
 * Synthesis runs last, so a service that cannot be reached would otherwise surface
 * only after paying for every station's slides.
 */
export async function ensureNarrationReachable(): Promise<void> {
  if (reachable) return;
  try {
    // Synthesised, not listed: the voice list kept answering while every synthesis got a 403
    await run(PROBE_TEXT, DEFAULT_VOICE);
    reachable = true;
  } catch (cause) {
    throw new CairnError('tts_missing', {}, String(cause).slice(0, 300));
  }
}

export function edgeTtsNarrator(defaults: TtsOptions = {}): Narrator {
  return {
    name: 'edge-tts-ws',
    ensureReady: ensureNarrationReachable,
    speak: (deck, audioPath, options) =>
      synthesize(deck, audioPath, { ...defaults, ...options }),
  };
}

/**
 * Speak a few words, for auditioning a voice.
 *
 * No cues and no deck: the reader is judging how a voice sounds.
 */
export async function speakSample(
  text: string,
  voice: string,
  audioPath: string,
): Promise<void> {
  const { audio } = await run(text, voice);
  await mkdir(dirname(audioPath), { recursive: true });
  await writeFile(audioPath, audio);
}

export async function synthesize(
  deck: DraftDeck,
  audioPath: string,
  options: TtsOptions = {},
): Promise<NodeDeck> {
  const text = deck.sentences.join('');
  const { audio, boundaries } = await run(text, options.voice ?? DEFAULT_VOICE, options.signal);

  const cues = cuesFromBoundaries(text, boundaries);
  if (cues.length === 0) throw new CairnError('tts_no_cues');

  await mkdir(dirname(audioPath), { recursive: true });
  await writeFile(audioPath, audio);

  return assembleDeck(deck, cues, audioPath);
}

/** The service turns away about one connection in eight; failing the station would pay for its slides again. */
async function run(
  text: string,
  voice: string,
  signal?: AbortSignal,
): Promise<Speech> {
  let last: unknown;
  for (let n = 1; n <= SPEAK_ATTEMPTS; n += 1) {
    try {
      return await speakOnce(text, voice, signal);
    } catch (cause) {
      last = cause;
      if (signal?.aborted) break;
    }
  }
  throw last;
}

async function speakOnce(
  text: string,
  voice: string,
  signal?: AbortSignal,
): Promise<Speech> {
  const parts: Uint8Array[] = [];
  const boundaries: SpeechBoundary[] = [];

  try {
    const communicate = new Communicate(text, { voice, connectionTimeout: CONNECT_TIMEOUT_MS });
    for await (const chunk of communicate.stream()) {
      // Breaking out closes the socket; there is no separate cancel to call
      if (signal?.aborted) throw new CairnError('tts_failed', {}, 'aborted');

      if (chunk.type === 'audio' && chunk.data) {
        parts.push(chunk.data);
      } else if (chunk.type === 'WordBoundary'
        && chunk.offset !== undefined && chunk.duration !== undefined) {
        boundaries.push({ text: chunk.text ?? '', offset: chunk.offset, duration: chunk.duration });
      }
    }
  } catch (cause) {
    if (cause instanceof CairnError) throw cause;
    throw new CairnError('tts_failed', {}, String(cause).slice(-300));
  }

  if (parts.length === 0) throw new CairnError('tts_failed', {}, 'no audio received');
  return { audio: concat(parts), boundaries };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
