import type { Caption } from '@cairn/core/pipeline/caption';
import type { NodeDeck } from '@cairn/core/types';
import { lastIndexAtOrBefore, LEAD_MS } from './reveal';
import type { RevealWindow } from './SlideView';

/** What is on screen at one audio position: the slide, how much of it, and the caption. */
export interface Frame {
  readonly slideIdx: number;
  readonly slide: NodeDeck['slides'][number] | undefined;
  readonly captionIdx: number;
  readonly caption: Caption | undefined;
  readonly reveal: RevealWindow;
}

/**
 * The one place the picture is derived from the sound. The desktop pane and the
 * phone's slide page both call it, so they cannot disagree about when a slide turns.
 */
export function frameAt(deck: NodeDeck, captions: readonly Caption[], ms: number): Frame {
  // Everything on screen is read at the lead, never at the raw audio position.
  const at = ms + LEAD_MS;
  const slideIdx = lastIndexAtOrBefore(deck.slides.map((s) => s.atMs), at);
  // Between captions there is no exact hit, so hold the last one that started
  const captionIdx = lastIndexAtOrBefore(captions.map((c) => c.startMs), at);
  const slide = deck.slides[slideIdx];

  return {
    slideIdx,
    slide,
    captionIdx,
    caption: captions[captionIdx],
    // Items arrive when the voice names them; a scrub backwards folds the slide up again.
    reveal: {
      cues: captions,
      spanStartMs: slide?.atMs ?? 0,
      spanEndMs: deck.slides[slideIdx + 1]?.atMs ?? deck.durationMs,
      ms: at,
    },
  };
}
