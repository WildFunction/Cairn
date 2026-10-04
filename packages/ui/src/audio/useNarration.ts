import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { NarrationPlayer, type NarrationEvents } from './NarrationPlayer';

/** One player for the pane's lifetime. The handlers may change every render; the player does not. */
export function useNarration(events: NarrationEvents): RefObject<NarrationPlayer | null> {
  const player = useRef<NarrationPlayer | null>(null);
  const latest = useRef(events);
  latest.current = events;

  useEffect(() => {
    const made = new NarrationPlayer({
      onPlay: () => latest.current.onPlay(),
      onPause: () => latest.current.onPause(),
      onEnded: () => latest.current.onEnded(),
      onTime: (seconds) => latest.current.onTime(seconds),
    });
    player.current = made;
    return () => {
      player.current = null;
      made.dispose();
    };
  }, []);

  return player;
}
