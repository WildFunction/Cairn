/**
 * The page's side of the bridge to the app around it. The app owns the sound,
 * and so the clock; the page is told where the audio is and only carries that
 * forward between two tellings. Everything here is plain data and arithmetic.
 */
import type { NodeDeck } from '@cairn/core/types';
import { isLocale, type Locale } from '../../../packages/ui/src/i18n/locale';

export interface Station {
  readonly deck: NodeDeck;
  readonly stageTitle?: string;
  readonly stationNo: number;
  readonly locale: Locale;
}

/** Where the audio was at `at` (a `performance.now()` reading), and how it was moving. */
export interface Anchor {
  readonly ms: number;
  readonly rate: number;
  readonly playing: boolean;
  readonly at: number;
}

export interface StagePrefs {
  readonly captions: boolean;
  /** Multiplies the caption's size only: the one piece of stage type slide.css lets scale. */
  readonly captionScale: number;
  /** The app's controls are showing, so the caption sits above them. */
  readonly lifted: boolean;
}

export interface StageState {
  readonly station: Station | undefined;
  readonly anchor: Anchor;
  readonly prefs: StagePrefs;
}

export const INITIAL: StageState = {
  station: undefined,
  anchor: { ms: 0, rate: 1, playing: false, at: 0 },
  prefs: { captions: true, captionScale: 1, lifted: false },
};

/** The audio position the page believes in at `now`: the last sync, carried forward at its rate. */
export function clockAt(anchor: Anchor, now: number, durationMs: number): number {
  const ms = anchor.playing ? anchor.ms + (now - anchor.at) * anchor.rate : anchor.ms;
  return Math.min(Math.max(0, ms), Math.max(0, durationMs));
}

const finite = (value: unknown, fallback: number): number =>
  (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** A deck is the app's file, passed through untouched; only its outline is checked before it is drawn. */
export function toStation(value: unknown): Station {
  const message = (value ?? {}) as { deck?: unknown; stageTitle?: unknown; stationNo?: unknown; locale?: unknown };
  const deck = message.deck as Partial<NodeDeck> | undefined;
  if (!deck || !Array.isArray(deck.slides) || !Array.isArray(deck.narration) || typeof deck.durationMs !== 'number') {
    throw new Error('not a deck');
  }
  return {
    deck: deck as NodeDeck,
    ...(typeof message.stageTitle === 'string' && message.stageTitle ? { stageTitle: message.stageTitle } : {}),
    stationNo: Math.max(1, Math.round(finite(message.stationNo, 1))),
    locale: isLocale(message.locale) ? message.locale : 'en',
  };
}

export function toAnchor(value: unknown, now: number): Anchor {
  const message = (value ?? {}) as { ms?: unknown; rate?: unknown; playing?: unknown };
  const rate = finite(message.rate, 1);
  return { ms: Math.max(0, finite(message.ms, 0)), rate: rate > 0 ? rate : 1, playing: message.playing === true, at: now };
}

export function toPrefs(value: unknown, current: StagePrefs): StagePrefs {
  const message = (value ?? {}) as { captions?: unknown; captionScale?: unknown; lifted?: unknown };
  const scale = finite(message.captionScale, current.captionScale);
  return {
    captions: typeof message.captions === 'boolean' ? message.captions : current.captions,
    captionScale: Math.min(3, Math.max(0.5, scale)),
    lifted: typeof message.lifted === 'boolean' ? message.lifted : current.lifted,
  };
}

export type Outgoing =
  | { readonly type: 'ready' }
  | { readonly type: 'error'; readonly message: string }
  /** How far the page's own clock had strayed when a sync arrived. Positive: the page was ahead. */
  | { readonly type: 'gap'; readonly ms: number };

export interface Bridge {
  readonly getState: () => StageState;
  readonly subscribe: (listener: () => void) => () => void;
  /** What the app calls, as `window.cairn`. */
  readonly api: {
    readonly load: (message: unknown) => void;
    readonly sync: (message: unknown) => void;
    readonly set: (message: unknown) => void;
  };
}

export function createBridge(post: (message: Outgoing) => void, now: () => number): Bridge {
  let state = INITIAL;
  const listeners = new Set<() => void>();
  const commit = (next: StageState): void => {
    state = next;
    for (const listener of listeners) listener();
  };
  const guarded = (name: string, run: () => void): void => {
    try {
      run();
    } catch (cause) {
      post({ type: 'error', message: `${name}: ${cause instanceof Error ? cause.message : String(cause)}` });
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    api: {
      load: (message) => guarded('load', () => {
        // A new station starts silent at zero; the sync that follows says otherwise.
        commit({ ...state, station: toStation(message), anchor: { ...INITIAL.anchor, at: now() } });
      }),
      sync: (message) => guarded('sync', () => {
        const at = now();
        const anchor = toAnchor(message, at);
        const duration = state.station?.deck.durationMs ?? 0;
        // Only a sync that continues steady playback measures the clock; a seek or a pause is a jump by design.
        if (state.anchor.playing && anchor.playing && state.anchor.rate === anchor.rate) {
          post({ type: 'gap', ms: Math.round(clockAt(state.anchor, at, duration) - anchor.ms) });
        }
        commit({ ...state, anchor });
      }),
      set: (message) => guarded('set', () => commit({ ...state, prefs: toPrefs(message, state.prefs) })),
    },
  };
}
