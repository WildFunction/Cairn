import { useCallback, useEffect, useRef, useState } from 'react';

export const RATES = [0.75, 1, 1.25, 1.5, 2, 3] as const;
/** What a held → plays at. ↑ / ↓ move through them while the key is down. */
export const HOLD_RATES = [1.5, 2, 3] as const;
const DEFAULT_HOLD_RATE = 2;

/** What the transport drives: `<audio>`'s own names, so either can stand behind it. */
export type TransportMedia = Pick<
  HTMLMediaElement,
  'currentTime' | 'duration' | 'paused' | 'playbackRate' | 'volume' | 'muted' | 'play' | 'pause'
>;

/** Tap distance at 1x. Scales with rate so a jump covers the same amount of narration. */
const SEEK_BASE_S = 5;
/** Held longer than this and the press is a hold, not a tap. */
const HOLD_MS = 180;
/** Audio cannot play backwards, so holding left rewinds by repeated seeks instead. */
const REWIND_TICK_MS = 100;
const REWIND_STEP_S = 0.8;
/** One press of ↑ / ↓. Ten steps across the range is enough to aim with. */
const VOLUME_STEP = 0.1;

export function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** Tap distance scales with rate, so a jump covers the same amount of narration at any speed. */
export function seekDistance(rate: number): number {
  return SEEK_BASE_S * rate;
}

/** The reader's last tier, unless the dial is already that fast — a hold should always do something. */
export function holdRate(rate: number, preferred: number): number {
  if (preferred > rate) return preferred;
  return HOLD_RATES.find((r) => r > rate) ?? HOLD_RATES[HOLD_RATES.length - 1]!;
}

/** One tier along, stopping at the ends: a wheel that wrapped would jump 3x to 1.5x. */
export function stepHoldRate(current: number, delta: 1 | -1): number {
  const at = HOLD_RATES.indexOf(current as (typeof HOLD_RATES)[number]);
  return HOLD_RATES[Math.min(HOLD_RATES.length - 1, Math.max(0, at + delta))]!;
}

export function nextRate(rate: number): number {
  const at = RATES.indexOf(rate as (typeof RATES)[number]);
  return RATES[(at + 1) % RATES.length]!;
}

export interface Transport {
  readonly rate: number;
  readonly boosting: boolean;
  /** The speed a held → is playing at. Absent when nothing is held, and while rewinding. */
  readonly boost: number | undefined;
  readonly volume: number;
  readonly muted: boolean;
  setRate: (rate: number) => void;
  cycleRate: () => void;
  toggle: () => void;
  seek: (deltaS: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  /** Write rate and volume onto the player, which is created knowing neither. */
  apply: () => void;
}

/**
 * Keyboard transport for the deck.
 *
 *   tap  ← / →   seek 5s, scaled by rate — at 2x a tap covers 10s
 *   hold →       play faster while held; ↑ / ↓ pick how fast
 *   hold ←       rewind continuously (no negative playbackRate exists)
 *   space        play / pause
 */
export function useTransport(
  audio: React.RefObject<TransportMedia | null>,
  enabled = true,
  onFullscreen?: () => void,
  /** Where the reader's stored default puts the dial at the start of a session. */
  initialRate = 1,
): Transport {
  const [rate, setRateState] = useState(initialRate);
  const [boosting, setBoosting] = useState(false);
  const [boost, setBoostState] = useState<number>();
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);

  // Refs, not state: the key handlers must see current values without re-binding
  const rateRef = useRef(initialRate);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rewindTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const held = useRef<'left' | 'right' | undefined>(undefined);
  /** Single source of truth for "a hold is in progress"; never infer it from playbackRate. */
  const holding = useRef(false);
  const boostRef = useRef<number | undefined>(undefined);
  const preferredHold = useRef<number>(DEFAULT_HOLD_RATE);
  const volumeRef = useRef(1);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  const setRate = useCallback((next: number) => {
    rateRef.current = next;
    setRateState(next);
    if (audio.current) audio.current.playbackRate = boostRef.current ?? next;
  }, [audio]);

  const cycleRate = useCallback(() => setRate(nextRate(rateRef.current)), [setRate]);

  const setVolume = useCallback((next: number) => {
    const level = clampVolume(next);
    volumeRef.current = level;
    setVolumeState(level);
    setMuted(level === 0);
    if (audio.current) { audio.current.volume = level; audio.current.muted = level === 0; }
  }, [audio]);

  const toggleMute = useCallback(() => {
    setMuted((was) => {
      const next = !was;
      if (audio.current) audio.current.muted = next;
      return next;
    });
  }, [audio]);

  const apply = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    el.playbackRate = boostRef.current ?? rateRef.current;
    el.volume = volumeRef.current;
    el.muted = mutedRef.current;
  }, [audio]);

  const seek = useCallback((deltaS: number) => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.min(el.duration || Infinity, Math.max(0, el.currentTime + deltaS));
  }, [audio]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play(); else el.pause();
  }, [audio]);

  const setBoost = useCallback((next: number | undefined) => {
    boostRef.current = next;
    setBoostState(next);
    if (audio.current) audio.current.playbackRate = next ?? rateRef.current;
  }, [audio]);

  const endHold = useCallback(() => {
    clearTimeout(holdTimer.current);
    clearInterval(rewindTimer.current);
    holdTimer.current = undefined;
    rewindTimer.current = undefined;
    holding.current = false;
    held.current = undefined;
    setBoost(undefined);
    setBoosting(false);
  }, [setBoost]);

  useEffect(() => {
    if (!enabled) return;

    const onDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMute(); return; }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); onFullscreen?.(); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (boostRef.current !== undefined) {
          // The wheel is drawn slowest on top, so ↓ is faster. Not the app's station step either.
          e.stopImmediatePropagation();
          if (e.repeat) return;
          const next = stepHoldRate(boostRef.current, e.key === 'ArrowDown' ? 1 : -1);
          preferredHold.current = next;
          setBoost(next);
          return;
        }
        setVolume(volumeRef.current + (e.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP));
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      e.preventDefault();
      // Auto-repeat fires keydown over and over; only the first press starts a hold
      if (e.repeat || held.current) return;

      const dir = e.key === 'ArrowRight' ? 'right' : 'left';
      held.current = dir;

      holdTimer.current = setTimeout(() => {
        holding.current = true;
        setBoosting(true);
        if (dir === 'right') {
          setBoost(holdRate(rateRef.current, preferredHold.current));
        } else {
          rewindTimer.current = setInterval(
            () => seek(-REWIND_STEP_S * rateRef.current),
            REWIND_TICK_MS,
          );
        }
      }, HOLD_MS);
    };

    const onUp = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const dir = held.current;
      const wasHold = holding.current;
      endHold();

      // Released before the hold threshold: it was a tap
      if (!wasHold && dir) {
        seek((dir === 'left' ? -1 : 1) * seekDistance(rateRef.current));
      }
    };

    // Capture, so a held → can keep ↑ / ↓ from reaching the app's own listener
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp);
    // A hold that survives a blur would never end
    window.addEventListener('blur', endHold);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', endHold);
      endHold();
    };
  }, [enabled, seek, toggle, endHold, setBoost, setVolume, toggleMute, onFullscreen]);

  return {
    rate, boosting, boost, volume, muted,
    setRate, cycleRate, toggle, seek, setVolume, toggleMute, apply,
  };
}
